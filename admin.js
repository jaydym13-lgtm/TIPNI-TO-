// =========================================================================
// ⚙️ TIPNI TO! - ADMIN, SUPERADMIN & LOUTKOVODIČ ENGINE (admin.js)
// =========================================================================

import { doc, collection, getDocs, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp, deleteField, writeBatch } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js";
import { CONFIG } from "./config.js";

// =========================================================================
// ⚙️ SPRÁVA ZÁPASŮ & VÝSLEDKŮ V ADMIN PANELU
// =========================================================================

// ADMIN SELEKTOR LIGY
window.selectAdminLeague = (leagueName) => {
    const store = Alpine.store('appState');
    if (store) {
        store.selectedAdminLeague = leagueName;
        // 🔒 GARANCE ZAVŘENÝCH ROLETEK PŘI KAŽDÉM VSTUPU
        store.adminMasterOpen = false;
        store.adminAddOpen = false;
        store.adminGlobalOpen = false;
        window.renderAdminMatches();
    }
};

// ⚙️ CENTRALIZOVANÝ ADMIN PANEL: ČISTÝ DATOVÝ CONTROLLER (0 READS Z FIRESTORE!)
window.renderAdminMatches = async () => {
    const store = Alpine.store('appState');
    if (!store || !store.isAdmin) {
        window.goToScreen('leaguesScreen');
        return;
    }

    if (store.currentScreen !== 'adminScreen') {
        window.adminCurrentListeningKey = null;
        store.adminMatchesLoaded = false;
        return;
    }

    if (store.adminActiveTab === 'recalc') {
        window.renderAdminRecalc();
        return;
    }

    if (store.adminActiveTab === 'recovery') {
        window.renderAdminRecovery();
        return;
    }

    const activeAdminLeague = store.selectedAdminLeague;
    const sezonaId = store.activeSeason || window.SEZONA_ID || "2026_2027";
    const sluchatkoKlic = `${activeAdminLeague}_${sezonaId}`;

    if (activeAdminLeague && window.adminCurrentListeningKey !== sluchatkoKlic) {
        store.adminMatches = [];
        store.adminMatchesLoaded = false;
        window.adminCurrentListeningKey = sluchatkoKlic;
        window.adminLeagueKoloInitialized = false;

        // 1. Tiché načtení nastavení ligy (1 dokument)
        getDoc(doc(window.db, 'ligy', activeAdminLeague)).then((lDoc) => {
            if (lDoc.exists()) {
                const lData = lDoc.data();
                store.adminGlobalVitez = lData.vitez || '';
                store.adminGlobalStrelec = lData.strelec || '';
                store.adminLeagueHasTopMatch = lData.hasTopMatch !== undefined ? lData.hasTopMatch : true;
            } else {
                store.adminGlobalVitez = '';
                store.adminGlobalStrelec = '';
                store.adminLeagueHasTopMatch = true;
            }
        }).catch(err => console.error(err));

        // 2. ⚡ 0 READS: Zápasy načteme bleskově z R2 / lokální paměti bez stahování z Firestore!
        let rozpisData = null;
        if (store.selectedLeague === activeAdminLeague && store.rozpisData?.zapasyMapa) {
            rozpisData = store.rozpisData;
        } else if (store.leaguesMemoryCache?.[activeAdminLeague]?.rozpisData?.zapasyMapa) {
            rozpisData = store.leaguesMemoryCache[activeAdminLeague].rozpisData;
        }

        if (!rozpisData || !rozpisData.zapasyMapa) {
            const ligaKlic = String(activeAdminLeague).replace(/ /g, "_");
            const keshRazitko = Math.floor(Date.now() / 30000);
            try {
                const res = await fetch(`${CONFIG.R2_BASE_URL}/sezony/${sezonaId}/${ligaKlic}/rozpis.json?v=${keshRazitko}`);
                if (res.ok) {
                    rozpisData = await res.json();
                }
            } catch (e) {
                console.error("Chyba načtení R2 pro admin:", e);
            }
        }

        const zapasyMapa = rozpisData?.zapasyMapa || {};
        const zapasy = Object.keys(zapasyMapa).map(id => ({
            id,
            ...zapasyMapa[id],
            showEdit: false
        }));

        zapasy.sort((a, b) => {
            const dA = a.datum?.toDate ? a.datum.toDate() : new Date(a.datum || 0);
            const dB = b.datum?.toDate ? b.datum.toDate() : new Date(b.datum || 0);
            return dA - dB;
        });

        store.adminMatches = zapasy;
        store.adminMatchesLoaded = true;

        // 🎯 CHYTRÝ DRŽÁK POZICE: Auto-select kola se spustí POUZE PŘI PRVNÍM NAČTENÍ ligy v Adminu!
        if (zapasy.length > 0 && !window.adminLeagueKoloInitialized) {
            window.adminLeagueKoloInitialized = true;
            const unikatniKola = [...new Set(zapasy.map(m => window.prelozFaziTurnaje(m.stage, m.kolo, m.isPlayoff)))].filter(Boolean);
            const prveNeukoncene = zapasy.find(m => (m.vysledek_domaci === undefined || m.apiStatus === "IN_PLAY" || m.apiStatus === "PAUSED") && m.apiStatus !== "POSTPONED");
            
            if (prveNeukoncene) {
                const nazevKola = window.prelozFaziTurnaje(prveNeukoncene.stage, prveNeukoncene.kolo, prveNeukoncene.isPlayoff);
                const idx = unikatniKola.indexOf(nazevKola);
                if (idx !== -1) store.adminKolaIndex = idx;
            } else {
                store.adminKolaIndex = Math.max(0, unikatniKola.length - 1);
            }
        }
    }
};

// ADMIN: ÚPRAVA DATUMU ZÁPASU PŘES CLOUD FUNKCI (100% NEZÁVISLÉ NA BOTOVI)
window.updateMatchDate = async (matchId) => {
    const store = Alpine.store('appState');
    const activeAdminLeague = store?.selectedAdminLeague;
    const sezonaId = store?.activeSeason || window.SEZONA_ID || "2026_2027";
    const inputEl = document.getElementById(`admin-edit-datum-${matchId}`);
    const newVal = inputEl?.value;

    if (!newVal || !activeAdminLeague) {
        window.showToast("Musíš vybrat platné datum a čas! 📅", true);
        return;
    }

    const isoDate = new Date(newVal).toISOString();

    // ⚡ 1. OKAMŽITÝ LOKÁLNÍ MICRO-PATCH (0 ms odezva v tvém otevřeném okně)
    if (store.rozpisData?.zapasyMapa?.[matchId]) {
        store.rozpisData.zapasyMapa[matchId].datum = isoDate;
        store.obnovCacheTimeline();
    }
    const adminZapas = store.adminMatches?.find(m => m.id === matchId);
    if (adminZapas) {
        adminZapas.datum = isoDate;
    }

    window.showToast("⏳ Ukládám nový termín utkání...", false);

    // 🚀 2. BEZPEČNÝ ATOMICKÝ ZÁPIS PŘES CLOUD FUNKCI NA R2 + DB + PULS
    try {
        const updateMatchDateCF = httpsCallable(window.functions, 'updateMatchDateCF');
        await updateMatchDateCF({
            leagueName: activeAdminLeague,
            matchId: matchId,
            newDateIso: isoDate,
            sezonaId: sezonaId
        });

        window.showToast("📅 Čas zápasu úspěšně upraven a odeslán hráčům!");
        window.renderAdminMatches();
    } catch (e) {
        console.error("Chyba při změně data zápasu:", e);
        window.showToast("❌ Chyba při ukládání termínu: " + (e.message || "Server odmítl zápis"), true);
    }
};

// ADMIN: RUČNÍ ZÁPIS KURZŮ ZÁPASU (PŘES CLOUD FUNKCI NA R2)
window.saveMatchOdds = async (matchId) => {
    const store = Alpine.store('appState');
    const activeAdminLeague = store?.selectedAdminLeague;
    const sezonaId = store?.activeSeason || window.SEZONA_ID || "2026_2027";

    const val1 = document.getElementById(`admin-edit-odd-1-${matchId}`)?.value.trim();
    const valX = document.getElementById(`admin-edit-odd-X-${matchId}`)?.value.trim();
    const val2 = document.getElementById(`admin-edit-odd-2-${matchId}`)?.value.trim();

    if (!val1 || !val2) {
        window.showToast("Kurz na 1 i 2 musí být vyplněn! 📊", true);
        return;
    }

    const num1 = parseFloat(val1);
    const num2 = parseFloat(val2);
    const numX = valX ? parseFloat(valX) : null;

    if (isNaN(num1) || isNaN(num2) || num1 <= 1 || num2 <= 1 || (valX && (isNaN(numX) || numX <= 1))) {
        window.showToast("Zadej platné kurzy větší než 1.00! 🚫", true);
        return;
    }

    const oddsPayload = {
        "1": num1,
        "X": numX,
        "2": num2,
        bookmaker: "Admin"
    };

    const lKlic = String(activeAdminLeague).replace(/ /g, "_");

    if (store.leaguesMemoryCache?.[activeAdminLeague]?.rozpisData?.zapasyMapa?.[matchId]) {
        store.leaguesMemoryCache[activeAdminLeague].rozpisData.zapasyMapa[matchId].odds = oddsPayload;
    }

    try {
        const cachedRaw = localStorage.getItem(`tipni_cache_rozpis_${sezonaId}_${lKlic}`);
        if (cachedRaw) {
            const parsed = JSON.parse(cachedRaw);
            if (parsed && parsed.zapasyMapa && parsed.zapasyMapa[matchId]) {
                parsed.zapasyMapa[matchId].odds = oddsPayload;
                localStorage.setItem(`tipni_cache_rozpis_${sezonaId}_${lKlic}`, JSON.stringify(parsed));
            }
        }
    } catch (e) {}

    if (store.rozpisData?.zapasyMapa?.[matchId]) {
        store.rozpisData.zapasyMapa[matchId].odds = oddsPayload;
        store.obnovCacheTimeline();
    }
    const adminZapas = store.adminMatches?.find(m => m.id === matchId);
    if (adminZapas) {
        adminZapas.odds = oddsPayload;
    }

    store.leagueFilterTick++;
    window.showToast("⏳ Ukládám kurzy zápasu na server...", false);

    try {
        const saveMatchOddsCF = httpsCallable(window.functions, 'saveMatchOddsCF');
        await saveMatchOddsCF({
            leagueName: activeAdminLeague,
            matchId: matchId,
            odds: oddsPayload,
            sezonaId: sezonaId
        });

        window.showToast("✅ Kurzy uloženy a synchronizovány se všemi hráči!");

        if (store.currentScreen === 'superAdminScreen' && store.superAdminActiveTab === 'odds') {
            window.renderSuperAdmin('odds');
        } else {
            window.renderAdminMatches();
        }
    } catch (err) {
        console.error("Chyba při ukládání kurzů:", err);
        window.showToast("❌ Chyba při ukládání kurzů: " + (err.message || "Server odmítl zápis"), true);
    }
};

// ADMIN: RUČNÍ SMAZÁNÍ KURZŮ ZÁPASU (PŘES CLOUD FUNKCI)
window.deleteMatchOdds = async (matchId) => {
    const store = Alpine.store('appState');
    const activeAdminLeague = store?.selectedAdminLeague;
    const sezonaId = store?.activeSeason || window.SEZONA_ID || "2026_2027";
    if (!activeAdminLeague || !matchId) return;

    if (store.rozpisData?.zapasyMapa?.[matchId]) {
        delete store.rozpisData.zapasyMapa[matchId].odds;
        store.obnovCacheTimeline();
    }
    const adminZapas = store.adminMatches?.find(m => m.id === matchId);
    if (adminZapas) {
        delete adminZapas.odds;
    }

    const input1 = document.getElementById(`admin-edit-odd-1-${matchId}`);
    const inputX = document.getElementById(`admin-edit-odd-X-${matchId}`);
    const input2 = document.getElementById(`admin-edit-odd-2-${matchId}`);
    if (input1) input1.value = '';
    if (inputX) inputX.value = '';
    if (input2) input2.value = '';

    const lKlic = String(activeAdminLeague).replace(/ /g, "_");
    try {
        const cachedRaw = localStorage.getItem(`tipni_cache_rozpis_${sezonaId}_${lKlic}`);
        if (cachedRaw) {
            const parsed = JSON.parse(cachedRaw);
            if (parsed?.zapasyMapa?.[matchId]) {
                delete parsed.zapasyMapa[matchId].odds;
                localStorage.setItem(`tipni_cache_rozpis_${sezonaId}_${lKlic}`, JSON.stringify(parsed));
            }
        }
    } catch (e) {}

    window.showToast("⏳ Mažu kurz ze serveru...", false);

    try {
        const deleteMatchOddsCF = httpsCallable(window.functions, 'deleteMatchOddsCF');
        await deleteMatchOddsCF({
            leagueName: activeAdminLeague,
            matchId: matchId,
            sezonaId: sezonaId
        });
        window.showToast("🗑️ Kurz úspěšně smazán!");
        window.renderAdminMatches();
    } catch (err) {
        console.error("Chyba při mazání kurzu:", err);
        window.showToast("❌ Chyba: " + (err.message || "Server odmítl smazání"), true);
    }
};

// ADMIN: PŘEPÍNAČ TOP ZÁPASU (2x BODY) S JISTIČEM NA MAX 1 TOP ZÁPAS NA KOLO
window.toggleTopMatch = async (matchId) => {
    const store = Alpine.store('appState');
    const activeAdminLeague = store?.selectedAdminLeague;
    const sezonaId = store?.activeSeason || window.SEZONA_ID || "2026_2027";
    const zapasy = store?.adminMatches || [];
    
    const cilovyZapas = zapasy.find(m => m.id === matchId);
    if (!activeAdminLeague || !cilovyZapas) return;

    const budeTop = !cilovyZapas.isTopMatch;
    const koloCilovehoZapasu = window.prelozFaziTurnaje(cilovyZapas.stage, cilovyZapas.kolo, cilovyZapas.isPlayoff);

    try {
        const batch = writeBatch(window.db);

        if (budeTop) {
            zapasy.forEach(m => {
                const kKola = window.prelozFaziTurnaje(m.stage, m.kolo, m.isPlayoff);
                if (kKola === koloCilovehoZapasu && m.isTopMatch && m.id !== matchId) {
                    const staryRef = doc(window.db, 'ligy', activeAdminLeague, 'sezony', sezonaId, 'zapasy', m.id);
                    batch.update(staryRef, { isTopMatch: false });
                }
            });
        }

        const cilovyRef = doc(window.db, 'ligy', activeAdminLeague, 'sezony', sezonaId, 'zapasy', matchId);
        batch.update(cilovyRef, { isTopMatch: budeTop });

        await batch.commit();
        window.showToast(budeTop ? "🔥 Zápas označen jako TOP ZÁPAS (2x body)!" : "ℹ️ Označení TOP ZÁPAS odebráno.");
    } catch (e) {
        alert("Chyba při změně TOP zápasu: " + e.message);
    }
};

// ADMIN: PŘEPÍNAČ AUTOMATICKÉHO GENERÁTORU TOP ZÁPASŮ PER LIGA
window.toggleLeagueTopGenerator = async (leagueName, isEnabled) => {
    const store = Alpine.store('appState');
    if (!leagueName) return;

    if (store) store.adminLeagueHasTopMatch = isEnabled;

    try {
        await setDoc(doc(window.db, 'ligy', leagueName), {
            hasTopMatch: isEnabled
        }, { merge: true });

        window.showToast(isEnabled ? "🔥 Generátor TOP zápasů pro ligu POVOLEN!" : "⏸️ Generátor TOP zápasů pro ligu VYPNUT.");
    } catch (e) {
        console.error("Chyba při zápisu stavu generátoru:", e);
        window.showToast("❌ Chyba při ukládání nastavení generátoru.", true);
    }
};

// ADMIN: PŘEPÍNAČ ODLOŽENÉHO ZÁPASU S OCHRANOU PROTI PŘEPSÁNÍ BOTEM
window.toggleMatchPostponed = async (matchId, shouldPostpone) => {
    const store = Alpine.store('appState');
    const activeAdminLeague = store?.selectedAdminLeague;
    const sezonaId = store?.activeSeason || window.SEZONA_ID || "2026_2027";
    if (!activeAdminLeague) return;

    const newStatus = shouldPostpone ? "POSTPONED" : "SCHEDULED";

    if (store.rozpisData?.zapasyMapa?.[matchId]) {
        store.rozpisData.zapasyMapa[matchId].apiStatus = newStatus;
        store.rozpisData.zapasyMapa[matchId].manuallyPostponed = shouldPostpone;
        store.obnovCacheTimeline();
    }
    const adminM = store.adminMatches?.find(m => m.id === matchId);
    if (adminM) {
        adminM.apiStatus = newStatus;
        adminM.manuallyPostponed = shouldPostpone;
    }

    const lKlic = String(activeAdminLeague).replace(/ /g, "_");
    try {
        const cachedRaw = localStorage.getItem(`tipni_cache_rozpis_${sezonaId}_${lKlic}`);
        if (cachedRaw) {
            const parsed = JSON.parse(cachedRaw);
            if (parsed?.zapasyMapa?.[matchId]) {
                parsed.zapasyMapa[matchId].apiStatus = newStatus;
                parsed.zapasyMapa[matchId].manuallyPostponed = shouldPostpone;
                localStorage.setItem(`tipni_cache_rozpis_${sezonaId}_${lKlic}`, JSON.stringify(parsed));
            }
        }
    } catch (e) {}

    window.showToast(shouldPostpone ? "⏳ Označuji zápas jako odložený..." : "▶️ Vracím zápas do hry...", false);

    try {
        const toggleMatchPostponedCF = httpsCallable(window.functions, 'toggleMatchPostponedCF');
        await toggleMatchPostponedCF({
            leagueName: activeAdminLeague,
            matchId: matchId,
            isPostponed: shouldPostpone,
            sezonaId: sezonaId
        });

        window.showToast(shouldPostpone ? "⏳ Zápas úspěšně označen jako ODLOŽEN!" : "▶️ Zápas vrácen mezi aktivní utkání!");
        window.renderAdminMatches();
    } catch (err) {
        console.error("Chyba při změně stavu zápasu:", err);
        window.showToast("❌ Chyba: " + (err.message || "Server požadavek zamítl"), true);
    }
};

// ADMIN: SMAZÁNÍ ZÁPASU (FIRESTORE + R2 + LOKÁLNÍ RAM + PULS MAJÁK)
window.deleteMatch = (matchId) => {
    const store = Alpine.store('appState');
    const activeAdminLeague = store?.selectedAdminLeague;
    const sezonaId = store?.activeSeason || window.SEZONA_ID || "2026_2027";
    if (!activeAdminLeague) return;

    const modalOverlay = document.createElement('div');
    modalOverlay.id = `custom-confirm-modal-${matchId}`;
    modalOverlay.style = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.85); z-index: 11000; display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);";

    modalOverlay.innerHTML = `
        <div style="background: #1f2937; border: 4px solid #dc2626; border-radius: 20px; padding: 30px 20px; max-width: 420px; width: 100%; text-align: center; box-shadow: 0 25px 60px rgba(0, 0, 0, 0.7); color: white; font-family: 'Segoe UI', sans-serif;">
            <h3 style="font-family: 'Oswald', sans-serif; color: #dc2626; font-size: 1.6rem; margin: 0 0 15px 0; text-transform: uppercase; letter-spacing: 1px;">🚨 POTVRZENÍ SMAZÁNÍ</h3>
            <p style="font-size: 0.95rem; color: #9ca3af; line-height: 1.5; margin: 0 0 25px 0;">
                Opravdu chceš tento zápas trvale vymazat?<br>
                <span style="color: #f87171; font-weight: bold;">Zápas bude okamžitě vyříznut z databáze i ze serveru R2!</span>
            </p>
            <div style="display: flex; gap: 12px; justify-content: center;">
                <button id="confirm-modal-cancel" style="background: #4b5563; color: white; border: none; padding: 12px 20px; border-radius: 8px; font-weight: bold; font-size: 0.9rem; cursor: pointer; text-transform: uppercase;">Zrušit</button>
                <button id="confirm-modal-delete" style="background: #dc2626; color: white; border: none; padding: 12px 20px; border-radius: 8px; font-weight: bold; font-size: 0.9rem; cursor: pointer; text-transform: uppercase;">Smazat</button>
            </div>
        </div>
    `;

    document.body.appendChild(modalOverlay);
    modalOverlay.querySelector('#confirm-modal-cancel').onclick = () => { modalOverlay.remove(); };

    modalOverlay.querySelector('#confirm-modal-delete').onclick = async () => {
        modalOverlay.remove();

        if (store.rozpisData?.zapasyMapa?.[matchId]) {
            delete store.rozpisData.zapasyMapa[matchId];
            store.obnovCacheTimeline();
        }
        if (store.adminMatches) {
            store.adminMatches = store.adminMatches.filter(m => m.id !== matchId);
        }
        const lKlic = String(activeAdminLeague).replace(/ /g, "_");
        if (store.leaguesMemoryCache?.[activeAdminLeague]?.rozpisData?.zapasyMapa?.[matchId]) {
            delete store.leaguesMemoryCache[activeAdminLeague].rozpisData.zapasyMapa[matchId];
        }
        try {
            const cachedRaw = localStorage.getItem(`tipni_cache_rozpis_${sezonaId}_${lKlic}`);
            if (cachedRaw) {
                const parsed = JSON.parse(cachedRaw);
                if (parsed?.zapasyMapa?.[matchId]) {
                    delete parsed.zapasyMapa[matchId];
                    localStorage.setItem(`tipni_cache_rozpis_${sezonaId}_${lKlic}`, JSON.stringify(parsed));
                }
            }
        } catch (e) {}

        window.showToast("🗑️ Mažu zápas ze serveru i databáze...", false);

        try {
            const deleteMatchCF = httpsCallable(window.functions, 'deleteMatchCF');
            await deleteMatchCF({
                leagueName: activeAdminLeague,
                matchId: matchId,
                sezonaId: sezonaId
            });

            window.showToast("🗑️ Zápas trvale vymazán!");
            window.renderAdminMatches();
        } catch (e) {
            console.error("Chyba při mazání zápasu:", e);
            window.showToast("❌ Chyba při mazání zápasu: " + (e.message || "Server odmítl požadavek"), true);
        }
    };
};

// ADMIN: RUČNÍ ZALOŽENÍ ZÁPASU
window.adminCreateMatch = async (leagueName) => {
    const domaci = document.getElementById('admin-new-domaci').value.trim();
    const hoste = document.getElementById('admin-new-hoste').value.trim();
    const datumVal = document.getElementById('admin-new-datum').value;
    const isPlayoff = document.getElementById('admin-new-isPlayoff')?.checked || false;
    const isTopMatch = document.getElementById('admin-new-isTopMatch')?.checked || false;
    const sezonaId = Alpine.store('appState')?.activeSeason || window.SEZONA_ID || "2026_2027";

    if (!domaci || !hoste || !datumVal) {
        alert("Musíš vyplnit kompletní údaje pro založení zápasu! 🧐");
        return;
    }

    try {
        await setDoc(doc(collection(window.db, 'ligy', leagueName, 'sezony', sezonaId, 'zapasy')), {
            domaci: domaci,
            hoste: hoste,
            datum: Timestamp.fromDate(new Date(datumVal)),
            isPlayoff: isPlayoff,
            isTopMatch: isTopMatch
        });

        window.showToast("➕ Nový zápas úspěšně vytvořen!");
        window.renderAdminMatches();
    } catch (e) {
        alert("Chyba zakládání zápasu: " + e.message);
    }
};

// ADMIN: ZÁPIS CELKOVÝCH MISTRŮ (Z DATOVÉHO REAKTIVNÍHO STORU)
window.saveLeagueGlobalResults = async (leagueName) => {
    const store = Alpine.store('appState');
    const vitez = store ? store.adminGlobalVitez.trim() : '';
    const strelec = store ? store.adminGlobalStrelec.trim() : '';

    try {
        await setDoc(doc(window.db, 'ligy', leagueName), {
            vitez: vitez,
            strelec: strelec,
            aktualizovano: serverTimestamp()
        }, { merge: true });

        window.showToast(`⚙️ Výsledky turnaje ${leagueName} uloženy!`);
        window.renderAdminMatches();
    } catch (e) {
        alert("Chyba ukládání ligy: " + e.message);
    }
};

// ADMIN: ULOŽENÍ REÁLNÉHO VÝSLEDKU JEDNOHO ZÁPASU
window.saveRealResult = async (matchId) => {
    const store = Alpine.store('appState');
    const activeAdminLeague = store?.selectedAdminLeague;
    const sezonaId = store?.activeSeason || window.SEZONA_ID || "2026_2027";
    if (!activeAdminLeague) return;

    const valDomaci = document.getElementById(`admin-res-domaci-${matchId}`).value;
    const valHoste = document.getElementById(`admin-res-hoste-${matchId}`).value;

    if (valDomaci === "" && valHoste === "") {
        try {
            await updateDoc(doc(window.db, 'ligy', activeAdminLeague, 'sezony', sezonaId, 'zapasy', matchId), {
                vysledek_domaci: deleteField(),
                vysledek_hoste: deleteField(),
                postup: deleteField(),
                apiStatus: deleteField()
            });
            window.showToast("🔄 Zápas odemčen a vrácen k tipování!");

            const adminM = store?.adminMatches?.find(m => m.id === matchId);
            if (adminM) {
                delete adminM.vysledek_domaci;
                delete adminM.vysledek_hoste;
                delete adminM.postup;
                adminM.apiStatus = "SCHEDULED";
            }
            if (store.rozpisData?.zapasyMapa?.[matchId]) {
                delete store.rozpisData.zapasyMapa[matchId].vysledek_domaci;
                delete store.rozpisData.zapasyMapa[matchId].vysledek_hoste;
                delete store.rozpisData.zapasyMapa[matchId].postup;
                store.rozpisData.zapasyMapa[matchId].apiStatus = "SCHEDULED";
                store.obnovCacheTimeline();
            }
            return;
        } catch (e) {
            console.error("Chyba resetu:", e);
            return;
        }
    }

    if (valDomaci === "" || valHoste === "") {
        window.showToast("⚠️ Vyber obě čísla, nebo nech oba otazníky!", true);
        return;
    }

    let postupVal = '';
    const dVal = parseInt(valDomaci);
    const hVal = parseInt(valHoste);

    const zZapas = store?.adminMatches?.find(m => m.id === matchId);
    const isExtraliga = (activeAdminLeague === "Tipsport Extraliga");
    const vyzadujePostup = (zZapas?.isPlayoff && activeAdminLeague !== "Liga mistrů") || isExtraliga;

    if (dVal === hVal && vyzadujePostup) {
        const hiddenAdminInput = document.getElementById(`playoff-admin-val-${matchId}`);
        postupVal = hiddenAdminInput ? hiddenAdminInput.value : '';
        if (!postupVal) {
            window.showToast(isExtraliga ? "🏒 Při remíze musíš vybrat vítěze po prodloužení / nájezdech!" : "🏆 V play-off musíš při remíze zvolit postupujícího!", true);
            return;
        }
    }

    try {
        await updateDoc(doc(window.db, 'ligy', activeAdminLeague, 'sezony', sezonaId, 'zapasy', matchId), {
            vysledek_domaci: dVal,
            vysledek_hoste: hVal,
            postup: postupVal,
            apiStatus: "FINISHED"
        });

        window.showToast("⚙️ Skóre uloženo!");
        window.isAppFormDirty = false;
        window.dirtyInputsRegistry.delete(`admin-res-domaci-${matchId}`);
        window.dirtyInputsRegistry.delete(`admin-res-hoste-${matchId}`);

        const sD = document.getElementById(`admin-res-domaci-${matchId}`);
        const sH = document.getElementById(`admin-res-hoste-${matchId}`);
        if (sD) sD.style.color = '#ffffff';
        if (sH) sH.style.color = '#ffffff';

        const adminM = store?.adminMatches?.find(m => m.id === matchId);
        if (adminM) {
            adminM.vysledek_domaci = dVal;
            adminM.vysledek_hoste = hVal;
            adminM.postup = postupVal;
            adminM.apiStatus = "FINISHED";
        }

        if (store.rozpisData && store.rozpisData.zapasyMapa && store.rozpisData.zapasyMapa[matchId]) {
            store.rozpisData.zapasyMapa[matchId].vysledek_domaci = dVal;
            store.rozpisData.zapasyMapa[matchId].vysledek_hoste = hVal;
            store.rozpisData.zapasyMapa[matchId].postup = postupVal;
            store.rozpisData.zapasyMapa[matchId].apiStatus = "FINISHED";
            store.obnovCacheTimeline();
        }

        if (typeof window.triggerGlobalRecalculation === 'function') {
            window.triggerGlobalRecalculation();
        }
    } catch (e) {
        console.error("Chyba zápisu skóre:", e);
    }
};

window.handleAdminScoreChange = (matchId, isPlayoff) => {
    const store = Alpine.store('appState');
    const selD = document.getElementById(`admin-res-domaci-${matchId}`);
    const selH = document.getElementById(`admin-res-hoste-${matchId}`);
    if (!selD || !selH) return;

    const match = store?.adminMatches?.find(m => m.id === matchId);
    const savedD = (match && match.vysledek_domaci !== undefined && match.vysledek_domaci !== null) ? String(match.vysledek_domaci) : '';
    const savedH = (match && match.vysledek_hoste !== undefined && match.vysledek_hoste !== null) ? String(match.vysledek_hoste) : '';

    const d = selD.value;
    const h = selH.value;

    if (d === '') selD.style.color = '#ef4444';
    else if (savedD !== '' && parseInt(d) === parseInt(savedD)) selD.style.color = '#ffffff';
    else selD.style.color = '#facc15';

    if (h === '') selH.style.color = '#ef4444';
    else if (savedH !== '' && parseInt(h) === parseInt(savedH)) selH.style.color = '#ffffff';
    else selH.style.color = '#facc15';

    const klicDom = `admin-res-domaci-${matchId}`;
    const klicHos = `admin-res-hoste-${matchId}`;
    if (d !== savedD) window.dirtyInputsRegistry.add(klicDom);
    else window.dirtyInputsRegistry.delete(klicDom);

    if (h !== savedH) window.dirtyInputsRegistry.add(klicHos);
    else window.dirtyInputsRegistry.delete(klicHos);

    window.isAppFormDirty = (window.dirtyInputsRegistry.size > 0);

    const leagueName = store?.selectedAdminLeague || '';
    const vyzadujeOt = (isPlayoff && leagueName !== "Liga mistrů") || (leagueName === "Tipsport Extraliga");
    const box = document.getElementById(`playoff-admin-box-${matchId}`);

    if (box && vyzadujeOt) {
        if (d !== "" && h !== "" && parseInt(d) === parseInt(h)) {
            box.style.display = 'flex';
        } else {
            box.style.display = 'none';
            const valInput = document.getElementById(`playoff-admin-val-${matchId}`);
            if (valInput) valInput.value = '';
            if (match) match.postup = '';
            const bDom = document.getElementById(`playoff-admin-dom-${matchId}`);
            const bHos = document.getElementById(`playoff-admin-hos-${matchId}`);
            if (bDom) bDom.classList.remove('is-active-tip');
            if (bHos) bHos.classList.remove('is-active-tip');
        }
    }
};

window.selectPlayoffAdmin = (matchId, choice) => {
    const store = Alpine.store('appState');
    const valInput = document.getElementById(`playoff-admin-val-${matchId}`);
    if (valInput) valInput.value = choice;

    const match = store?.adminMatches?.find(m => m.id === matchId);
    if (match) match.postup = choice;

    const btnDom = document.getElementById(`playoff-admin-dom-${matchId}`);
    const btnHos = document.getElementById(`playoff-admin-hos-${matchId}`);
    if (btnDom && btnHos) {
        if (choice === 'domaci') {
            btnDom.classList.add('is-active-tip');
            btnHos.classList.remove('is-active-tip');
        } else if (choice === 'hoste') {
            btnHos.classList.add('is-active-tip');
            btnDom.classList.remove('is-active-tip');
        } else {
            btnDom.classList.remove('is-active-tip');
            btnHos.classList.remove('is-active-tip');
        }
    }
};

// B) PRO ADMINA: HROMADNÉ UKLÁDÁNÍ VÝSLEDKŮ REAKTIVNĚ
window.saveAllAdminResults = async () => {
    const container = document.getElementById('adminMatchesContainer');
    if (!container) return;

    const store = Alpine.store('appState');
    const activeAdminLeague = store ? store.selectedAdminLeague : null;
    if (!activeAdminLeague) return;

    const sezonaId = store?.activeSeason || window.SEZONA_ID || "2026_2027";
    const vsechnyRoletkyDomaci = container.querySelectorAll('[id^="admin-res-domaci-"]');
    let citacZapsanychVysledku = 0;
    
    const batch = writeBatch(window.db);

    vsechnyRoletkyDomaci.forEach(roletkaDom => {
        const matchId = roletkaDom.id.replace('admin-res-domaci-', '');
        const roletkaHoste = document.getElementById(`admin-res-hoste-${matchId}`);
        
        const valDomaci = roletkaDom.value;
        const valHoste = roletkaHoste ? roletkaHoste.value : '';

        if (valDomaci !== "" && valHoste !== "") {
            const dVal = parseInt(valDomaci);
            const hVal = parseInt(valHoste);
            const hiddenAdminInput = document.getElementById(`playoff-admin-val-${matchId}`);
            let postupVal = hiddenAdminInput ? hiddenAdminInput.value : '';

            const matchRef = doc(window.db, 'ligy', activeAdminLeague, 'sezony', sezonaId, 'zapasy', matchId);
            
            batch.update(matchRef, {
                vysledek_domaci: dVal,
                vysledek_hoste: hVal,
                postup: postupVal,
                apiStatus: "FINISHED"
            });

            const adminM = store?.adminMatches?.find(m => m.id === matchId);
            if (adminM) {
                adminM.vysledek_domaci = dVal;
                adminM.vysledek_hoste = hVal;
                adminM.postup = postupVal;
                adminM.apiStatus = "FINISHED";
            }
            if (store?.rozpisData?.zapasyMapa?.[matchId]) {
                store.rozpisData.zapasyMapa[matchId].vysledek_domaci = dVal;
                store.rozpisData.zapasyMapa[matchId].vysledek_hoste = hVal;
                store.rozpisData.zapasyMapa[matchId].postup = postupVal;
                store.rozpisData.zapasyMapa[matchId].apiStatus = "FINISHED";
            }

            citacZapsanychVysledku++;
        }
    });

    if (citacZapsanychVysledku === 0) {
        window.showToast("⚠️ Nebyly nalezeny žádné nové výsledky k zapsání!", true);
        return;
    }

    if (typeof window.showSplash === 'function') window.showSplash("Zapisuji výsledky...");

    try {
        await batch.commit();
        window.showToast(`🎯 Hromadně a bezpečně zapsáno ${citacZapsanychVysledku} výsledků utkání!`);
        window.isAppFormDirty = false;
    } catch (e) {
        console.error("Chyba hromadného batch zápisu admina:", e);
        window.showToast("❌ Server odmítl hromadný zápis výsledků.", true);
    } finally {
        if (typeof window.hideSplash === 'function') {
            if (typeof Alpine !== 'undefined' && Alpine.nextTick) {
                Alpine.nextTick(() => window.hideSplash());
            } else {
                window.hideSplash();
            }
        }
    }
};

// =========================================================================
// 👑 REAL-TIME SOUPISKA: MODULÁRNÍ ŘÍZENÍ PŘÍSTUPŮ A LIGOVÝCH ROLÍ (RBAC)
// =========================================================================
window.toggleUserAdmin = async (uid, checked) => {
    window.showToast("⏳ Aktualizuji admin roli...", false);
    
    if (window.adminUsersCache) {
        const uDoc = window.adminUsersCache.find(d => d.id === uid);
        if (uDoc && typeof uDoc.data === 'function') {
            uDoc.data().isAdmin = checked;
        }
    }

    try {
        const userRef = doc(window.db, 'users', uid);
        const docSnap = await getDoc(userRef);
        const currentLeagues = docSnap.exists() ? (docSnap.data().leagues || []) : [];

        const managePermissions = httpsCallable(window.functions, 'manageUserPermissionsCF');
        
        await managePermissions({
            targetUid: uid,
            isAdminRole: checked,
            leagues: currentLeagues
        });
        
        window.showToast(checked ? "👑 Práva administrátora udělena!" : "ℹ️ Práva administrátora odebrána.");
    } catch (e) { 
        console.error(e); 
        window.showToast("❌ Zápis role odmítnut serverem.", true);
    }
};

window.toggleUserLeague = async (uid, leagueName, checked) => {
    window.showToast("⏳ Aktualizuji ligové licence...", false);
    try {
        const userRef = doc(window.db, 'users', uid);
        const docSnap = await getDoc(userRef);
        let currentLeagues = docSnap.exists() ? (docSnap.data().leagues || []) : [];
        const currentAdmin = docSnap.exists() ? (docSnap.data().isAdmin || false) : false;

        if (checked) {
            if (!currentLeagues.includes(leagueName)) currentLeagues.push(leagueName);
        } else {
            currentLeagues = currentLeagues.filter(l => l !== leagueName);
        }

        const managePermissions = httpsCallable(window.functions, 'manageUserPermissionsCF');
        
        await managePermissions({
            targetUid: uid,
            isAdminRole: currentAdmin,
            leagues: currentLeagues
        });

        window.showToast(`🎯 Licenční klíč pro ligu aktualizován!`);
    } catch (e) { 
        console.error(e); 
        window.showToast("❌ Server zamítl aktualizaci ligy.", true);
    }
};

// 👑 REAKTIVNÍ VLÁDNÍ KOKPIT: ŽIVÝ STREAM UŽIVATELŮ V REÁLNÉM ČASE
window.superAdminActiveTab = window.superAdminActiveTab || 'users';

window.switchSuperAdminTab = (tabName) => {
    window.superAdminActiveTab = tabName;
    const store = Alpine.store('appState');
    if (store) store.superAdminActiveTab = tabName;
    window.renderSuperAdmin(tabName);
};

window.renderSuperAdmin = async (targetTab = null) => {
    const container = document.getElementById('superAdminContainer');
    if (!container) return;

    const store = Alpine.store('appState');
    if (!store || (!store.isSuperAdmin && !store.isAdmin)) {
        window.goToScreen('leaguesScreen');
        return;
    }

    if (targetTab) {
        window.superAdminActiveTab = targetTab;
        if (store) store.superAdminActiveTab = targetTab;
    } else if (store?.superAdminActiveTab) {
        window.superAdminActiveTab = store.superAdminActiveTab;
    } else {
        window.superAdminActiveTab = window.superAdminActiveTab || 'users';
    }

    const tab = window.superAdminActiveTab;

    const btnStyleUsers = tab === 'users' ? 'background: #059669; color: white; border-color: #10b981;' : 'background: #1f2937; color: #9ca3af; border-color: #374151;';
    const btnStyleTools = tab === 'tools' ? 'background: #ea580c; color: white; border-color: #f97316;' : 'background: #1f2937; color: #9ca3af; border-color: #374151;';
    const btnStyleOdds = tab === 'odds' ? 'background: #d97706; color: white; border-color: #fbbf24;' : 'background: #1f2937; color: #9ca3af; border-color: #374151;';
    const missingCount = store.missingOddsCount || 0;

    container.innerHTML = `
        <div class="leaderboard-tabs-wrapper" style="margin-bottom: 15px; width: 100%; box-sizing: border-box; display: flex; gap: 6px;">
            <button class="nav-btn-leaderboard" style="flex: 1; height: 38px; padding: 0 4px; font-size: 0.75rem; ${btnStyleUsers}" onclick="window.switchSuperAdminTab('users');">
                👥 UŽIVATELÉ
            </button>
            <button class="nav-btn-leaderboard" style="flex: 1; height: 38px; padding: 0 4px; font-size: 0.75rem; ${btnStyleTools}" onclick="window.switchSuperAdminTab('tools');">
                🔧 ZÁCHRANA
            </button>
            <button class="nav-btn-leaderboard" style="flex: 1.15; height: 38px; padding: 0 4px; font-size: 0.75rem; position: relative; ${btnStyleOdds}" onclick="window.switchSuperAdminTab('odds');">
                📊 KURZY ${missingCount > 0 ? `<span style="background:#ef4444; color:#fff; border-radius:10px; padding:1px 5px; font-size:0.65rem; margin-left:2px; font-weight:800;">${missingCount}</span>` : ''}
            </button>
        </div>
        <div id="superAdminTabContentArea" style="width:100%;"></div>
    `;

    const contentArea = document.getElementById('superAdminTabContentArea');
    if (!contentArea) return;

    if (tab === 'odds') {
        const missingList = store.missingOddsList || [];

        const harmonogramHtml = `
            <div class="bonus-collapse-box" style="margin-bottom: 12px; width: 100%;">
                <button class="bonus-collapse-trigger" onclick="const c = this.nextElementSibling; const isHidden = c.style.display === 'none'; c.style.display = isHidden ? 'block' : 'none'; this.querySelector('.arrow').innerText = isHidden ? '▲' : '▼';" style="color: #fbbf24; border-color: #d97706; font-weight: bold; background: transparent;">
                    <span>ℹ️ HARMONOGRAM AUTOMATICKÉHO STAHOVÁNÍ KURZŮ</span><span class="arrow">▼</span>
                </button>
                <div class="bonus-collapse-content" style="display: none; padding: 14px 12px; background: #111827; border-top: 1px solid #374151;">
                    <div style="display: flex; flex-direction: column; gap: 10px; font-size: 0.82rem; text-align: left;">
                        <div style="background: rgba(56, 189, 248, 0.08); border-left: 3px solid #38bdf8; padding: 8px 10px; border-radius: 4px;">
                            <strong style="color: #38bdf8; display: block; margin-bottom: 4px; font-family: 'Oswald', sans-serif;">⚽ FOTBAL (Chance Liga, Premier League, Liga mistrů, MS ve fotbale)</strong>
                            <div style="color: #cbd5e1; line-height: 1.45;">
                                • <strong style="color:#fff;">Úterý 17:00:</strong> Víkendový balík kol (zápasy od pátku do pondělí)<br>
                                • <strong style="color:#fff;">Sobota a Pondělí 04:00:</strong> Liga mistrů, vložená kola a dohrávky (zápasy od úterý do čtvrtka)
                            </div>
                        </div>
                        <div style="background: rgba(251, 191, 36, 0.08); border-left: 3px solid #fbbf24; padding: 8px 10px; border-radius: 4px;">
                            <strong style="color: #fbbf24; display: block; margin-bottom: 4px; font-family: 'Oswald', sans-serif;">🏒 HOKEJ (Tipsport Extraliga)</strong>
                            <div style="color: #cbd5e1; line-height: 1.45;">
                                • <strong style="color:#fff;">Sobota 12:00:</strong> Nedělní a pondělní kola (pokrývá zápasy do pondělí 15:00)<br>
                                • <strong style="color:#fff;">Pondělí 10:00:</strong> Úterní a středeční dopolední kola (pokrývá zápasy do středy 10:00)<br>
                                • <strong style="color:#fff;">Středa 10:00:</strong> Středeční zápasy, čtvrteční předehrávky, páteční a sobotní kola (pokrývá zápasy do soboty 12:00)
                            </div>
                        </div>
                        <div style="font-size: 0.72rem; color: #9ca3af; font-style: italic; margin-top: 2px; line-height: 1.35;">
                            💡 Zápasy jsou stahovány automaticky z Bet365 v přesně vymezených oknech. Pokud zápas nemá kurz ani po uplynutí termínu, bookmaker jej ještě nevypsal – doplň kurz ručně pomocí formuláře níže.
                        </div>
                    </div>
                </div>
            </div>
        `;

        if (missingList.length === 0) {
            contentArea.innerHTML = `
                ${harmonogramHtml}
                <div class="db-empty-msg" style="padding: 35px 15px; text-align: center; color: #34d399; font-size: 0.95rem; font-weight: bold; background: #0f172a; border: 1px solid #059669; border-radius: 12px;">
                    🎯 Všechny nadcházející zápasy mají vypsané kurzy!
                </div>
            `;
            return;
        }

        let oddsHtml = `${harmonogramHtml}<div class="missing-odds-container">`;
        const podleLig = {};
        missingList.forEach(m => {
            if (!podleLig[m.league]) podleLig[m.league] = [];
            podleLig[m.league].push(m);
        });

        Object.entries(podleLig).forEach(([lName, matches]) => {
            oddsHtml += `
                <div class="missing-odds-league-group">
                    <div class="missing-odds-league-header">
                        <span class="missing-odds-league-title">${lName}</span>
                        <span style="font-size:0.75rem; color:#f87171; font-weight:bold;">${matches.length} bez kurzu</span>
                    </div>
                    <div class="missing-odds-list">
            `;
            matches.forEach(m => {
                const d = new Date(m.datumMs);
                const dStr = `${d.getDate()}. ${d.getMonth() + 1}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                oddsHtml += `
                    <div class="missing-odds-card">
                        <div class="missing-odds-card-header">
                            <span>📅 ${dStr} • ${m.kolo || 'Zápas'}</span>
                            <span style="color:#fbbf24; font-weight:bold;">⚠️ CHYBÍ KURZ</span>
                        </div>
                        <div class="missing-odds-teams">${m.domaci} – ${m.hoste}</div>
                        <div class="missing-odds-inputs-row">
                            <div class="missing-odds-field">
                                <label>1</label>
                                <input type="number" step="0.01" min="1.01" id="admin-edit-odd-1-${m.id}" placeholder="1.85">
                            </div>
                            <div class="missing-odds-field">
                                <label>X</label>
                                <input type="number" step="0.01" min="1.01" id="admin-edit-odd-X-${m.id}" placeholder="3.40">
                            </div>
                            <div class="missing-odds-field">
                                <label>2</label>
                                <input type="number" step="0.01" min="1.01" id="admin-edit-odd-2-${m.id}" placeholder="4.20">
                            </div>
                            <button class="missing-odds-save-btn" onclick="Alpine.store('appState').selectedAdminLeague='${lName}'; window.saveMatchOdds('${m.id}')">ULOŽIT</button>
                        </div>
                    </div>
                `;
            });
            oddsHtml += `</div></div>`;
        });
        oddsHtml += `</div>`;
        contentArea.innerHTML = oddsHtml;
        return;
    }

    if (tab === 'users') {
        const uzivatele = store?.adminUsers || [];
        if (!store?.adminUsersLoaded && uzivatele.length === 0) {
            contentArea.innerHTML = '<div class="db-empty-msg">Načítám vládní soupisku... ⏳</div>';
        } else {
            window.vykresliSuperAdminUzivatele(uzivatele);
        }
    } else if (tab === 'tools') {
        const allUsers = store?.adminUsers || [];
        const adminOnlyList = allUsers.filter(u => u.isAdmin === true || u.isSuperAdmin === true);
        adminOnlyList.sort((a, b) => (a.nickname || 'Admin').localeCompare(b.nickname || 'Admin', 'cs'));

        const adminOptionsHtml = adminOnlyList.length > 0 
            ? adminOnlyList.map(u => `<option value="${u.id}">👑 ${window.escapeHTML(u.nickname || 'Admin')} (${u.email || 'bez e-mailu'})</option>`).join('')
            : '<option value="" disabled>Žádní administrátoři nenalezeni</option>';

        contentArea.innerHTML = `
            <div class="bonus-collapse-box" style="margin-top: 5px; width: 100%;">
                <button class="bonus-collapse-trigger" onclick="const c = this.nextElementSibling; const isHidden = c.style.display === 'none'; c.style.display = isHidden ? 'block' : 'none'; this.querySelector('.arrow').innerText = isHidden ? '▲' : '▼';" style="color: #ea580c; border-color: #c2410c; font-weight: bold; background: transparent;">
                    <span>🔄 PŘEVOD DAT (ZÁCHRANA BODŮ)</span><span class="arrow">▼</span>
                </button>
                <div class="bonus-collapse-content" style="display: none; padding: 18px 15px; background: #111827; border-top: 1px solid #374151;">
                    <p style="color: #9ca3af; font-size: 0.85rem; margin: 0 0 15px 0; line-height: 1.4; text-align: left;">
                        Pokud někdo ztratil přístup k původnímu přihlašovacímu e-mailu, tento asistent vyhledá veškeré jeho vyhodnocené tipy napříč soutěžemi a bezpečně je převede pod zbrusu nové ID uživatele.
                    </p>
                    <div style="margin-bottom: 12px; text-align: left;">
                        <label class="bonus-input-label" style="color: #9ca3af; font-size: 0.8rem; display: block; margin-bottom: 4px;">Starý e-mail (Ztracený / Původní):</label>
                        <input type="email" id="transfer-old-email" placeholder="stary-ucet@seznam.cz" class="bonus-text-input" style="width: 100%; box-sizing: border-box; text-align: left; padding-left: 10px; height: 40px; border-radius: 6px;">
                    </div>
                    <div style="margin-bottom: 20px; text-align: left;">
                        <label class="bonus-input-label" style="color: #9ca3af; font-size: 0.8rem; display: block; margin-bottom: 4px;">Nový e-mail (Zbrusu nový / Cílový):</label>
                        <input type="email" id="transfer-new-email" placeholder="novy-ucet@gmail.com" class="bonus-text-input" style="width: 100%; box-sizing: border-box; text-align: left; padding-left: 10px; height: 40px; border-radius: 6px;">
                    </div>
                    <button class="action-btn" onclick="window.triggerTransferFeature(event)" style="background: #ea580c; color: white; width: 100%; font-weight: bold; font-family: 'Oswald', sans-serif; letter-spacing: 0.5px; border: 1px solid #f97316; height: 44px; font-size: 0.9rem; border-radius: 8px; margin-top: 5px;">
                        🚀 SPUSTIT TRANSFÉR BODŮ
                    </button>
                </div>
            </div>

            <div class="bonus-collapse-box" style="margin-top: 12px; width: 100%;">
                <button class="bonus-collapse-trigger" onclick="const c = this.nextElementSibling; const isHidden = c.style.display === 'none'; c.style.display = isHidden ? 'block' : 'none'; this.querySelector('.arrow').innerText = isHidden ? '▲' : '▼';" style="color: #c084fc; border-color: #a855f7; font-weight: bold; background: transparent;">
                    <span>🎭 NOUZOVÝ LOUTKOVODIČ (PRO SPRÁVCE & ADMINY)</span><span class="arrow">▼</span>
                </button>
                <div class="bonus-collapse-content" style="display: none; padding: 18px 15px; background: #111827; border-top: 1px solid #374151;">
                    <p style="color: #9ca3af; font-size: 0.85rem; margin: 0 0 15px 0; line-height: 1.4; text-align: left;">
                        Umožňuje Super Adminovi spravovat a zapsat tipy nebo bonusy za administrátory a správce lig, pokud nemají přístup k zařízení nebo nastala systémová havárie.
                    </p>
                    <div style="margin-bottom: 20px; text-align: left;">
                        <label class="bonus-input-label" style="color: #9ca3af; font-size: 0.8rem; display: block; margin-bottom: 6px; font-weight: bold;">Zvolit administrátora k ovládání:</label>
                        <select id="emergency-admin-select" style="width: 100%; height: 42px; background: #0f172a; color: #ffffff; border: 1px solid #a855f7; border-radius: 8px; font-weight: bold; padding: 0 10px; box-sizing: border-box;">
                            ${adminOptionsHtml}
                        </select>
                    </div>
                    <button class="action-btn" onclick="window.triggerAdminLoutkovodic()" style="background: #9333ea; color: white; width: 100%; font-weight: bold; font-family: 'Oswald', sans-serif; letter-spacing: 0.5px; border: 1px solid #c084fc; height: 44px; font-size: 0.9rem; border-radius: 8px; margin: 0;">
                        🎭 OTEVŘÍT LOUTKOVODIČE SPRÁVCE
                    </button>
                </div>
            </div>
        `;
    }
};

window.renderSuperAdminScreen = window.renderSuperAdmin;

// 🎨 RENDERER SOUPISKY UŽIVATELŮ V SUPER ADMIN PANELU
window.vykresliSuperAdminUzivatele = (docsArray) => {
    const contentArea = document.getElementById('superAdminTabContentArea');
    if (!contentArea) return;

    contentArea.innerHTML = `
        <div style="margin-bottom: 12px; padding: 2px 0;"><p style="color: #9ca3af; font-size: 0.85rem; margin: 0; line-height: 1.4; text-align: left;">Hráči zvýraznění oranžově (⏳ ČEKÁRNA) nemají zatím přiřazenou žádnou ligu.</p></div>
        <div id="superAdminUsersRoletyWrapper" style="display: flex; flex-direction: column; gap: 8px; width: 100%;"></div>
    `;

    const wrapper = document.getElementById('superAdminUsersRoletyWrapper');
    if (!wrapper) return;

    const uzivatelePole = (docsArray || []).map(uDoc => {
        const data = typeof uDoc.data === 'function' ? uDoc.data() : uDoc;
        return { id: uDoc.id, ...data };
    });

    uzivatelePole.sort((a, b) => (a.nickname || 'Nový Hráč').localeCompare(b.nickname || 'Nový Hráč', 'cs'));

    const formatujAktivitu = (lastSeen, uid) => {
        const store = Alpine.store('appState');
        const presence = store?.communityPresenceMap?.[uid];

        if (presence?.online === true || store?.onlineUidsSet?.has(uid)) {
            return '<span style="color: #34d399; font-weight: bold; font-size: 0.75rem; font-family: monospace; display: inline-flex; align-items: center; gap: 4px;">🟢 Online</span>';
        }

        let d = null;
        if (presence && presence.lastSeen) {
            d = new Date(presence.lastSeen);
        } else if (lastSeen) {
            if (typeof lastSeen.toDate === 'function') d = lastSeen.toDate();
            else if (lastSeen.seconds) d = new Date(lastSeen.seconds * 1000);
            else d = new Date(lastSeen);
        }

        if (!d || isNaN(d.getTime())) return '<span style="color: #6b7280; font-size: 0.75rem; font-family: monospace;">⏳ Nikdy</span>';

        const cas = d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
        const nyni = new Date();
        const dnesPolnoc = new Date(nyni.getFullYear(), nyni.getMonth(), nyni.getDate());
        const vceraPolnoc = new Date(dnesPolnoc);
        vceraPolnoc.setDate(vceraPolnoc.getDate() - 1);

        if (d >= dnesPolnoc) {
            return `<span style="color: #38bdf8; font-weight: bold; font-size: 0.75rem; font-family: monospace;">Dnes ${cas}</span>`;
        } else if (d >= vceraPolnoc) {
            return `<span style="color: #fbbf24; font-size: 0.75rem; font-family: monospace;">Včera ${cas}</span>`;
        } else {
            const datumStr = `${d.getDate()}. ${d.getMonth() + 1}.`;
            return `<span style="color: #9ca3af; font-size: 0.75rem; font-family: monospace;">${datumStr} ${cas}</span>`;
        }
    };

    let counter = 0;
    uzivatelePole.forEach((data) => {
        const uid = data.id;
        const email = data.email || 'Bez e-mailu';
        const maZadnouLigu = !data.leagues || data.leagues.length === 0;
        counter++;

        let zebraBg = counter % 2 === 0 ? '#1f2937' : '#111827';
        let borderColor = '#374151';
        let badgeHtml = '';

        if (maZadnouLigu) {
            zebraBg = 'rgba(217, 119, 6, 0.15)';
            borderColor = '#f59e0b';
            badgeHtml = '<span style="color:#fbbf24; font-size:0.68rem; font-weight:bold; background:rgba(245,158,11,0.25); padding:2px 6px; border-radius:4px; border:1px solid #f59e0b;">⏳ ČEKÁRNA</span>';
        } else if (data.isAdmin) {
            badgeHtml = '<span style="color:#ef4444; font-size:0.68rem; font-weight:bold; background:rgba(239,68,68,0.15); padding:2px 6px; border-radius:4px; border:1px solid rgba(239,68,68,0.3);">ADMIN</span>';
        }

        const aktivitaHtml = formatujAktivitu(data.lastSeen, uid);

        const userRow = document.createElement('div');
        userRow.className = 'leaderboard-row-wrapper';
        userRow.id = `user-row-${uid}`;
        userRow.style.width = '100%';
        
        const surveyIcon = data.showSurveys === false ? '🔕' : '🗳️';
        const surveyTitle = data.showSurveys === false ? 'Komunitní ankety: VYPNUTO' : 'Komunitní ankety: POVOLENO';
        const notifIcon = data.notifyUntipped === true ? '🔔' : '🔕';
        const notifTitle = data.notifyUntipped === true ? 'Upozornění před výkopem: ZAPNUTO' : 'Upozornění před výkopem: VYPNUTO';

        const store = Alpine.store('appState');
        const isRich = Boolean(store?.communityPresenceMap?.[uid]?.richGraphics);
        const richIconHtml = isRich ? '<span title="Grafika: Plný režim (HD)" style="font-size: 0.82rem; line-height: 1; flex-shrink: 0; cursor: help;">🎨</span>' : '';

        userRow.innerHTML = `
            <div onclick="const det = this.nextElementSibling; const arr = this.querySelector('.super-arrow-icon'); if(det.style.display==='none'){det.style.display='flex'; arr.innerText='▲';}else{det.style.display='none'; arr.innerText='▼';}" 
                 class="leaderboard-row-trigger" style="background: ${zebraBg}; border: 1px solid ${borderColor}; cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; border-radius: 8px;">
                <div class="leaderboard-row-left" style="display:flex; align-items:center; gap:6px; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:65%;">
                    <span title="${surveyTitle}" style="font-size: 0.85rem; line-height: 1; flex-shrink: 0; cursor: help;">${surveyIcon}</span>
                    <span title="${notifTitle}" style="font-size: 0.85rem; line-height: 1; flex-shrink: 0; cursor: help;">${notifIcon}</span>
                    ${richIconHtml}
                    <strong style="color: ${maZadnouLigu ? '#fbbf24' : '#ffffff'}; font-size: 1rem; font-family: 'Oswald', sans-serif; letter-spacing: 0.3px; margin-left: 2px;">${data.nickname || 'Nový Hráč'}</strong>
                    ${badgeHtml}
                </div>
                <div class="leaderboard-row-right" style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                    ${aktivitaHtml}
                    <span class="super-arrow-icon" style="color: #9ca3af; font-size: 0.78rem;">▼</span>
                </div>
            </div>
            <div class="leaderboard-row-dropdown" style="display: none; background: #0f172a; border: 1px solid #374151; border-top: none; padding: 15px; border-radius: 0 0 8px 8px; margin-top: -4px; flex-direction: column; gap: 12px; text-align: left;">
                <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #1f2937; padding-bottom: 10px;">
                    <span style="font-size: 0.8rem; color: #9ca3af;">📧 E-mail:</span>
                    <span style="color: #f3f4f6; font-size: 0.85rem; font-family: monospace; font-weight: bold;">${email}</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 0.85rem; color: #e5e7eb; font-weight: bold;">Udělit práva Admin panelu:</span>
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: #ef4444; font-weight: bold; cursor: pointer; user-select: none;">
                        <input type="checkbox" ${data.isAdmin ? 'checked' : ''} onchange="window.toggleUserAdmin('${uid}', this.checked)" style="width: 18px; height: 18px; cursor: pointer; accent-color: #ef4444; margin: 0;"> ADMIN ROLE
                    </label>
                </div>
                <div style="border-top: 1px dashed #374151; padding-top: 12px; margin-top: 4px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #9ca3af; font-size: 0.75rem; font-weight: bold;">🚨 Smazat kompletně data hráče:</span>
                    <button class="btn-tip" style="height: 32px; width: auto; padding: 0 12px; background: #dc2626; font-size: 0.72rem; font-weight:bold; font-family:'Oswald',sans-serif;" onclick="window.purgeUserAbsolute('${uid}')">🗑️ SMAZAT ÚČET</button>
                </div>
            </div>
        `;
        wrapper.appendChild(userRow);
    });

    if (counter === 0) wrapper.innerHTML = '<div class="db-empty-msg">Žádní ostatní hráči v databázi.</div>';
};

// 🌪️ SERVEROVÝ NUCLEAR PURGE BULDOZER S BLESKOVÝM OPTIMISTICKÝM VÝMAZEM (0 ms)
window.purgeUserAbsolute = (uid) => {
    const uDoc = window.adminUsersCache?.find(docSnap => docSnap.id === uid);
    const uData = uDoc ? (typeof uDoc.data === 'function' ? uDoc.data() : uDoc) : {};
    const nickname = uData.nickname || 'Hráč';

    const modalOverlay = document.createElement('div');
    modalOverlay.style = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.85); z-index: 11000; display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);";

    modalOverlay.innerHTML = `
        <div style="background: #1f2937; border: 4px solid #dc2626; border-radius: 20px; padding: 30px 20px; max-width: 420px; width: 100%; text-align: center; box-shadow: 0 25px 60px rgba(0, 0, 0, 0.7); color: white; font-family: 'Segoe UI', sans-serif;">
            <h3 style="font-family: 'Oswald', sans-serif; color: #dc2626; font-size: 1.6rem; margin: 0 0 15px 0; text-transform: uppercase; letter-spacing: 1px;">🚨 SERVEROVÝ PURGE HRÁČE</h3>
            <p style="font-size: 0.95rem; color: #9ca3af; line-height: 1.5; margin: 0 0 25px 0;">
                Opravdu chceš trvale zničit účet hráče <span style="color: #ffffff; font-weight: bold;">${nickname}</span>?<br>
                <span style="color: #f87171; font-weight: bold;">Tato akce přes Firebase Admin SDK smaže jeho profil z Auth modulu a VŠECHNY jeho tipy i bonusy ze všech soutěží! Akce je nevratná.</span>
            </p>
            <div style="display: flex; gap: 12px; justify-content: center;">
                <button id="purge-modal-cancel" style="background: #4b5563; color: white; border: none; padding: 12px 20px; border-radius: 8px; font-weight: bold; font-size: 0.9rem; cursor: pointer; text-transform: uppercase;">Zrušit</button>
                <button id="purge-modal-confirm" style="background: #dc2626; color: white; border: none; padding: 12px 20px; border-radius: 8px; font-weight: bold; font-size: 0.9rem; cursor: pointer; text-transform: uppercase;">ODPÁLIT PURGE</button>
            </div>
        </div>
    `;

    document.body.appendChild(modalOverlay);
    modalOverlay.querySelector('#purge-modal-cancel').onclick = () => { modalOverlay.remove(); };

    modalOverlay.querySelector('#purge-modal-confirm').onclick = async () => {
        modalOverlay.remove();

        const rowEl = document.getElementById(`user-row-${uid}`);
        if (rowEl) rowEl.remove();

        if (window.adminUsersCache) {
            window.adminUsersCache = window.adminUsersCache.filter(d => d.id !== uid);
        }
        const store = Alpine.store('appState');
        if (store && store.adminUsers) {
            store.adminUsers = store.adminUsers.filter(u => u.id !== uid);
        }

        window.showToast("⏳ Serverový buldozer startuje...", false);

        try {
            const purgeUserCF = httpsCallable(window.functions, 'purgeUserAbsoluteCF');
            await purgeUserCF({ targetUid: uid });
            window.showToast("🗑️ Účet i veškerá herní data kompletně smazána!");
        } catch (error) {
            console.error("Chyba při exekuci Nuclear Purge:", error);
            window.showToast("❌ Selhalo serverové mazání.", true);
            if (typeof window.renderSuperAdmin === 'function') window.renderSuperAdmin();
        }
    };
};

// 🔑 ADMIN: VYKRESLENÍ ZÁCHRANY BODŮ A REKALKULACE V ADMIN PANELU
window.renderAdminRecovery = () => {
    const container = document.getElementById('adminRecoveryContainer');
    if (!container) return;

    container.innerHTML = `
        <div class="bonus-collapse-box" style="margin-top: 5px; width: 100%;">
            <button class="bonus-collapse-trigger" onclick="const c = this.nextElementSibling; const isHidden = c.style.display === 'none'; c.style.display = isHidden ? 'block' : 'none'; this.querySelector('.arrow').innerText = isHidden ? '▲' : '▼';" style="color: #ea580c; border-color: #c2410c; font-weight: bold; background: transparent;">
                <span>🔄 PŘEVOD DAT (ZÁCHRANA BODŮ)</span><span class="arrow">▼</span>
            </button>
            <div class="bonus-collapse-content" style="display: none; padding: 18px 15px; background: #111827; border-top: 1px solid #374151;">
                <p style="color: #9ca3af; font-size: 0.85rem; margin: 0 0 15px 0; line-height: 1.4; text-align: left;">
                    Pokud někdo ztratil přístup k původnímu přihlašovacímu e-mailu, tento asistent vyhledá veškeré jeho vyhodnocené tipy napříč soutěžemi a bezpečně je převede pod zbrusu nové ID uživatele.
                </p>
                <div style="margin-bottom: 12px; text-align: left;">
                    <label class="bonus-input-label" style="color: #9ca3af; font-size: 0.8rem; display: block; margin-bottom: 4px;">Starý e-mail (Ztracený / Původní):</label>
                    <input type="email" id="transfer-old-email" placeholder="stary-ucet@seznam.cz" class="bonus-text-input" style="width: 100%; box-sizing: border-box; text-align: left; padding-left: 10px; height: 40px; border-radius: 6px;">
                </div>
                <div style="margin-bottom: 20px; text-align: left;">
                    <label class="bonus-input-label" style="color: #9ca3af; font-size: 0.8rem; display: block; margin-bottom: 4px;">Nový e-mail (Zbrusu nový / Cílový):</label>
                    <input type="email" id="transfer-new-email" placeholder="novy-ucet@gmail.com" class="bonus-text-input" style="width: 100%; box-sizing: border-box; text-align: left; padding-left: 10px; height: 40px; border-radius: 6px;">
                </div>
                <button class="action-btn" onclick="window.triggerTransferFeature(event)" style="background: #ea580c; color: white; width: 100%; font-weight: bold; font-family: 'Oswald', sans-serif; letter-spacing: 0.5px; border: 1px solid #f97316; height: 44px; font-size: 0.9rem; border-radius: 8px; margin-top: 5px;">
                    🚀 SPUSTIT TRANSFÉR BODŮ
                </button>
            </div>
        </div>
    `;
};

// 🔮 OSTRÝ SPOUŠTĚČ PŘEVODU BODŮ (ZÁCHRANA BODŮ MEZI ÚČTY)
window.triggerTransferFeature = async (event) => {
    const staryEmail = document.getElementById('transfer-old-email').value.trim();
    const novyEmail = document.getElementById('transfer-new-email').value.trim();

    if (!staryEmail || !novyEmail) {
        window.showToast("⚠️ Musíš vyplnit oba e-maily pro přesun dat!", true);
        return;
    }

    const kliknuteTlacitko = event?.target;
    if (kliknuteTlacitko && kliknuteTlacitko.tagName === "BUTTON") {
        kliknuteTlacitko.disabled = true;
        kliknuteTlacitko.style.opacity = "0.5";
        kliknuteTlacitko.innerText = "⏳ PŘELÉVÁM BODY...";
    }

    window.showToast("🔮 Spouštím transfér herních dat na serveru...", false);

    try {
        const transferUserData = httpsCallable(window.functions, 'transferUserDataCF');

        const res = await transferUserData({
            oldEmail: staryEmail,
            newEmail: novyEmail,
            sezonaId: window.SEZONA_ID
        });

        window.showToast(`🚀 ${res.data.message}`);
        document.getElementById('transfer-old-email').value = '';
        document.getElementById('transfer-new-email').value = '';

    } catch (error) {
        console.error("Chyba transféru dat:", error);
        window.showToast(`❌ ${error.message || "Server přesun bodů odmítl."}`, true);
    } finally {
        if (kliknuteTlacitko && kliknuteTlacitko.tagName === "BUTTON") {
            kliknuteTlacitko.disabled = false;
            kliknuteTlacitko.style.opacity = "1";
            kliknuteTlacitko.innerText = "🚀 SPUSTIT TRANSFÉR BODŮ";
        }
    }
};

// 🌋 ADMIN: VYKRESLENÍ REKALKULACE ŽEBŘÍČKU V ADMIN PANELU
window.renderAdminRecalc = () => {
    const container = document.getElementById('adminRecalcContainer');
    if (!container) return;

    container.innerHTML = `
        <div style="background: #1f2937; border: 1px solid #374151; border-radius: 12px; padding: 20px; box-sizing: border-box; width: 100%; text-align: left;">
            <h3 style="color: #f87171; font-family: 'Oswald', sans-serif; margin-top: 0; margin-bottom: 10px; font-size: 1.1rem; text-transform: uppercase;">🌋 Generální rekalkulace žebříčku</h3>
            <p style="color: #d1d5db; font-size: 0.88rem; margin: 0 0 15px 0; line-height: 1.4;">
                Vynutí kompletní přepočítání tabulky a statistik všech hráčů od nuly na základě aktuálně zapsaných výsledků a historických tipů.
            </p>
            <div style="margin-bottom: 15px;">
                <label style="color: #9ca3af; font-size: 0.8rem; display: block; margin-bottom: 5px; font-weight: bold;">Zvolit soutěž k přepočtu:</label>
                <select id="recalc-league-select" style="width: 100%; height: 42px; background: #111827; color: #ffffff; border: 1px solid #4b5563; border-radius: 8px; font-weight: bold; padding: 0 10px; box-sizing: border-box;">
                    <option value="MS v hokeji">🏒 MS V HOKEJI</option>
                    <option value="MS ve fotbale" selected>⚽ MS VE FOTBALE</option>
                    <option value="Tipsport Extraliga">🏒 TIPSPORT EXTRALIGA</option>
                    <option value="Chance Liga">⚽ CHANCE LIGA</option>
                    <option value="Premier League">⚽ PREMIER LEAGUE</option>
                    <option value="Liga mistrů">⚽ LIGA MISTRŮ</option>
                </select>
            </div>
            <button id="global-recalc-btn" class="action-btn" onclick="window.triggerGlobalRecalculation()" style="background: #dc2626; color: white; width: 100%; font-weight: bold; font-family: 'Oswald', sans-serif; height: 44px; font-size: 0.9rem; border-radius: 8px; margin: 0; cursor: pointer;">
                🌋 VYNUTIT PŘEPOČET ŽEBŘÍČKU
            </button>
        </div>
    `;
};

window.triggerGlobalRecalculation = async () => {
    const leagueSelect = document.getElementById('recalc-league-select');
    const leagueName = leagueSelect ? leagueSelect.value : '';
    const btn = document.getElementById('global-recalc-btn');

    if (!leagueName) return;

    if (btn) {
        btn.disabled = true;
        btn.style.opacity = "0.5";
        btn.innerText = "⏳ PŘEPOČÍTÁVÁM...";
    }

    window.showToast("🌋 Spouštím generální přepočet tabulky...", false);

    try {
        const recalculateLeaderboard = httpsCallable(window.functions, 'recalculateLeaderboardCF');
        await recalculateLeaderboard({ leagueName: leagueName });

        window.tipniToCache = { histories: {}, spy: {} };
        window.showToast("⚡ Žebříček úspěšně kompletně přepočítán!");
    } catch (err) {
        console.error("Chyba přepočtu žebříčku:", err);
        window.showToast(`❌ Chyba: ${err.message || "Server přepočet odmítl."}`, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = "1";
            btn.innerText = "🌋 VYNUTIT PŘEPOČET ŽEBŘÍČKU";
        }
    }
};

// =========================================================================
// 🎭 LOUTKOVODIČ REAKTIVNÍ CONTROLLER
// =========================================================================
window.triggerAdminLoutkovodic = () => {
    const sel = document.getElementById('emergency-admin-select');
    const selectedUid = sel ? sel.value : null;
    if (!selectedUid) {
        window.showToast("⚠️ Nejprve vyber administrátora ze seznamu!", true);
        return;
    }
    window.openLoutkovodicModal(selectedUid, true);
};

window.openLoutkovodicModal = (uid, allowAdmin = false) => {
    const store = Alpine.store('appState');
    if (!store) return;

    const cachedDoc = window.adminUsersCache?.find(docSnap => docSnap.id === uid);
    const cachedData = cachedDoc ? (typeof cachedDoc.data === 'function' ? cachedDoc.data() : cachedDoc) : {};
    const uItem = store.adminUsers?.find(u => u.id === uid) 
               || store.adminUsersCache?.find(u => u.id === uid)
               || cachedData || {};
    
    if (!allowAdmin && (uItem.isAdmin || uItem.isSuperAdmin)) {
        window.showToast("⛔ Loutkovodič je pro účty administrátorů zakázán! (Použij záložku Záchrana bodů)", true);
        return;
    }

    window.isAppFormDirty = false;
    if (window.dirtyInputsRegistry) window.dirtyInputsRegistry.clear();

    store.loutkovodicTargetUid = uid;
    store.loutkovodicTargetNickname = uItem.nickname || 'Hráč';
    store.loutkovodicTargetEmail = uItem.email || '';
    store.loutkovodicSelectedLeague = '';
    store.loutkovodicBonusVitez = '';
    store.loutkovodicBonusStrelec = '';
    store.loutkovodicBonusKanadske = '';
    store.loutkovodicInitialBonusVitez = '';
    store.loutkovodicInitialBonusStrelec = '';
    store.loutkovodicInitialBonusKanadske = '';
    store.loutkovodicBonusOpen = false;
    store.loutkovodicMatches = [];
    store.loutkovodicMatchesLoaded = false;
    
    store.loutkovodicReturnScreen = store.currentScreen || 'adminScreen';
    window.goToScreen('loutkovodicScreen');
};

window.loadLoutkovodicLeagueData = async () => {
    const store = Alpine.store('appState');
    if (!store || !store.loutkovodicSelectedLeague) return;

    store.loutkovodicMatchesLoaded = false;
    store.loutkovodicMatches = [];
    store.loutkovodicBonusOpen = false;

    try {
        const leagueName = store.loutkovodicSelectedLeague;
        const ligaKlic = leagueName.replace(/ /g, '_');
        const uid = store.loutkovodicTargetUid;
        const sezonaId = store.activeSeason || window.SEZONA_ID || "2026_2027";

        let rozpisData = null;
        if (store.selectedLeague === leagueName && store.rozpisData) {
            rozpisData = store.rozpisData;
        }

        const userSezonaRef = doc(window.db, 'users', uid, 'sezony', sezonaId);
        const sezonaSnap = await getDoc(userSezonaRef);

        if (!rozpisData) {
            const R2_BASE_URL = CONFIG.R2_BASE_URL;
            const keshRazitko = Math.floor(Date.now() / 30000);
            try {
                const res = await fetch(`${R2_BASE_URL}/sezony/${sezonaId}/${ligaKlic}/rozpis.json?v=${keshRazitko}`);
                if (res.ok) {
                    rozpisData = await res.json();
                }
            } catch (e) {
                console.error("Chyba načtení R2 v Loutkovodiči:", e);
            }
        }

        if (!rozpisData || !rozpisData.zapasyMapa) {
            store.loutkovodicMatches = [];
            store.loutkovodicMatchesLoaded = true;
            return;
        }

        const zapasyMapa = rozpisData.zapasyMapa || {};
        const sezonaData = sezonaSnap.exists() ? (sezonaSnap.data() || {}) : {};
        const souteze = sezonaData.souteze || {};
        const soutezData = souteze[ligaKlic] || {};

        const bonusData = soutezData.bonusy || { vitez: '', strelec: '' };
        const existujiciTipy = soutezData.tipy || {};

        const vitezInit = (bonusData.vitez || '').trim();
        const strelecInit = (bonusData.strelec || '').trim();
        const kanadskeInit = (bonusData.kanadske || '').trim();

        store.loutkovodicBonusVitez = vitezInit;
        store.loutkovodicBonusStrelec = strelecInit;
        store.loutkovodicBonusKanadske = kanadskeInit;
        store.loutkovodicInitialBonusVitez = vitezInit;
        store.loutkovodicInitialBonusStrelec = strelecInit;
        store.loutkovodicInitialBonusKanadske = kanadskeInit;

        const serazeneZapasy = Object.keys(zapasyMapa).map(id => {
            const match = zapasyMapa[id] || {};
            const tip = existujiciTipy[id] || {};
            const dom = match.domaci || match.home || match.domaci_nazev || match.team1 || '';
            const hos = match.hoste || match.away || match.hoste_nazev || match.team2 || '';
            return {
                id,
                ...match,
                domaci: dom,
                hoste: hos,
                tip_domaci: tip.tip_domaci !== undefined ? String(tip.tip_domaci) : '',
                tip_hoste: tip.tip_hoste !== undefined ? String(tip.tip_hoste) : '',
                saved_domaci: tip.tip_domaci !== undefined ? String(tip.tip_domaci) : '',
                saved_hoste: tip.tip_hoste !== undefined ? String(tip.tip_hoste) : '',
                postup: tip.postup || '',
                saved_postup: tip.postup || '',
                hasTip: tip.tip_domaci !== undefined
            };
        });

        serazeneZapasy.sort((a, b) => {
            const dA = a.datum?.toDate ? a.datum.toDate() : new Date(a.datum || 0);
            const dB = b.datum?.toDate ? b.datum.toDate() : new Date(b.datum || 0);
            return dA - dB;
        });

        store.loutkovodicMatches = serazeneZapasy;
        store.loutkovodicMatchesLoaded = true;
        
        if (serazeneZapasy.length > 0) {
            const kolaSeznam = store.unikatniKolaLoutkovodic || [];
            const prveNeukoncene = serazeneZapasy.find(m => (m.vysledek_domaci === undefined || m.apiStatus === "IN_PLAY" || m.apiStatus === "PAUSED") && m.apiStatus !== "POSTPONED");
            
            if (prveNeukoncene) {
                const nazevKola = window.prelozFaziTurnaje(prveNeukoncene.stage, prveNeukoncene.kolo, prveNeukoncene.isPlayoff);
                const idx = kolaSeznam.indexOf(nazevKola);
                store.loutkovodicKolaIndex = idx !== -1 ? idx : 0;
            } else {
                store.loutkovodicKolaIndex = Math.max(0, kolaSeznam.length - 1);
            }
        }

    } catch (err) {
        console.error(err);
        store.loutkovodicMatchesLoaded = true;
    }
};

window.posunKoloLoutkovodic = (smer) => {
    const store = Alpine.store('appState');
    if (!store || !store.unikatniKolaLoutkovodic || store.unikatniKolaLoutkovodic.length === 0) return;
    let novyIndex = store.loutkovodicKolaIndex + smer;
    if (novyIndex >= 0 && novyIndex < store.unikatniKolaLoutkovodic.length) {
        store.loutkovodicKolaIndex = novyIndex;
    }
};

window.handleProxyScoreChange = (matchId, isPlayoff) => {
    const store = Alpine.store('appState');
    const match = store?.loutkovodicMatches?.find(m => m.id === matchId);
    if (!match) return;

    const klicDom = `proxy-tip-domaci-${matchId}`;
    const klicHos = `proxy-tip-hoste-${matchId}`;

    const selD = document.getElementById(klicDom);
    const selH = document.getElementById(klicHos);
    const d = match.tip_domaci;
    const h = match.tip_hoste;
    const savedD = String(match.saved_domaci || '');
    const savedH = String(match.saved_hoste || '');

    if (selD) {
        if (d === '') selD.style.color = '#ef4444';
        else if (savedD !== '' && parseInt(d) === parseInt(savedD)) selD.style.color = '#ffffff';
        else selD.style.color = '#facc15';
    }

    if (selH) {
        if (h === '') selH.style.color = '#ef4444';
        else if (savedH !== '' && parseInt(h) === parseInt(savedH)) selH.style.color = '#ffffff';
        else selH.style.color = '#facc15';
    }

    if (String(d || '') !== savedD) {
        window.dirtyInputsRegistry.add(klicDom);
    } else {
        window.dirtyInputsRegistry.delete(klicDom);
    }

    if (String(h || '') !== savedH) {
        window.dirtyInputsRegistry.add(klicHos);
    } else {
        window.dirtyInputsRegistry.delete(klicHos);
    }

    const leagueName = store?.loutkovodicSelectedLeague || '';
    const vyzadujeOt = (isPlayoff && leagueName !== "Liga mistrů") || (leagueName === "Tipsport Extraliga");
    if (vyzadujeOt) {
        if (match.tip_domaci === "" || match.tip_hoste === "" || parseInt(match.tip_domaci) !== parseInt(match.tip_hoste)) {
            match.postup = '';
            window.dirtyInputsRegistry.delete(`proxy-postup-${matchId}`);
        }
    }

    window.isAppFormDirty = (window.dirtyInputsRegistry.size > 0);
};

window.selectProxyPlayoff = (matchId, choice) => {
    const store = Alpine.store('appState');
    const match = store?.loutkovodicMatches?.find(m => m.id === matchId);
    if (!match) return;

    match.postup = choice;

    const klicRegistru = `proxy-postup-${matchId}`;
    if (choice !== (match.saved_postup || '')) {
        window.dirtyInputsRegistry.add(klicRegistru);
    } else {
        window.dirtyInputsRegistry.delete(klicRegistru);
    }

    window.isAppFormDirty = (window.dirtyInputsRegistry.size > 0);
};

// 🗑️ LOUTKOVODIČ: Okamžitý reset tipu zpět na ? : ? (smazání)
window.resetProxyTip = (matchId) => {
    const store = Alpine.store('appState');
    const match = store?.loutkovodicMatches?.find(m => m.id === matchId);
    if (!match) return;

    match.tip_domaci = '';
    match.tip_hoste = '';
    match.postup = '';
    match.isDeleted = true;

    const klicDom = `proxy-tip-domaci-${matchId}`;
    const klicHos = `proxy-tip-hoste-${matchId}`;
    const klicPostup = `proxy-postup-${matchId}`;

    const selD = document.getElementById(klicDom);
    const selH = document.getElementById(klicHos);
    if (selD) { selD.value = ''; selD.style.color = '#ef4444'; }
    if (selH) { selH.value = ''; selH.style.color = '#ef4444'; }

    if (match.saved_domaci !== '') {
        window.dirtyInputsRegistry.add(klicDom);
        window.dirtyInputsRegistry.add(klicHos);
    } else {
        window.dirtyInputsRegistry.delete(klicDom);
        window.dirtyInputsRegistry.delete(klicHos);
    }
    window.dirtyInputsRegistry.delete(klicPostup);

    window.isAppFormDirty = (window.dirtyInputsRegistry.size > 0);
};

window.submitProxyData = async () => {
    const store = Alpine.store('appState');
    if (!store) return;

    const uid = store.loutkovodicTargetUid;
    const email = store.loutkovodicTargetEmail;
    const leagueName = store.loutkovodicSelectedLeague;
    const btn = document.getElementById('proxy-submit-btn');

    if (!uid || !leagueName) return;

    const isBonusOpen = Boolean(store.loutkovodicBonusOpen);
    const vitezVal = (store.loutkovodicBonusVitez || '').trim();
    const strelecVal = (store.loutkovodicBonusStrelec || '').trim();
    const kanadskeVal = (store.loutkovodicBonusKanadske || '').trim();

    const vitezChanged = isBonusOpen && (vitezVal !== (store.loutkovodicInitialBonusVitez || ''));
    const strelecChanged = isBonusOpen && (strelecVal !== (store.loutkovodicInitialBonusStrelec || ''));
    const kanadskeChanged = isBonusOpen && (kanadskeVal !== (store.loutkovodicInitialBonusKanadske || ''));
    const bonusZmenen = isBonusOpen && (vitezChanged || strelecChanged || kanadskeChanged);

    const tipyMapa = {};
    let chybajuciPostup = false;
    const isExtraliga = (leagueName === "Tipsport Extraliga");

    const matches = store.loutkovodicMatches || [];
    matches.forEach(match => {
        const dVal = (match.tip_domaci !== undefined && match.tip_domaci !== null) ? String(match.tip_domaci).trim() : '';
        const hVal = (match.tip_hoste !== undefined && match.tip_hoste !== null) ? String(match.tip_hoste).trim() : '';
        const postupVal = match.postup || '';

        // 🗑️ Požadavek na smazání existujícího tipu
        if (match.isDeleted && match.saved_domaci !== '') {
            tipyMapa[match.id] = { isDeleted: true };
            return;
        }

        if (dVal !== "" && hVal !== "") {
            const dNum = parseInt(dVal, 10);
            const hNum = parseInt(hVal, 10);

            const vyzadujeOt = (match.isPlayoff && leagueName !== "Liga mistrů") || isExtraliga;
            if (dNum === hNum && vyzadujeOt && !postupVal) {
                chybajuciPostup = true;
            }

            const jeZmena = (dVal !== (match.saved_domaci || '')) || 
                            (hVal !== (match.saved_hoste || '')) || 
                            (postupVal !== (match.saved_postup || ''));

            if (jeZmena) {
                tipyMapa[match.id] = {
                    tip_domaci: dNum,
                    tip_hoste: hNum,
                    postup: postupVal
                };
            }
        } else if (match.saved_domaci !== '' && (dVal === "" || hVal === "")) {
            // Hráč nebo admin ručně shodil některou z roletek na ?
            tipyMapa[match.id] = { isDeleted: true };
        }
    });

    if (chybajuciPostup) {
        window.showToast("🏆 V play-off musíš při remíze zvolit postupujícího!", true);
        return;
    }

    const pocetZmen = Object.keys(tipyMapa).length;
    if (pocetZmen === 0 && !bonusZmenen) {
        window.showToast("ℹ️ Nebyly provedeny žádné změny k uložení.");
        window.isAppFormDirty = false;
        store.loutkovodicOpen = false;
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.style.opacity = "0.5";
        btn.innerText = "⏳...";
    }

    window.showToast(`⏳ Zapisuji ${pocetZmen} změněných tipů přes Cloud...`, false);

    try {
        const saveProxyData = httpsCallable(window.functions, 'saveProxyDataCF');

        await saveProxyData({
            targetUid: uid,
            targetEmail: email,
            leagueName: leagueName,
            updateBonus: bonusZmenen,
            vitez: bonusZmenen ? vitezVal : undefined,
            strelec: bonusZmenen ? strelecVal : undefined,
            kanadske: bonusZmenen ? kanadskeVal : undefined,
            tipyMapa: tipyMapa,
            sezonaId: store.activeSeason || window.SEZONA_ID || "2026_2027"
        });

        window.tipniToCache = { histories: {}, spy: {} };
        window.showToast(`🎭 Data úspěšně uložena (${pocetZmen} změněných tipů)!`);
        window.isAppFormDirty = false;
        window.goToScreen(store.loutkovodicReturnScreen || 'adminScreen');

    } catch (err) {
        console.error(err);
        window.showToast("❌ Server proxy zápis odmítl.", true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = "1";
            btn.innerText = "💾 ZAPSAT";
        }
    }
};

window.closeLoutkovodicScreen = () => {
    const store = Alpine.store('appState');
    if (window.isAppFormDirty) {
        if (typeof window.zobrazVarovnyModal === 'function') {
            window.zobrazVarovnyModal(() => {
                window.isAppFormDirty = false;
                window.goToScreen(store?.loutkovodicReturnScreen || 'adminScreen');
            });
        } else {
            window.isAppFormDirty = false;
            window.goToScreen(store?.loutkovodicReturnScreen || 'adminScreen');
        }
    } else {
        window.goToScreen(store?.loutkovodicReturnScreen || 'adminScreen');
    }
};

// =========================================================================
// 🏴󠁧󠁢󠁥󠁮󠁧󠁿 PREMIER LEAGUE & TOP ZÁPASY AUTONOMNÍ GENERÁTOR
// =========================================================================

const PL_BASKETS = {
    basket1: [
        "man city", "manchester city", "man. city", "mancity",
        "arsenal",
        "liverpool",
        "man united", "manchester united", "man. united", "man utd", "man. utd", "manunited",
        "aston villa", "villa",
        "chelsea"
    ],
    big5: [
        "man city", "manchester city", "man. city",
        "arsenal",
        "liverpool",
        "man united", "manchester united", "man. united", "man utd", "man. utd",
        "chelsea"
    ],
    basket2: [
        "newcastle", "newcastle united", "newcastle utd",
        "brighton", "brighton & hove albion", "brighton and hove albion",
        "tottenham", "tottenham hotspur", "spurs",
        "brentford",
        "crystal palace", "palace",
        "bournemouth", "afc bournemouth", "bournemouth",
        "fulham"
    ],
    basket3: [
        "everton",
        "nottingham", "nottingham forest", "forest",
        "sunderland",
        "leeds", "leeds united", "leeds utd",
        "ipswich", "ipswich town",
        "coventry", "coventry city",
        "hull", "hull city"
    ]
};

const PL_DERBY_PAIRINGS = [
    ["arsenal", "tottenham hotspur"], ["arsenal", "tottenham"],
    ["chelsea", "tottenham hotspur"], ["chelsea", "tottenham"],
    ["liverpool", "everton"],
    ["newcastle united", "sunderland"], ["newcastle", "sunderland"],
    ["brighton & hove albion", "crystal palace"], ["brighton", "crystal palace"],
    ["brentford", "fulham"],
    ["chelsea", "fulham"],
    ["chelsea", "brentford"],
    ["leeds united", "hull city"], ["leeds", "hull"]
];

const PL_NORM = (str) => String(str || '').toLowerCase().trim();

const PL_URCI_KOS = (tym) => {
    const t = PL_NORM(tym);
    if (PL_BASKETS.basket1.some(x => t.includes(x) || x.includes(t))) return 1;
    if (PL_BASKETS.basket2.some(x => t.includes(x) || x.includes(t))) return 2;
    return 3;
};

const PL_JE_BIG5 = (tym) => {
    const t = PL_NORM(tym);
    return PL_BASKETS.big5.some(x => t.includes(x) || x.includes(t));
};

// 1. OTEVŘENÍ MODÁLU - ZOBRAZENÍ AKTUÁLNÍHO STAVU Z DATABÁZE
window.spustGeneratorTopZapasu = async () => {
    const store = Alpine.store('appState');
    const activeAdminLeague = store?.selectedAdminLeague;

    if (!activeAdminLeague) {
        alert("Nejprve vyber soutěž k administraci! 🧐");
        return;
    }

    const zapasy = store.adminMatches || [];
    if (zapasy.length === 0) {
        alert("V této lize nebyly nalezeny žádné zápasy! 🧐");
        return;
    }

    document.querySelectorAll('.spy-modal-overlay:not(#loutkovodic-modal):not(#reorder-leagues-modal)').forEach(el => el.remove());

    const kolaMapa = {};
    const tymStats = {};

    zapasy.forEach(m => {
        const nazevKola = window.prelozFaziTurnaje(m.stage, m.kolo, m.isPlayoff);
        if (!kolaMapa[nazevKola]) kolaMapa[nazevKola] = [];
        kolaMapa[nazevKola].push(m);

        const d = String(m.domaci || 'Neznámý').trim();
        const h = String(m.hoste || 'Neznámý').trim();

        if (!tymStats[d]) tymStats[d] = { count: 0, matches: [] };
        if (!tymStats[h]) tymStats[h] = { count: 0, matches: [] };

        if (m.isTopMatch) {
            tymStats[d].count++;
            tymStats[d].matches.push({ kolo: nazevKola, protivnik: h });

            tymStats[h].count++;
            tymStats[h].matches.push({ kolo: nazevKola, protivnik: d });
        }
    });

    const aktualniTopMatchIds = zapasy.filter(m => m.isTopMatch).map(m => m.id);
    const seznamKol = Object.keys(kolaMapa);

    window.otevriTopMatchesDashboardModal(tymStats, aktualniTopMatchIds.length, seznamKol.length, false);
};

// 2. DYNAMICKÝ GENERÁTOR SE 3 PÁKAMI VARIABILITY
window.generujNoveTopZapasy = async () => {
    const store = Alpine.store('appState');
    const activeAdminLeague = store?.selectedAdminLeague;
    const zapasy = store?.adminMatches || [];

    if (!activeAdminLeague || zapasy.length === 0) return;

    document.querySelectorAll('.spy-modal-overlay:not(#loutkovodic-modal):not(#reorder-leagues-modal)').forEach(el => el.remove());
    window.showToast("⚡ Generuji nový unikátní návrh TOP zápasů...", false);

    const kolaMapa = {};
    zapasy.forEach(m => {
        const nazevKola = window.prelozFaziTurnaje(m.stage, m.kolo, m.isPlayoff);
        if (!kolaMapa[nazevKola]) kolaMapa[nazevKola] = [];
        kolaMapa[nazevKola].push(m);
    });

    const seznamKol = Object.keys(kolaMapa);
    const totalRounds = seznamKol.length;

    const prevProposalIds = window.vygenerovaneTopMatchIdsCache || [];
    const bannedMatchIds = new Set();
    if (prevProposalIds.length > 0) {
        const shufflePrev = [...prevProposalIds].sort(() => Math.random() - 0.5);
        const banCount = Math.floor(Math.random() * 2) + 2;
        for (let b = 0; b < Math.min(banCount, shufflePrev.length); b++) {
            bannedMatchIds.add(shufflePrev[b]);
        }
    }

    const seedTeamBonus = {};
    zapasy.forEach(m => {
        const d = String(m.domaci || '').trim();
        const h = String(m.hoste || '').trim();
        if (!seedTeamBonus[d]) seedTeamBonus[d] = Math.random() * 45;
        if (!seedTeamBonus[h]) seedTeamBonus[h] = Math.random() * 45;
    });

    const calcMatchBaseScore = (z) => {
        const d = String(z.domaci || '').trim();
        const h = String(z.hoste || '').trim();
        const kosD = PL_URCI_KOS(d);
        const kosH = PL_URCI_KOS(h);

        let score = 0;
        if (kosD === kosH) {
            if (kosD === 1) score += 500;
            else if (kosD === 2) score += 300;
            else score += 150;
        } else if ((kosD === 2 && kosH === 3) || (kosD === 3 && kosH === 2)) {
            score += 40;
        } else {
            score += 10;
        }

        const jeDerby = PL_DERBY_PAIRINGS.some(pair => {
            const p0 = PL_NORM(pair[0]); const p1 = PL_NORM(pair[1]);
            const nd = PL_NORM(d); const nh = PL_NORM(h);
            return (nd.includes(p0) && nh.includes(p1)) || (nd.includes(p1) && nh.includes(p0));
        });
        if (jeDerby) score += 100;

        score += (seedTeamBonus[d] || 0) + (seedTeamBonus[h] || 0);
        return score;
    };

    const runTieredBottleneckPass = () => {
        const vybraneMapa = {};
        const tymCount = {};
        const tymPosledniKolo = {};
        const odehraneDvojice = new Set();
        let totalScore = 0;

        const roundData = seznamKol.map((roundName, rIdx) => {
            const matches = kolaMapa[roundName] || [];
            const inBasketMatches = matches.filter(z => PL_URCI_KOS(z.domaci) === PL_URCI_KOS(z.hoste));
            return {
                roundName,
                rIdx,
                strictCount: inBasketMatches.length,
                allMatches: matches
            };
        });

        const prioritizedRounds = [...roundData].sort((a, b) => {
            if (a.strictCount !== b.strictCount) {
                return a.strictCount - b.strictCount;
            }
            return (b.rIdx - a.rIdx) + (Math.random() * 6 - 3);
        });

        for (const rInfo of prioritizedRounds) {
            const rIdx = rInfo.rIdx;
            const roundName = rInfo.roundName;
            const matches = rInfo.allMatches;

            let vybranyZapas = null;

            for (let tier = 1; tier <= 4; tier++) {
                let bestMatch = null;
                let bestVal = -Infinity;

                for (const z of matches) {
                    if (bannedMatchIds.has(z.id) && tier < 4) continue;

                    const d = String(z.domaci || '').trim();
                    const h = String(z.hoste || '').trim();
                    const kosD = PL_URCI_KOS(d);
                    const kosH = PL_URCI_KOS(h);
                    const dvojiceKlic = [PL_NORM(d), PL_NORM(h)].sort().join(' vs ');

                    const cD = tymCount[d] || 0;
                    const cH = tymCount[h] || 0;

                    if ((kosD === 1 && kosH === 3) || (kosD === 3 && kosH === 1)) continue;
                    if (cD >= 4 || cH >= 4) continue;
                    if (odehraneDvojice.has(dvojiceKlic)) continue;

                    if (tier === 1) {
                        if (kosD !== kosH) continue;
                        if (tymPosledniKolo[d] !== undefined && Math.abs(rIdx - tymPosledniKolo[d]) < 3) continue;
                        if (tymPosledniKolo[h] !== undefined && Math.abs(rIdx - tymPosledniKolo[h]) < 3) continue;
                    } else if (tier === 2) {
                        if (kosD !== kosH) continue;
                        if (tymPosledniKolo[d] !== undefined && Math.abs(rIdx - tymPosledniKolo[d]) < 2) continue;
                        if (tymPosledniKolo[h] !== undefined && Math.abs(rIdx - tymPosledniKolo[h]) < 2) continue;
                    } else if (tier === 3) {
                        if (kosD === 1 || kosH === 1) continue;
                        if (!((kosD === 2 && kosH === 3) || (kosD === 3 && kosH === 2))) continue;
                        if (tymPosledniKolo[d] !== undefined && Math.abs(rIdx - tymPosledniKolo[d]) < 2) continue;
                        if (tymPosledniKolo[h] !== undefined && Math.abs(rIdx - tymPosledniKolo[h]) < 2) continue;
                    } else if (tier === 4) {
                        if (tymPosledniKolo[d] !== undefined && Math.abs(rIdx - tymPosledniKolo[d]) < 1) continue;
                        if (tymPosledniKolo[h] !== undefined && Math.abs(rIdx - tymPosledniKolo[h]) < 1) continue;
                    }

                    let score = calcMatchBaseScore(z);

                    if (kosD === 1 && cD < 4) score += (4 - cD) * 100;
                    if (kosH === 1 && cH < 4) score += (4 - cH) * 100;
                    if (cD < 3) score += (3 - cD) * 50;
                    if (cH < 3) score += (3 - cH) * 50;

                    score += Math.random() * 30;

                    if (score > bestVal) {
                        bestVal = score;
                        bestMatch = z;
                    }
                }

                if (bestMatch) {
                    vybranyZapas = bestMatch;
                    break;
                }
            }

            if (vybranyZapas) {
                const d = String(vybranyZapas.domaci || '').trim();
                const h = String(vybranyZapas.hoste || '').trim();
                const dvojiceKlic = [PL_NORM(d), PL_NORM(h)].sort().join(' vs ');

                vybraneMapa[roundName] = vybranyZapas.id;
                tymCount[d] = (tymCount[d] || 0) + 1;
                tymCount[h] = (tymCount[h] || 0) + 1;

                tymPosledniKolo[d] = rIdx;
                tymPosledniKolo[h] = rIdx;
                odehraneDvojice.add(dvojiceKlic);

                totalScore += calcMatchBaseScore(vybranyZapas);
            }
        }

        PL_BASKETS.basket1.forEach(b1Tym => {
            const realKey = Object.keys(tymCount).find(k => PL_NORM(k).includes(b1Tym) || b1Tym.includes(PL_NORM(k)));
            const cnt = realKey ? tymCount[realKey] : 0;
            if (cnt === 4) totalScore += 5000;
            else totalScore -= Math.abs(4 - cnt) * 20000;
        });

        Object.values(tymCount).forEach(cnt => {
            if (cnt >= 3 && cnt <= 4) totalScore += 1000;
            else if (cnt < 3) totalScore -= (3 - cnt) * 10000;
            else if (cnt > 4) totalScore -= (cnt - 4) * 30000;
        });

        return { mapa: vybraneMapa, score: totalScore };
    };

    let bestResult = null;
    let maxScore = -Infinity;

    for (let sim = 0; sim < 300; sim++) {
        const res = runTieredBottleneckPass();
        if (res && res.score > maxScore && Object.keys(res.mapa).length === totalRounds) {
            maxScore = res.score;
            bestResult = res;
        }
    }

    if (!bestResult || !bestResult.mapa) {
        window.showToast("⚠️ Zkuste vygenerovat znovu.", true);
        return;
    }

    const finalMatchIds = seznamKol.map(k => bestResult.mapa[k]).filter(Boolean);
    const tymStats = {};

    seznamKol.forEach((koloNazev, idx) => {
        const mId = finalMatchIds[idx];
        const roundMatches = kolaMapa[koloNazev] || [];
        const z = roundMatches.find(m => m.id === mId);
        if (z) {
            const d = String(z.domaci || 'Neznámý').trim();
            const h = String(z.hoste || 'Neznámý').trim();

            if (!tymStats[d]) tymStats[d] = { count: 0, matches: [] };
            if (!tymStats[h]) tymStats[h] = { count: 0, matches: [] };

            tymStats[d].count++;
            tymStats[d].matches.push({ kolo: koloNazev, protivnik: h });

            tymStats[h].count++;
            tymStats[h].matches.push({ kolo: koloNazev, protivnik: d });
        }
    });

    window.vygenerovaneTopMatchIdsCache = finalMatchIds;
    window.otevriTopMatchesDashboardModal(tymStats, finalMatchIds.length, totalRounds, true);
};

// 3. UI MODAL PRO TOP ZÁPASY
window.otevriTopMatchesDashboardModal = (tymStats, celkemVybrano, celkemKol, isProposal = false) => {
    const activeAdminLeague = Alpine.store('appState')?.selectedAdminLeague || 'Soutěž';

    let kartickyTymuHtml = '';
    const serazeneTymy = Object.keys(tymStats).sort((a, b) => a.localeCompare(b, 'cs'));

    serazeneTymy.forEach(tym => {
        const info = tymStats[tym];
        const rozpisHtml = info.matches.length > 0 
            ? info.matches.map(m => `<div style="font-size: 0.75rem; color: #9ca3af; margin-top: 2px;">• <span style="color: #fbbf24;">${m.kolo}:</span> vs. ${m.protivnik}</div>`).join('')
            : '<div style="font-size: 0.75rem; color: #6b7280;">Žádný TOP zápas</div>';

        kartickyTymuHtml += `
            <div class="top-dashboard-card">
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <strong style="color: #ffffff; font-family: 'Oswald', sans-serif; font-size: 0.95rem;">${tym}</strong>
                        <span class="top-dashboard-badge">${info.count}× TOP</span>
                    </div>
                    ${rozpisHtml}
                </div>
            </div>
        `;
    });

    const statusBannerHtml = isProposal ? `
        <div style="background: rgba(234, 88, 12, 0.15); border: 1px solid #f97316; padding: 10px; border-radius: 8px; font-size: 0.8rem; color: #fb923c; line-height: 1.4;">
            ⚡ <strong>NOVĚ VYGENEROVANÝ NÁVRH:</strong> Vybráno <strong>${celkemVybrano} TOP zápasů</strong> napříč ${celkemKol} kolami. Návrh ještě není zapsán v databázi!
        </div>
    ` : `
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; padding: 10px; border-radius: 8px; font-size: 0.8rem; color: #34d399; line-height: 1.4;">
            ✅ <strong>AKTUÁLNÍ STAV Z DATABÁZE:</strong> V systému je zapsáno <strong>${celkemVybrano} TOP zápasů</strong> napříč ${celkemKol} kolami.
        </div>
    `;

    const tlacitkoUlozitHtml = isProposal ? `
        <button class="action-btn" style="margin: 0; background: #ea580c; border: 1px solid #f97316; padding: 10px 14px; font-size: 0.82rem; font-family: 'Oswald', sans-serif; width: auto; border-radius: 6px;" onclick="window.ulozVygenerovaneTopZapasy()">💾 ZAPSAT NÁVRH DO DATABÁZE</button>
    ` : '';

    const fullModalHtml = `
        <div style="padding: 15px; background: #0b0f19; color: white; display: flex; flex-direction: column; gap: 12px; text-align: left; max-height: 75vh; overflow-y: auto;">
            ${statusBannerHtml}

            <div class="top-dashboard-grid">
                ${kartickyTymuHtml}
            </div>

            <div style="margin-top: 15px; display: flex; gap: 8px; justify-content: flex-end; border-top: 1px solid #374151; padding-top: 15px; flex-wrap: wrap;">
                <button class="action-btn" style="margin: 0; background: #4b5563; padding: 10px 14px; font-size: 0.82rem; font-family: 'Oswald', sans-serif; width: auto; border-radius: 6px;" onclick="document.querySelectorAll('.spy-modal-overlay:not(#loutkovodic-modal):not(#reorder-leagues-modal)').forEach(el => el.remove())">❌ ZAVŘÍT</button>
                <button class="action-btn" style="margin: 0; background: #2563eb; border: 1px solid #60a5fa; padding: 10px 14px; font-size: 0.82rem; font-family: 'Oswald', sans-serif; width: auto; border-radius: 6px;" onclick="window.generujNoveTopZapasy()">⚡ ${isProposal ? 'PŘEGENEROVAT ZNOVU' : 'VYGENEROVAT NOVÝ NÁVRH'}</button>
                ${tlacitkoUlozitHtml}
            </div>
        </div>
    `;

    const modalTitul = isProposal 
        ? `⚡ NÁVRH TOP ZÁPASŮ: ${activeAdminLeague.toUpperCase()}`
        : `🔥 AKTUÁLNÍ TOP ZÁPASY: ${activeAdminLeague.toUpperCase()}`;

    window.openGlobalUiModal(modalTitul, fullModalHtml);
};

window.ulozVygenerovaneTopZapasy = async () => {
    const store = Alpine.store('appState');
    const activeAdminLeague = store?.selectedAdminLeague;
    const sezonaId = store?.activeSeason || window.SEZONA_ID || "2026_2027";
    const vybraneIds = window.vygenerovaneTopMatchIdsCache || [];

    if (!activeAdminLeague || vybraneIds.length === 0) return;

    document.querySelectorAll('.spy-modal-overlay:not(#loutkovodic-modal):not(#reorder-leagues-modal)').forEach(el => el.remove());
    if (typeof window.showSplash === 'function') window.showSplash("Ukládám TOP zápasy...");

    try {
        const batch = writeBatch(window.db);

        store.adminMatches.forEach(m => {
            const matchRef = doc(window.db, 'ligy', activeAdminLeague, 'sezony', sezonaId, 'zapasy', m.id);
            const jeTop = vybraneIds.includes(m.id);
            batch.update(matchRef, { isTopMatch: jeTop });
        });

        await batch.commit();
        window.showToast(`🔥 Staré TOP zápasy vymazány a úspěšně zapsáno ${vybraneIds.length} nových!`);
        if (typeof window.renderAdminMatches === 'function') window.renderAdminMatches();
    } catch (e) {
        console.error("Chyba při zápisu TOP zápasů:", e);
        window.showToast("❌ Chyba při ukládání TOP zápasů.", true);
    } finally {
        if (typeof window.hideSplash === 'function') window.hideSplash();
    }
};

// =========================================================================
// 📊 CENTRÁLNÍ SPRÁVA ANKET (ADMIN & SUPERADMIN ENGINE)
// =========================================================================
window.adminNewSurveyOptions = window.adminNewSurveyOptions || ["", ""];
window.adminSelectedTargetLeagues = window.adminSelectedTargetLeagues || ["all"];

window.renderAdminSurvey = async (targetContainer = null) => {
    const container = targetContainer || document.getElementById('adminSurveyContainer') || document.getElementById('superAdminTabContentArea');
    if (!container) return;

    container.innerHTML = '<div class="db-empty-msg" style="color:#38bdf8;">Načítám stav ankety... ⏳</div>';

    try {
        const surveyDocRef = doc(window.db, "ankety", "aktivni");
        const surveySnap = await getDoc(surveyDocRef);

        if (!surveySnap.exists()) {
            const MASTER_LIGY = CONFIG.MASTER_LEAGUES || [
                "Chance Liga", "Premier League", "Liga mistrů", "MS ve fotbale", "Tipsport Extraliga", "MS v hokeji"
            ];
            const isAll = window.adminSelectedTargetLeagues.includes('all');

            const renderOptionInputs = () => {
                return window.adminNewSurveyOptions.map((val, idx) => `
                    <div class="survey-admin-field">
                        <label class="survey-admin-label">Možnost ${idx + 1} ${idx < 2 ? '(povinná)' : ''}:</label>
                        <div class="survey-dynamic-opt-row">
                            <input type="text" id="new-survey-opt-${idx}" value="${window.escapeHTML(val)}" placeholder="Např. Možnost ${String.fromCharCode(65 + idx)}" class="survey-admin-input" oninput="window.adminNewSurveyOptions[${idx}] = this.value">
                            ${idx >= 2 ? `<button type="button" class="survey-opt-remove-btn" onclick="window.removeSurveyOption(${idx})" title="Odebrat možnost">✕</button>` : ''}
                        </div>
                    </div>
                `).join('');
            };

            const leaguesListHtml = [
                `
                <label class="survey-league-row is-all-row">
                    <input type="checkbox" id="survey-all-leagues" ${isAll ? 'checked' : ''} onchange="window.toggleSurveyAllLeagues(this.checked)">
                    <span>🌐 VŠECHNY SOUTĚŽE</span>
                </label>
                `,
                ...MASTER_LIGY.map(l => {
                    const icon = l.includes('Extraliga') || l.includes('hokej') ? '🏒' : '⚽';
                    const isChecked = isAll || window.adminSelectedTargetLeagues.includes(l);
                    return `
                    <label class="survey-league-row">
                        <input type="checkbox" value="${l}" class="survey-league-check" ${isChecked ? 'checked' : ''} onchange="window.handleSurveyLeagueChange()">
                        <span>${icon} ${l.toUpperCase()}</span>
                    </label>
                    `;
                })
            ].join('');

            container.innerHTML = `
                <div class="survey-admin-container">
                    <div class="survey-admin-card">
                        <h3 class="survey-admin-title">➕ VYTVOŘIT NOVOU ANKETU</h3>
                        <p class="survey-admin-desc">
                            Zadej otázku a přidej libovolný počet možností. Možnost <strong>„Nechci hlasovat v této anketě“</strong> je do každé ankety přidána automaticky.
                        </p>
                        
                        <div class="survey-admin-field">
                            <label class="survey-admin-label">Otázka ankety:</label>
                            <input type="text" id="new-survey-question" placeholder="Např. Chcete zavést nový bodovací bonus?" class="survey-admin-input">
                        </div>

                        <div id="survey-dynamic-options-container" class="survey-admin-field">
                            ${renderOptionInputs()}
                        </div>

                        <button type="button" class="survey-add-opt-btn" onclick="window.addSurveyOption()">
                            ➕ Přidat další možnost (${window.adminNewSurveyOptions.length + 1})
                        </button>

                        <div class="survey-admin-field">
                            <label class="survey-admin-label accent">🎯 Cílové soutěže (komu anketu zobrazit):</label>
                            <div class="survey-leagues-vertical-list">
                                ${leaguesListHtml}
                            </div>
                        </div>

                        <div class="survey-form-row-group">
                            <div class="survey-form-col">
                                <label class="survey-admin-label accent">⏳ Konec ankety (datum a čas):</label>
                                <input type="datetime-local" id="new-survey-deadline" class="survey-datetime-input">
                            </div>
                            <div class="survey-form-col">
                                <label class="survey-admin-label accent">👁️ Režim zobrazení výsledků:</label>
                                <select id="new-survey-results-mode" class="survey-select-compact">
                                    <option value="AUTO_PO_SKONCENI">🔒 Automaticky po skončení ankety</option>
                                    <option value="ZIVE">🔴 Průběžné (hráč vidí stav ihned po hlasu)</option>
                                    <option value="SKRYTO">🙈 Trvale skryté (pouze pro administrátora)</option>
                                </select>
                            </div>
                        </div>

                        <button type="button" class="survey-publish-btn" onclick="window.publishNewSurvey()">
                            🚀 PUBLIKOVAT ANKETU
                        </button>
                    </div>
                </div>
            `;
            return;
        }

        const surveyData = surveySnap.data();
        const isOpen = surveyData.isOpen !== false && surveyData.stav !== 'UZAVRENO';
        const vysledkyOdemceny = Boolean(surveyData.vysledkyOdemceny);

        const votesSnap = await getDocs(collection(window.db, "ankety", "aktivni", "hlasy"));
        const votes = [];
        votesSnap.forEach(d => votes.push(d.data()));

        const options = surveyData.options || surveyData.moznosti || [];
        const optVoters = options.map(() => []);
        const declinedVoters = [];

        votes.forEach(v => {
            const nick = v.nickname || 'Hráč';
            if (v.optionIndex === 'declined' || v.optionIndex === -1) {
                declinedVoters.push(nick);
            } else if (typeof v.optionIndex === 'number' && v.optionIndex >= 0 && v.optionIndex < options.length) {
                optVoters[v.optionIndex].push(nick);
            }
        });

        const totalAnswered = optVoters.reduce((acc, arr) => acc + arr.length, 0);

        let konecText = 'Bez termínu';
        if (surveyData.konecDatum) {
            const kMs = surveyData.konecDatum.toDate ? surveyData.konecDatum.toDate().getTime() : (surveyData.konecDatum.seconds ? surveyData.konecDatum.seconds * 1000 : new Date(surveyData.konecDatum).getTime());
            if (kMs) {
                const d = new Date(kMs);
                konecText = `${d.getDate()}. ${d.getMonth() + 1}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            }
        }

        const optionsHtml = options.map((opt, idx) => {
            const voters = optVoters[idx] || [];
            const count = voters.length;
            const pct = totalAnswered > 0 ? Math.round((count / totalAnswered) * 100) : 0;
            return `
                <div class="survey-result-option-card">
                    <div class="survey-option-header">
                        <strong>${idx + 1}. ${window.escapeHTML(opt)}</strong>
                        <span style="font-family:'Oswald',sans-serif; color:#fbbf24; font-weight:bold;">${count} hlasů (${pct} %)</span>
                    </div>
                    <div class="survey-option-bar-track">
                        <div class="survey-option-bar-fill" style="width: ${pct}%;"></div>
                    </div>
                    <div class="survey-voters-text">
                        <strong>👥 Hlasovali (${voters.length}):</strong> ${voters.length > 0 ? window.escapeHTML(voters.join(', ')) : '<span style="color:#6b7280;">Zatím nikdo</span>'}
                    </div>
                </div>
            `;
        }).join('');

        const declinedHtml = `
            <div class="survey-declined-card">
                <div class="survey-option-header">
                    <span style="color:#9ca3af; font-size:0.85rem;">🚫 Nechtějí hlasovat</span>
                    <span style="font-family:'Oswald',sans-serif; color:#9ca3af; font-weight:bold;">${declinedVoters.length} hráčů</span>
                </div>
                <div style="font-size:0.75rem; color:#6b7280; margin-top:4px;">
                    ${declinedVoters.length > 0 ? window.escapeHTML(declinedVoters.join(', ')) : 'Nikdo neodmítl'}
                </div>
            </div>
        `;

        container.innerHTML = `
            <div class="survey-admin-container">
                <div class="survey-admin-card">
                    <div class="survey-results-header">
                        <span style="font-weight:bold; font-size:0.9rem; color:${isOpen ? '#34d399' : '#9ca3af'};">${isOpen ? '🟢 AKTIVNÍ ANKETA' : '⚪ UZAVŘENÁ ANKETA'}</span>
                        <span style="font-size:0.75rem; color:#fbbf24; font-family:'Oswald',sans-serif;">⏳ Konec: ${konecText}</span>
                    </div>

                    <div class="survey-question-heading">
                        ${window.escapeHTML(surveyData.question || surveyData.otazka)}
                    </div>

                    <div class="survey-meta-strip">
                        🎯 Cílové ligy: <strong>${(surveyData.ciloveLigy || ['all']).includes('all') ? 'Všechny soutěže' : (surveyData.ciloveLigy || []).join(', ')}</strong>
                        • Režim: <strong>${surveyData.rezimVysledku || 'AUTO_PO_SKONCENI'}</strong>
                    </div>

                    <div class="survey-results-list">
                        ${optionsHtml}
                        ${declinedHtml}
                    </div>

                    <div class="survey-admin-actions-bar">
                        <button class="survey-action-btn-status" style="background:${isOpen ? '#d97706' : '#059669'}; color:#fff;" onclick="window.toggleSurveyStatus(${!isOpen})">
                            ${isOpen ? '🔒 UZAVŘÍT ANKETU' : '🔓 ZNOVU OTEVŘÍT'}
                        </button>
                        <button class="survey-action-btn-unlock ${vysledkyOdemceny ? 'is-unlocked' : ''}" onclick="window.toggleSurveyResultsPublic(${!vysledkyOdemceny})">
                            ${vysledkyOdemceny ? '🙈 SKRÝT VÝSLEDKY' : '👁️ ODEMKNOUT VÝSLEDKY'}
                        </button>
                        <button class="survey-action-btn-delete" onclick="window.deleteActiveSurvey()">
                            🗑️ SMAZAT ANKETU
                        </button>
                    </div>
                </div>
            </div>
        `;
    } catch (e) {
        console.error("Chyba načtení ankety:", e);
        container.innerHTML = '<div class="db-empty-msg" style="color:#f87171;">Chyba načítání ankety.</div>';
    }
};

window.addSurveyOption = () => {
    if (!window.adminNewSurveyOptions) window.adminNewSurveyOptions = ["", ""];
    window.adminNewSurveyOptions.push("");
    window.renderAdminSurvey();
};

window.removeSurveyOption = (index) => {
    if (!window.adminNewSurveyOptions || window.adminNewSurveyOptions.length <= 2) return;
    window.adminNewSurveyOptions.splice(index, 1);
    window.renderAdminSurvey();
};

window.toggleSurveyAllLeagues = (checked) => {
    window.adminSelectedTargetLeagues = checked ? ["all"] : [];
    document.querySelectorAll('.survey-league-check').forEach(el => el.checked = checked);
};

window.handleSurveyLeagueChange = () => {
    const checked = Array.from(document.querySelectorAll('.survey-league-check:checked')).map(el => el.value);
    const allBox = document.getElementById('survey-all-leagues');
    const MASTER_LIGY = CONFIG.MASTER_LEAGUES || [];
    if (checked.length === MASTER_LIGY.length) {
        window.adminSelectedTargetLeagues = ["all"];
        if (allBox) allBox.checked = true;
    } else {
        window.adminSelectedTargetLeagues = checked;
        if (allBox) allBox.checked = false;
    }
};

window.publishNewSurvey = async () => {
    const q = document.getElementById('new-survey-question')?.value.trim();
    const deadlineVal = document.getElementById('new-survey-deadline')?.value;
    const modeVal = document.getElementById('new-survey-results-mode')?.value || 'AUTO_PO_SKONCENI';

    const options = (window.adminNewSurveyOptions || []).map((_, idx) => {
        return document.getElementById(`new-survey-opt-${idx}`)?.value.trim() || '';
    }).filter(Boolean);

    if (!q || options.length < 2) {
        window.showToast("Zadej otázku a alespoň 2 platné možnosti! ⚠️", true);
        return;
    }

    let deadlineTimestamp = null;
    if (deadlineVal) {
        deadlineTimestamp = Timestamp.fromDate(new Date(deadlineVal));
    }

    const targetLeagues = (window.adminSelectedTargetLeagues && window.adminSelectedTargetLeagues.length > 0)
        ? window.adminSelectedTargetLeagues
        : ["all"];

    window.showToast("⏳ Publikuji novou anketu...", false);

    try {
        const currentUser = window.auth?.currentUser;
        await setDoc(doc(window.db, "ankety", "aktivni"), {
            question: q,
            options: options,
            ciloveLigy: targetLeagues,
            konecDatum: deadlineTimestamp,
            rezimVysledku: modeVal,
            vysledkyOdemceny: modeVal === 'ZIVE',
            isOpen: true,
            stav: "AKTIVNI",
            createdAt: serverTimestamp(),
            createdUid: currentUser?.uid || ''
        });

        window.adminNewSurveyOptions = ["", ""];
        window.adminSelectedTargetLeagues = ["all"];
        window.showToast("🚀 Anketa byla úspěšně publikována!");
        window.renderAdminSurvey();
    } catch (e) {
        console.error(e);
        window.showToast("❌ Chyba při publikování: " + e.message, true);
    }
};

window.toggleSurveyStatus = async (newStatus) => {
    window.showToast("⏳ Měním stav ankety...", false);
    try {
        await updateDoc(doc(window.db, "ankety", "aktivni"), {
            isOpen: newStatus,
            stav: newStatus ? "AKTIVNI" : "UZAVRENO"
        });
        window.showToast(newStatus ? "🔓 Anketa znovu otevřena!" : "🔒 Anketa byla uzavřena.");
        window.renderAdminSurvey();
    } catch (e) {
        console.error(e);
        window.showToast("❌ Chyba změny stavu: " + e.message, true);
    }
};

window.toggleSurveyResultsPublic = async (makePublic) => {
    window.showToast("⏳ Měním viditelnost výsledků...", false);
    try {
        await updateDoc(doc(window.db, "ankety", "aktivni"), {
            vysledkyOdemceny: makePublic
        });
        window.showToast(makePublic ? "👁️ Výsledky zpřístupněny hráčům!" : "🙈 Výsledky hráčům skryty.");
        window.renderAdminSurvey();
    } catch (e) {
        console.error(e);
        window.showToast("❌ Chyba nastavení výsledků: " + e.message, true);
    }
};

window.deleteActiveSurvey = async () => {
    if (!confirm("Opravdu chceš celou anketu včetně všech dosavadních hlasů smazat?")) return;

    window.showToast("⏳ Mažu anketu...", false);
    try {
        const votesSnap = await getDocs(collection(window.db, "ankety", "aktivni", "hlasy"));
        const batch = writeBatch(window.db);
        votesSnap.forEach(d => batch.delete(d.ref));
        batch.delete(doc(window.db, "ankety", "aktivni"));
        await batch.commit();

        window.showToast("🗑️ Anketa smazána!");
        window.renderAdminSurvey();
    } catch (e) {
        console.error(e);
        window.showToast("❌ Chyba při mazání: " + e.message, true);
    }
};