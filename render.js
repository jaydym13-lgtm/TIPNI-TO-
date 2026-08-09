// =========================================================================
// 🎨 TIPNI TO! - VYKRESLOVÁNÍ DAT, TIPŮ A FILTROVANÉHO ŽEBŘÍČKU (render.js)
// =========================================================================

import { doc, collection, onSnapshot, query, where, getDocs, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp, deleteField, writeBatch } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js";
import { CONFIG } from "./config.js";

const generujMožnosti = (vybranaHodnota) => {
    const jePrazdne = (vybranaHodnota === undefined || vybranaHodnota === null || vybranaHodnota === '');
    let options = `<option value="" ${jePrazdne ? 'selected' : ''} hidden>?</option>`;
    for (let i = 0; i <= 20; i++) {
        const selected = (!jePrazdne && parseInt(vybranaHodnota) === i) ? 'selected' : '';
        options += `<option value="${i}" ${selected}>${i}</option>`;
    }
    return options;
};

const generujMožnostiAdmin = (vybranaHodnota) => {
    const jePrazdne = (vybranaHodnota === undefined || vybranaHodnota === null || vybranaHodnota === '');
    let options = `<option value="" ${jePrazdne ? 'selected' : ''}>?</option>`;
    for (let i = 0; i <= 20; i++) {
        const selected = (!jePrazdne && parseInt(vybranaHodnota) === i) ? 'selected' : '';
        options += `<option value="${i}" ${selected}>${i}</option>`;
    }
    return options;
};

// 🎨 CANVAS PRE-RENDER ENGINE: Laserově přesný výpočet písma PŘED vykreslením do HTML (0 ms, žádný skok)
const canvasContext = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;

window.vypocitejOptimalniPismo = (domaci, hoste) => {
    const dvojiceText = `${domaci} – ${hoste}`;
    if (!dvojiceText || !canvasContext) return '0.95rem';
    
    // Měření při výchozí plné velikosti 0.95rem (~15.2px)
    canvasContext.font = "bold 15.2px 'Segoe UI', sans-serif";
    const sirkaPx = canvasContext.measureText(dvojiceText).width;
    
    const targetPx = 175; // 🎯 Reálná cílová šířka textu v kartě na mobilu
    
    if (sirkaPx <= targetPx) {
        return '0.95rem'; // Krátké zápasy zůstanou 100% velké
    }
    
    // Přesný plynulý poměr: mírný přesh přesáhne mírně, extrémní přesh spadne až k 0.76rem
    const spocitaneRem = (targetPx / sirkaPx) * 0.95;
    const pismoRem = Math.max(0.76, spocitaneRem); // Tvých 0.76rem zůstává jako dno pro nejtěžší macky
    
    return `${pismoRem.toFixed(2)}rem`;
};

// 1. UŽIVATEL: ZOBRAZENÍ ZÁPASŮ (HLOPÝ RENDERING S NULOU SÍŤOVÝCH READOŮ - TAHÁ Z ALPINE RAM!)
window.renderMatches = (leagueName) => {
    if (!leagueName || typeof leagueName !== 'string' || leagueName.trim() === '' || leagueName === 'null' || leagueName === 'undefined') {
        return;
    }

    const store = Alpine.store('appState');
    const zapasyMapa = store?.rozpisData?.zapasyMapa;
    if (!zapasyMapa) return;

    // 👑 REAKTIVNÍ SYNCHRONIZACE PAMĚTI: Plní rozvrtané tipy přímo pro vstupy v nekonečné časové ose
    if (!store.rozvrtaneTipy) store.rozvrtaneTipy = {};
    Object.keys(zapasyMapa).forEach(id => {
        const saved = store.mojeTipy[id];
        if (!window.isAppFormDirty || store.rozvrtaneTipy[`${id}_domaci`] === undefined) {
            store.rozvrtaneTipy[`${id}_domaci`] = saved ? String(saved.tip_domaci) : '';
            store.rozvrtaneTipy[`${id}_hoste`] = saved ? String(saved.tip_hoste) : '';
            store.rozvrtaneTipy[`${id}_postup`] = saved ? saved.postup : '';
        }
    });

    // Tiché načtení dlouhodobých bonusů šampionátu
    window.loadBonusTips(leagueName);
};

window.globalniTipoveCooldowny = window.globalniTipoveCooldowny || {};
// UKLÁDÁNÍ JEDNOHO TIPU UŽIVATELE (S 15VTEŘINOVÝM ANTI-SPAM ZÁMKEM)
window.saveTip = async (matchId, leagueName, event) => {
    const user = window.auth.currentUser;
    if (!user) return;

if (!navigator.onLine) {
        window.showToast("⚠️ Jsi offline! Pro uložení tipu se připoj k internetu.", true);
        return;
    }

    if (Alpine.store('appState')?.isArchived) {
        window.showToast("📜 Archivní sezóna je pouze pro čtení!", true);
        return;
    }

    // 🛡️ SECURITY GUARD: Kontrola času přímo uvnitř funkce (pokud hacker zkusí odemknout roletku a poslat tip z konzole)
    const zZapas = Alpine.store('appState')?.rozpisData?.zapasyMapa?.[matchId];
    if (zZapas) {
        const pDatum = (zZapas.datum && typeof zZapas.datum.toDate === 'function') ? zZapas.datum.toDate() : new Date(zZapas.datum);
        if (pDatum <= new Date()) {
            window.showToast("❌ Tento zápas už odstartoval! Tip nelze odeslat.", true);
            return;
        }
    }

    // ⏱️ KONTROLA ANTI-SPAM COOLDOWNU
    const nyni = Date.now();
    const posledniKlik = window.globalniTipoveCooldowny[matchId] || 0;
    const ubehloMili = nyni - posledniKlik;

    if (ubehloMili < 15000) {
        const zbyvaVterin = Math.ceil((15000 - ubehloMili) / 1000);
        window.showToast(`⏱️ Zpomal brácho! Tip na tento zápas můžeš upravit až za ${zbyvaVterin} s.`, true);
        return;
    }

    const domaciSkore = document.getElementById(`tip-domaci-${matchId}`).value;
    const hosteSkore = document.getElementById(`tip-hoste-${matchId}`).value;

    if (domaciSkore === "" || hosteSkore === "") {
        window.showToast("⚠️ Musíš nejprve zvolit číselné skóre obou týmů!", true);
        return;
    }

    let postupVal = '';
    const dVal = parseInt(domaciSkore);
    const hVal = parseInt(hosteSkore);
    const hiddenInput = document.getElementById(`playoff-user-val-${matchId}`);

    if (hiddenInput && dVal === hVal) {
        postupVal = hiddenInput.value;
        if (!postupVal) {
            window.showToast("🏆 V play-off mustíš při remíze zvolit postupující tým!", true);
            return;
        }
    }

    // 🔒 VIZUÁLNÍ BLOKACE TLAČÍTKA (Úroveň 3)
    const kliknuteTlacitko = event?.target;
    let puvodniText = "ULOŽIT";
    if (kliknuteTlacitko && kliknuteTlacitko.tagName === "BUTTON") {
        puvodniText = kliknuteTlacitko.innerText;
        kliknuteTlacitko.disabled = true;
        kliknuteTlacitko.style.opacity = "0.5";
        kliknuteTlacitko.innerText = "⏳...";
    }

    try {
        const ligaKlic = leagueName.replace(/ /g, '_');
        
        // 🔥 SERVEROVÝ POHON JEDNOHO TIPU PŘES NEPRŮSTŘELNOU CLOUD FUNKCI:
        const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js");
        const functions = getFunctions(window.app);
        const saveUserTipsCF = httpsCallable(functions, 'saveUserTipsCF');

        const jednaTipMapa = {
            [matchId]: {
                tip_domaci: dVal,
                tip_hoste: hVal,
                postup: postupVal
            }
        };

        // Vyčistíme klientský registr chyb pro tento konkrétní zápas před novým pokusem
        window.rejectedTipsCache = (window.rejectedTipsCache || []).filter(id => id !== matchId);

        const res = await saveUserTipsCF({
            leagueName: leagueName,
            tipyMapa: jednaTipMapa,
            sezonaId: window.SEZONA_ID
        });

        window.globalniTipoveCooldowny[matchId] = Date.now();

        const rejected = res.data?.rejected || [];
        if (rejected.includes(matchId)) {
            if (!window.rejectedTipsCache) window.rejectedTipsCache = [];
            window.rejectedTipsCache.push(matchId);
            window.showToast("❌ Tento zápas už odstartoval! Tip nebyl uložen.", true);
            
            // Okamžité vybarvení okraje roletky na červeno pro perfektní vizuální feedback
            const dSel = document.getElementById(`tip-domaci-${matchId}`);
            const hSel = document.getElementById(`tip-hoste-${matchId}`);
            if (dSel) dSel.style.borderColor = "#ef4444";
            if (hSel) hSel.style.borderColor = "#ef4444";

            if (kliknuteTlacitko) {
                kliknuteTlacitko.disabled = false;
                kliknuteTlacitko.style.opacity = "1";
                kliknuteTlacitko.innerText = puvodniText;
            }
        } else {
            // ⚡ PROFI UI REAKTIVITA: Okamžitý přepis v RAM paměti Alpine storu
                const store = Alpine.store('appState');
                if (store) {
                    if (!store.mojeTipy) store.mojeTipy = {};
                    store.mojeTipy[matchId] = { tip_domaci: dVal, tip_hoste: hVal, postup: postupVal };
                    if (!store.rozvrtaneTipy) store.rozvrtaneTipy = {};
                    store.rozvrtaneTipy[`${matchId}_domaci`] = String(dVal);
                    store.rozvrtaneTipy[`${matchId}_hoste`] = String(hVal);
                    store.rozvrtaneTipy[`${matchId}_postup`] = postupVal;
                }

                window.showToast("⚽ Tip bezpečně uložen!");
                window.isAppFormDirty = false;
                window.renderMatches(leagueName);
            }
            
        } catch (error) {
            console.error("Chyba zápisu tipu:", error);
            window.showToast(`❌ ${error.message || "Server odmítl zápis."}`, true);
        } finally {
            // 🔓 ODBLOKOVÁNÍ TLAČÍTKA: Tlačítko se po dokočení zápisu vždy vrátí do plně klikatelného stavu
            if (kliknuteTlacitko) {
                kliknuteTlacitko.disabled = false;
                kliknuteTlacitko.style.opacity = "1";
            }
        }
    };

// 🪐 NAČÍTÁNÍ DLOUHODOBÝCH BONUSŮ Z ČISTÉ RAM (Čistých 0 Reads!)
window.loadBonusTips = (leagueName) => {
    const store = Alpine.store('appState');
    const mojeBonusy = store?.mojeBonusy || {};

    const inputVitez = document.getElementById('bonus-vitez');
    const inputStrelec = document.getElementById('bonus-strelec');
    const btnBonus = document.getElementById('btn-save-bonus');

    if (!inputVitez || !inputStrelec || !btnBonus) return;

    inputVitez.value = mojeBonusy.vitez || '';
    inputStrelec.value = mojeBonusy.strelec || '';
    btnBonus.innerText = mojeBonusy.vitez ? 'ULOŽENO ✔' : 'ULOŽIT';
};

// 🪐 UKLÁDÁNÍ DLOUHODOBÝCH BONUSŮ DO SEZÓNY
window.saveBonusTips = async () => {
    const user = window.auth.currentUser;
    const leagueName = Alpine.store('appState')?.selectedLeague;
    if (!user || !leagueName) return;

    if (!navigator.onLine) {
        window.showToast("⚠️ Jsi offline! Pro uložení bonusů se připoj k internetu.", true);
        return;
    }

    const vitezValue = document.getElementById('bonus-vitez').value;
    const strelecValue = document.getElementById('bonus-strelec').value;
    const btnBonus = document.getElementById('btn-save-bonus');

    const maTipNaViteze = (leagueName !== "Chance Liga");
    if ((maTipNaViteze && !vitezValue.trim()) || !strelecValue.trim()) {
        window.showToast("⚠️ Musíš vyplnit požadovaná pole!", true);
        return;
    }

    if (btnBonus) btnBonus.innerText = 'UKLÁDÁM...';

    try {
        const ligaKlic = leagueName.replace(/ /g, '_');

        // 🔥 CLOUDOVÝ STRÁŽCE BONUSŮ (Propojení na časový zámek šampionátu)
        const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js");
        const functions = getFunctions(window.app);
        const saveBonusTipsCF = httpsCallable(functions, 'saveBonusTipsCF');

        await saveBonusTipsCF({
            leagueName: leagueName,
            vitez: vitezValue,
            strelec: strelecValue,
            sezonaId: window.SEZONA_ID
        });

        window.showToast("🎁 Bonusy na šampionát bezpečně uloženy!");
        window.loadBonusTips(leagueName);
    } catch (e) {
        console.error(e);
        if (btnBonus) btnBonus.innerText = 'ULOŽIT';
    }
};

// 2. KROK: ŽEBŘÍČEK (ČISTÁ VNITŘNÍ PAMĚŤ - 0 READS POŽADAVKŮ PŘI PŘEKLIKÁVÁNÍ TLABŮ)
window.renderLeaderboard = () => {
    const store = Alpine.store('appState');
    const leagueName = store ? store.selectedLeague : null;
    const container = document.querySelector('#leaderboardScreen .zebra-container');
    if (!container) return;

    if (!leagueName) {
        container.innerHTML = '<div class="db-empty-msg">⚠️ Žebříček je izolovaný. Nejprve běž Domů a klikni na konkrétní ligu!</div>';
        return;
    }

    window.leaderboardActiveTab = window.leaderboardActiveTab || 'total';
    const tab = window.leaderboardActiveTab;

    // 👑 NEPRŮSTŘELNÝ MEMORY SHIELD: Oskenujeme stav roletek před jakýmkoliv zásahem do HTML
    const staryRekordBox = container.querySelector('.bonus-collapse-content-fixed');
    window.rekordyBylyOtevreneGlobal = staryRekordBox ? staryRekordBox.classList.contains('show-fixed') : false;

    const nalezeneRozbaleneUids = [];
    container.querySelectorAll('.leaderboard-row-wrapper').forEach(w => {
        const dropdown = w.querySelector('.leaderboard-row-dropdown');
        if (dropdown && dropdown.style.display === 'block' && w.dataset.uid) {
            nalezeneRozbaleneUids.push(w.dataset.uid);
        }
    });
    
    // Stav ukládáme do globální cache pouze v případě, že na obrazovce reálně nějaké řádky byly
    if (nalezeneRozbaleneUids.length > 0 || container.querySelector('.leaderboard-row-wrapper')) {
        window.rozbaleneUidsCacheGlobal = nalezeneRozbaleneUids;
    }

    const btnStyleTotal = tab === 'total' ? 'background: #059669; color: white; border-color: #10b981;' : 'background: #1f2937; color: #9ca3af; border-color: #374151;';
    const btnStyleLive = tab === 'live' ? 'background: #ef4444; color: white; border-color: #ef4444;' : 'background: #1f2937; color: #9ca3af; border-color: #374151;';

    const screenHeaderTitle = document.querySelector('#leaderboardScreen h2');
    if (screenHeaderTitle) {
        screenHeaderTitle.innerText = tab === 'live' ? '🔴 LIVE POŘADÍ' : '🏆 POŘADÍ';
    }

    container.innerHTML = `
        <div class="leaderboard-tabs-wrapper">
            <button class="nav-btn-leaderboard" style="${btnStyleTotal}" onclick="window.leaderboardActiveTab='total'; window.renderLeaderboard();">
                🏆 Celková tabulka
            </button>
            <button class="nav-btn-leaderboard class-live-btn-tab" style="${btnStyleLive};" onclick="window.leaderboardActiveTab='live'; window.renderLeaderboard();">
                🔴 LIVE!
            </button>
        </div>
        <div class="leaderboard-content-area"></div>
    `;

    const contentArea = container.querySelector('.leaderboard-content-area');
    const leaderboardData = store?.leaderboardData;

    // ⏳ KLIDNÝ NAČÍTACÍ STAV: Pokud se žebříček zrovna stahuje, vypíšeme info a počkáme na impuls ze sítě
    if (!leaderboardData) {
        contentArea.innerHTML = `<div class="db-empty-msg" style="color:#fbbf24;">Žebříček se na pozadí připravuje... ⚙️</div>`;
        const liveBtn = document.querySelector('.class-live-btn-tab');
        if (liveBtn) liveBtn.style.display = 'none';
        return;
    }

    window.vykresliDataZebříčku(leaderboardData, contentArea, tab, leagueName);
};

// 🎨 INTERAKTIVNÍ MANAŽER VYKRESLOVÁNÍ DAT (BEZ ZBYTEČNÉ MATRICOVÉ ZÁTĚŽE TELEFONU)
window.vykresliDataZebříčku = (centralDoc, contentArea, tab, leagueName) => {
        // 👑 UTLA PROFI SENIOR POJISTKA: Pokud dokument existuje, ale je neúplný, JavaScript nespadne a počká na bota
        if (!centralDoc || (!centralDoc.zebricek && !centralDoc.zebricekLive)) {
            contentArea.innerHTML = `<div class="db-empty-msg" style="color:#fbbf24;">Žebříček se na pozadí připravuje... ⚙️</div>`;
            const liveBtn = document.querySelector('.class-live-btn-tab');
            if (liveBtn) liveBtn.style.display = 'none';
            return;
        }

        const zebricek = tab === 'live' ? (centralDoc.zebricekLive || []) : (centralDoc.zebricek || []);

        const liveBtn = document.querySelector('.class-live-btn-tab');
        if (liveBtn) {
            liveBtn.style.display = Alpine.store('appState')?.isLive ? 'flex' : 'none';
        }

    contentArea.innerHTML = '';

    // Vytáhneme uložené stavy z globálního skenu
    // 👑 REAKTIVNÍ PAMĚŤ: Zachováme box otevřený/zavřený i při bleskovém překlikávání záložek Total/Live!
    const rekordyBylyOtevrene = !!window.rekordyBylyOtevreneGlobal;
    const uidsKObnoveni = window.rozbaleneUidsCacheGlobal || [];

    contentArea.innerHTML = '';
    const isLiveTab = (tab === 'live');

    // 1. ŽIVÉ / STATICKÉ PARSOVÁNÍ PŘESNÝCH VÝSLEDKŮ
    const zdrojPresne = isLiveTab ? (centralDoc.top3PresneLive || []) : (centralDoc.top3Presne || []);
    let presneHtml = '<div style="color:#9ca3af; font-size:0.8rem;">Zatím žádné záznamy.</div>';
    if (zdrojPresne.length > 0) {
        presneHtml = zdrojPresne.map((item, i) => {
            const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : '🥉');
            return `<div style="margin-bottom: 4px; font-size:0.82rem; color:#fff;">${medal} <strong style="color:#fbbf24;">${item.count}x</strong> – ${item.names}</div>`;
        }).join('');
    }

    // 2. ŽIVÉ / STATICKÉ PARSOVÁNÍ NEJLEPŠÍCH HERNÍCH ZISKŮ V KOLE
    const zdrojKola = isLiveTab ? (centralDoc.top3KolaLive || []) : (centralDoc.top3Kola || []);
    let kolaHtml = '<div style="color:#9ca3af; font-size:0.8rem;">Zatím žádné záznamy.</div>';
    if (zdrojKola.length > 0) {
        kolaHtml = zdrojKola.map((item, i) => {
            const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : '🥉');
            return `<div style="margin-bottom: 4px; font-size:0.82rem; color:#fff;">${medal} <strong style="color:#38bdf8;">${item.points} b.</strong> – ${item.text}</div>`;
        }).join('');
    }

    // 3. BODY V AKTUÁLNÍM KOLE (Počítají se dynamicky z živých RAM zisků)
    let aktualniKoloTopHtml = '<div style="color:#9ca3af; font-size:0.8rem;">Zatím žádné záznamy.</div>';
    if (centralDoc.top3AktualniKolo && centralDoc.top3AktualniKolo.length > 0) {
        aktualniKoloTopHtml = centralDoc.top3AktualniKolo.map((item, i) => {
            const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : '🥉');
            return `<div style="margin-bottom: 4px; font-size:0.82rem; color:#fff;">${medal} <strong style="color:#10b981;">${item.points} b.</strong> – ${item.names}</div>`;
        }).join('');
    }

    // 🎨 DYNAMICKÉ POPISKY: Podle zvoleného tabu změníme záhlaví kokpitu pro vizuální dokonalost
    const cockpitTitle = isLiveTab ? '🔴 PRŮBĚŽNÉ REKORDY UTKÁNÍ (LIVE STATISTICS)' : '👑 REKORDY TURNAJE (TOP STATISTICS COCKPIT)';
    const preciseLabel = isLiveTab ? '🎯 Průběžně nejvíc přesných výsledků (TOP 3)' : '🎯 Nejvíc přesných výsledků (TOP 3)';
    const roundLabel = isLiveTab ? '⚡ Průběžně nejlepší herní zisk v kole (TOP 3)' : '⚡ Nejlepší herní zisk v kole (TOP 3)';
    const currentRoundLabel = isLiveTab ? '🔥 Živé body v aktuálním kole - ' : '🔥 Body v aktuálním kole - ';
    const triggerBorderColor = isLiveTab ? '#ef4444' : '#fbbf24';

    const rekordyCollapseBox = document.createElement('div');
    rekordyCollapseBox.className = 'bonus-collapse-box-fixed';
    rekordyCollapseBox.innerHTML = `
        <button class="bonus-collapse-trigger-fixed" style="color: ${isLiveTab ? '#f87171' : '#fbbf24'}; border-color: ${triggerBorderColor};">
            <span>${cockpitTitle}</span>
            <span class="arrow-fixed">${rekordyBylyOtevrene ? '▲' : '▼'}</span>
        </button>
        <div class="bonus-collapse-content-fixed ${rekordyBylyOtevrene ? 'show-fixed' : ''}" style="gap: 12px; padding: 12px 10px;">
            <div class="rekord-box-gold" style="padding: 10px; background: rgba(251,191,36,0.02); border-color: ${isLiveTab ? 'rgba(239,68,68,0.2)' : 'rgba(251,191,36,0.15)'};">
                <div class="rekord-box-label-gold" style="margin-bottom: 6px; font-size:0.72rem; color: ${isLiveTab ? '#f87171' : '#fbbf24'};">${preciseLabel}</div>
                <div class="rekord-box-value" style="font-family: inherit; font-weight: normal; margin: 0;">${presneHtml}</div>
            </div>
            <div class="rekord-box-cyan" style="padding: 10px; background: rgba(56,189,248,0.02);">
                <div class="rekord-box-label-cyan" style="margin-bottom: 6px; font-size:0.72rem;">${roundLabel}</div>
                <div class="rekord-box-value" style="font-family: inherit; font-weight: normal; margin: 0;">${kolaHtml}</div>
            </div>
            <div class="rekord-box-green" style="padding: 10px; background: rgba(16,185,129,0.02); border: 1px solid rgba(16,185,129,0.15); border-radius: 8px; text-align: left;">
                <div class="rekord-box-label-green" style="font-size: 0.68rem; color: #10b981; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px; margin-bottom: 6px;">${currentRoundLabel}${String(centralDoc.aktivniKoloText || '–').replace(/[^0-9]/g, '')} (TOP 3)</div>
                <div class="rekord-box-value" style="font-family: inherit; font-weight: normal; margin: 0;">${aktualniKoloTopHtml}</div>
            </div>
        </div>
    `;
    
    const triggerBtn = rekordyCollapseBox.querySelector('.bonus-collapse-trigger-fixed');
    triggerBtn.onclick = function() {
        const contentDiv = this.nextElementSibling;
        const arrow = this.querySelector('.arrow-fixed');
        if (contentDiv.classList.contains('show-fixed')) {
            contentDiv.classList.remove('show-fixed'); arrow.innerText = '▼';
        } else {
            contentDiv.classList.add('show-fixed'); arrow.innerText = '▲';
        }
    };
    contentArea.appendChild(rekordyCollapseBox);

    // ⏱️ ENTERPRISE TIMESTAMP ROW: Chytrý relativní čas vygenerování dat (Dnes / Včera / Plné datum s rokem)
	const statusRow = document.createElement('div');
	statusRow.style = "text-align: right; color: #9ca3af; font-size: 0.72rem; font-family: monospace; margin-bottom: 10px; padding-right: 4px; text-transform: uppercase; letter-spacing: 0.5px; width: 100%; box-sizing: border-box;";
	let dText = '–';
	if (centralDoc.aktualizovano) {
		const d = new Date(centralDoc.aktualizovano);
		if (!isNaN(d.getTime())) {
			const nyni = new Date();
			const dnesPolnoc = new Date(nyni.getFullYear(), nyni.getMonth(), nyni.getDate());
			const vceraPolnoc = new Date(dnesPolnoc);
			vceraPolnoc.setDate(vceraPolnoc.getDate() - 1);

			const hrs = String(d.getHours()).padStart(2, '0');
			const mins = String(d.getMinutes()).padStart(2, '0');
			const secs = String(d.getSeconds()).padStart(2, '0');
			const cas = `${hrs}:${mins}:${secs}`;

			if (d >= dnesPolnoc) {
				dText = `dnes v ${cas}`;
			} else if (d >= vceraPolnoc) {
				dText = `včera v ${cas}`;
			} else {
				const den = String(d.getDate()).padStart(2, '0');
				const mesic = String(d.getMonth() + 1).padStart(2, '0');
				const rok = d.getFullYear();
				dText = `${den}.${mesic}.${rok} v ${cas}`;
			}
		}
	}
	statusRow.innerHTML = `Aktualizováno: ${dText}`;
	contentArea.appendChild(statusRow);

    zebricek.forEach((stats, index) => {
        const row = document.createElement('div');
        row.className = 'leaderboard-row-wrapper';
        row.dataset.uid = stats.uid; // 🔑 NAVÁŽEME STRUKTURÁLNÍ DELEGÁT PRO STAVOVÝ JISTIČ

        let pozice = index === 0 ? '🥇' : (index === 1 ? '🥈' : (index === 2 ? '🥉' : `${index + 1}.`));

        // 🟢 VIRTUÁLNÍ DELTA INDIKÁTOR: Vykreslí posun pozice pouze v reálném LIVE tabu
        let deltaHtml = '';
        if (tab === 'live') {
            const delta = stats.poziceDelta || 0;
            if (delta > 0) {
                deltaHtml = ` <span style="color: #10b981; font-size: 0.8rem; font-weight: bold; margin-left: 6px; font-family: 'Oswald', sans-serif;">▲ ${delta}</span>`;
            } else if (delta < 0) {
                deltaHtml = ` <span style="color: #ef4444; font-size: 0.8rem; font-weight: bold; margin-left: 6px; font-family: 'Oswald', sans-serif;">▼ ${Math.abs(delta)}</span>`;
            } else {
                deltaHtml = ` <span style="color: #6b7280; font-size: 0.8rem; font-weight: bold; margin-left: 6px; font-family: 'Oswald', sans-serif;">–</span>`;
            }
        }

        let bonusRowsHtml = '';
        if (tab === 'total') {
            bonusRowsHtml = `
                <div class="leaderboard-meta-row">
                    <span class="leaderboard-meta-label">🏆 TIP NA VÍTĚZE:</span>
                    <span class="leaderboard-meta-value">${(stats.vitezMs || '–').toUpperCase()}</span>
                </div>
                <div class="leaderboard-meta-row">
                    <span class="leaderboard-meta-label">🥇 TIP NA STŘELCE:</span>
                    <span class="leaderboard-meta-value">${(stats.nejStrelec || '–').toUpperCase()}</span>
                </div>
            `;
        }

        row.setAttribute('data-uid', stats.uid);

        // Zkontrolujeme, zda tato karta má být reaktivně otevřená
        const melByBytOtevreny = uidsKObnoveni.includes(stats.uid);

        row.innerHTML = `
            <div onclick="const det = this.nextElementSibling; const arr = this.querySelector('.leaderboard-arrow-icon'); if(det.style.display==='none' || det.style.display===''){det.style.display='block'; arr.innerText='▲';}else{det.style.display='none'; arr.innerText='▼';}" class="leaderboard-row-trigger">
                <div class="leaderboard-row-left">
                    <span class="leaderboard-row-position">${pozice}</span>
                    <span class="leaderboard-row-nickname">${window.escapeHTML(stats.nickname)}${deltaHtml}</span>
                </div>
                <div class="leaderboard-row-right">
                    <div style="color: ${stats.celkemBodu < 0 ? '#f87171' : '#34d399'};" class="leaderboard-row-points">
                        ${stats.celkemBodu} b.
                    </div>
                    <span class="leaderboard-arrow-icon">${melByBytOtevreny ? '▲' : '▼'}</span>
                </div>
            </div>
            
            <div class="leaderboard-row-dropdown" style="display: ${melByBytOtevreny ? 'block' : 'none'};">
                <div class="leaderboard-grid-stats">
                    <div class="leaderboard-stat-card">
                        <div class="leaderboard-stat-label">✅ Natipováno</div>
                        <div class="leaderboard-stat-value-gray">${stats.natipovaneVyhodnocene} záp.</div>
                    </div>
                    <div class="leaderboard-stat-card">
                        <div class="leaderboard-stat-label">❌ Nenatipováno</div>
                        <div style="color: ${stats.nenatipovaneVyhodnocene > 0 ? '#f87171' : '#9ca3af'};" class="leaderboard-stat-value-gray">${stats.nenatipovaneVyhodnocene} záp.</div>
                    </div>
                    <div class="leaderboard-stat-card">
                        <div class="leaderboard-stat-label">🎯 Přesný výsledek</div>
                        <div class="leaderboard-stat-value-gold">${stats.presneVysledkyCount}x</div>
                    </div>
                    <div class="leaderboard-stat-card">
                        <div class="leaderboard-stat-label">⚡ Max bodů za kolo</div>
                        <div class="leaderboard-stat-value-cyan">${stats.nejviceBoduVKole} b.${stats.nejviceBoduVKoleNazev && stats.nejviceBoduVKoleNazev !== '–' ? ` <span style="font-size: 0.75rem; color: #9ca3af; font-weight: normal; letter-spacing: 0px;">(${stats.nejviceBoduVKoleNazev})</span>` : ''}</div>
                    </div>
                    <div class="leaderboard-stat-card">
                        <div class="leaderboard-stat-label">📈 Aktuální kolo: ${String(centralDoc.aktivniKoloText || '–').replace(/[^0-9]/g, '')}</div>
                        <div class="leaderboard-stat-value-cyan" style="color: #a7f3d0;">${stats.bodyKoloAktualni} b.</div>
                    </div>
                    <div class="leaderboard-stat-card">
                        <div class="leaderboard-stat-label">📊 Úspěšnost (Efektivita)</div>
                        <div class="leaderboard-stat-value-gold" style="color: #fbbf24; font-size: 0.85rem;">${Number(stats.efektivitaProcento || 0).toFixed(2)}% možných bodů</div>
                    </div>
                </div>
                ${bonusRowsHtml}
                <!-- 🛡️ ZERO-ESCAPE GATEWAY: Posíláme pouze ID, texty vytáhneme bezpečně z JS RAM storu -->
                <button onclick="window.showPlayerTipsModal('${stats.uid}', '${leagueName}')" class="leaderboard-spy-btn">
                    👁️ PROHLÉDNOUT TIPY HRÁČE
                </button>
            </div>
        `;
        contentArea.appendChild(row);
    });

    // 🪐 AUTOMATICKÉ PROPOJENÍ SKENERŮ PRO DALŠÍ REFRESH CYKLUS
    window.rekordyBylyOtevreneGlobal = rekordyBylyOtevrene;
    window.rozbaleneUidsCacheGlobal = uidsKObnoveni;
};


// 👁️ BEZPEČNÝ SPY MODAL PRO HISTORII TIPŮ (STAŽENO ON-DEMAND Z CLOUDFLARE R2)
window.showPlayerTipsModal = async (playerUid, leagueName) => {
    window.tipniToCache = window.tipniToCache || { histories: {}, spy: {} };
    const store = Alpine.store('appState');
    const rozpisData = store?.rozpisData;

    if (!rozpisData || !rozpisData.zapasyMapa) return;

    // 🛡️ IN-MEMORY RESOLVER PŘEZDÍVKY: Vytáhneme si bezpečný čistý nick přímo z mezipaměti storu
    const hracSlozka = store.leaderboardData?.zebricek?.find(p => p.uid === playerUid) || store.leaderboardData?.zebricekLive?.find(p => p.uid === playerUid);
    const nickname = hracSlozka ? hracSlozka.nickname : 'Hráč';

    let hracovyTipyData;
    if (window.tipniToCache.histories[playerUid]) {
        hracovyTipyData = window.tipniToCache.histories[playerUid];
    } else {
        window.showToast("⏳ Stahuji historii tipů...", false);
        try {
            const r2Base = CONFIG.R2_BASE_URL;
            const sezonaId = store?.activeSeason || window.SEZONA_ID || CONFIG.DEFAULT_SEASON;
            const ligaKlic = String(leagueName || store?.selectedLeague || '').replace(/ /g, "_");
            const resHistory = await fetch(`${r2Base}/sezony/${sezonaId}/${ligaKlic}/historie_hrace_${playerUid}.json?t=${Date.now()}`);
            if (!resHistory.ok) {
                alert("Hráč zatím nemá žádné uzavřené tipy k zobrazení.");
                return;
            }
            hracovyTipyData = await resHistory.json();
            window.tipniToCache.histories[playerUid] = hracovyTipyData;
        } catch (e) {
            console.error(e);
            return;
        }
    }
        const hracovyTipy = hracovyTipyData.mapaTipu || {};
        const zapasyMapa = rozpisData.zapasyMapa || {};

        const serazeneZapasy = Object.keys(zapasyMapa).map(id => ({ matchId: id, ...zapasyMapa[id] }));
        serazeneZapasy.sort((a, b) => {
            const dA = a.datum?.toDate ? a.datum.toDate() : new Date(a.datum);
            const dB = b.datum?.toDate ? b.datum.toDate() : new Date(b.datum);
            return dA - dB;
        });

        let listHtml = `
            <div class="player-tips-table-header">
                <span>ZÁPAS</span>
                <span>VÝSLEDEK</span>
                <span>TIP</span>
                <span>BODY</span>
            </div>
        `;

        serazeneZapasy.forEach(zap => {
            const t = hracovyTipy[zap.matchId];
            let isEvaluated = (zap.vysledek_domaci !== undefined && zap.vysledek_hoste !== undefined && zap.apiStatus !== "IN_PLAY" && zap.apiStatus !== "PAUSED");
            const jeBeziciLive = (zap.apiStatus === "IN_PLAY" || zap.apiStatus === "PAUSED");
            
            // 👑 SENIORNÍ FILTR: Propustíme zápas, pokud už skončil NEBO právě teď živě běží!
            if (!isEvaluated && !jeBeziciLive) return;

            const prubDomaci = zap.vysledek_domaci !== undefined && zap.vysledek_domaci !== null ? zap.vysledek_domaci : 0;
        const prubHoste = zap.vysledek_hoste !== undefined && zap.vysledek_hoste !== null ? zap.vysledek_hoste : 0;

        let resDomStr = prubDomaci;
        let resHosStr = prubHoste;
        if (zap.isPlayoff && prubDomaci === prubHoste && zap.postup) {
            if (zap.postup === 'domaci') resDomStr = '*' + resDomStr;
            else if (zap.postup === 'hoste') resHosStr = resHosStr + '*';
        }

        let resStr = isEvaluated 
            ? `${resDomStr} : ${resHosStr}` 
            : `<span class="modal-live-indicator"><span class="modal-live-dot"></span>${resDomStr}:${resHosStr}</span>`;

        let exactClass = '';
        let ptsStr = '-';
        let ptsColor = '#9ca3af';
        let tipStr = '? : ?';

        if (t) {
            let tDomStr = t.tip_domaci;
            let tHosStr = t.tip_hoste;
            if (zap.isPlayoff && t.tip_domaci === t.tip_hoste && t.postup) {
                if (t.postup === 'domaci') tDomStr = '*' + tDomStr;
                else if (t.postup === 'hoste') tHosStr = tHosStr + '*';
            }
            tipStr = `${tDomStr} : ${tHosStr}`;

            if (isEvaluated || jeBeziciLive) {
                const pts = window.vypocitejBodyZapasu(t.tip_domaci, t.tip_hoste, prubDomaci, prubHoste, leagueName, t.postup, zap.postup, zap.isPlayoff, zap.isTopMatch);
                ptsStr = `(${pts >= 0 ? '+' : ''}${pts} b.)`;
                ptsColor = pts < 0 ? '#f87171' : (pts > 0 ? '#34d399' : '#9ca3af');
                if (pts === 6 || (leagueName === "MS ve fotbale" && pts === 7)) exactClass = 'exact-tip';
            }
        } else if (isEvaluated || jeBeziciLive) {
            const pravidla = window.PRAVIDLA_LIG?.[leagueName] || window.PRAVIDLA_LIG?.["DEFAULT"];
            let pts = pravidla?.penaltyNenatipovano || 0;
            ptsStr = `(${pts >= 0 ? '+' : ''}${pts} b.)`;
            ptsColor = pts < 0 ? '#f87171' : '#9ca3af';
        }

            listHtml += `
                <div class="player-tips-table-row ${exactClass}">
                    <div style="color: #e5e7eb;">${zap.domaci} - ${zap.hoste}</div>
                    <div class="player-tips-cell-result" style="color: #ffffff;">${resStr}</div>
                    <div class="player-tips-cell-tip">${tipStr}</div>
                    <div class="player-tips-cell-points" style="color: ${ptsColor};">${ptsStr}</div>
                </div>
            `;
        });

        window.openGlobalUiModal(`Tipy hráče: ${nickname}`, listHtml);
};

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

// ⚙️ CENTRALIZOVANÝ ADMIN PANEL: ČISTÝ DATOVÝ CONTROLLER (0 SREZŮ innerHTML, ŽÁDNÉ BLIKÁNÍ!)
window.renderAdminMatches = () => {
    const store = Alpine.store('appState');
    if (!store || !store.isAdmin) {
        window.goToScreen('leaguesScreen');
        return;
    }

    if (store.currentScreen !== 'adminScreen') {
        if (window.adminMatchesListener) { window.adminMatchesListener(); window.adminMatchesListener = null; }
        if (window.adminUsersListener) { window.adminUsersListener(); window.adminUsersListener = null; }
        window.adminCurrentListeningLeague = null;
        store.adminMatchesLoaded = false;
        store.adminUsersLoaded = false;
        return;
    }

    const activeAdminLeague = store.selectedAdminLeague;

    const sezonaId = store.activeSeason || window.SEZONA_ID || "2026_2027";
    const sluchatkoKlic = `${activeAdminLeague}_${sezonaId}`;

    if (activeAdminLeague && window.adminCurrentListeningKey !== sluchatkoKlic) {
        if (window.adminMatchesListener) { window.adminMatchesListener(); }
        store.adminMatches = [];
        store.adminMatchesLoaded = false;
        window.adminCurrentListeningKey = sluchatkoKlic;

        window.adminLeagueKoloInitialized = false; // Resetujeme jistič, aby nová liga spočítala svoje aktuální kolo!

        // Tiché jednorázové načtení celkových vítězů z DB při přepnutí ligy
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

        // 🎯 Živý datový stream ze správné podkolekce sezóny!
        window.adminMatchesListener = onSnapshot(collection(window.db, 'ligy', activeAdminLeague, 'sezony', sezonaId, 'zapasy'), (snapshot) => {
            if (Alpine.store('appState')?.currentScreen !== 'adminScreen') return;
            const zapasy = [];
            snapshot.forEach(docSnap => {
                zapasy.push({ id: docSnap.id, ...docSnap.data(), showEdit: false });
            });
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
                const prveNeukoncene = zapasy.find(m => m.vysledek_domaci === undefined || m.apiStatus === "IN_PLAY" || m.apiStatus === "PAUSED");
                
                if (prveNeukoncene) {
                    const nazevKola = window.prelozFaziTurnaje(prveNeukoncene.stage, prveNeukoncene.kolo, prveNeukoncene.isPlayoff);
                    const idx = unikatniKola.indexOf(nazevKola);
                    if (idx !== -1) store.adminKolaIndex = idx;
                } else {
                    store.adminKolaIndex = Math.max(0, unikatniKola.length - 1);
                }
            }
        }, (err) => console.error("Chyba admin zápasy streamu:", err));
    }

    // Živý datový stream pro uživatele
    if (!window.adminUsersListener) {
        store.adminUsers = [];
        store.adminUsersLoaded = false;
        window.adminUsersListener = onSnapshot(collection(window.db, 'users'), (snapshot) => {
            if (Alpine.store('appState')?.currentScreen !== 'adminScreen') return;
            const uzivatele = [];
            snapshot.forEach(docSnap => {
                const uData = docSnap.data();
                if (uData.isSuperAdmin !== true) {
                    uzivatele.push({ id: docSnap.id, ...uData });
                }
            });
            store.adminUsers = uzivatele;
            store.adminUsersLoaded = true;
        }, (err) => console.error("Chyba admin uživatelé streamu:", err));
    }
};

// ADMIN: ÚPRAVA DATUMU ZÁPASU
window.updateMatchDate = async (matchId) => {
    const store = Alpine.store('appState');
    const activeAdminLeague = store?.selectedAdminLeague;
    const sezonaId = store?.activeSeason || window.SEZONA_ID || "2026_2027";
    const newVal = document.getElementById(`admin-edit-datum-${matchId}`).value;
    if (!newVal || !activeAdminLeague) {
        alert("Musíš vybrat platné datum a čas! 📅");
        return;
    }
    try {
        await updateDoc(doc(window.db, 'ligy', activeAdminLeague, 'sezony', sezonaId, 'zapasy', matchId), {
            datum: Timestamp.fromDate(new Date(newVal))
        });
        window.showToast("📅 Čas zápasu úspěšně upraven!");
        window.renderAdminMatches();
    } catch (e) {
        alert("Chyba úpravy data: " + e.message);
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
        const { writeBatch, doc } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js");
        const batch = writeBatch(window.db);

        // Pokud chceme zápas aktivovat jako TOP, nejprve vypneme případný starý TOP zápas ve STEJNÉM kole
        if (budeTop) {
            zapasy.forEach(m => {
                const kKola = window.prelozFaziTurnaje(m.stage, m.kolo, m.isPlayoff);
                if (kKola === koloCilovehoZapasu && m.isTopMatch && m.id !== matchId) {
                    const staryRef = doc(window.db, 'ligy', activeAdminLeague, 'sezony', sezonaId, 'zapasy', m.id);
                    batch.update(staryRef, { isTopMatch: false });
                }
            });
        }

        // Nastavíme nový stav pro vybraný zápas
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

// ADMIN: SMAZÁNÍ ZÁPASU VČETNĚ JEHO TIPŮ
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
                <span style="color: #f87171; font-weight: bold;">Tato akce bez milosti odstraní zápas i VŠECHNY uložené tipy této ligy!</span>
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
        try {
            await deleteDoc(doc(window.db, 'ligy', activeAdminLeague, 'sezony', sezonaId, 'zapasy', matchId));
            window.showToast("🗑️ Zápas úspěšně vymazán ze stadionu!");
            window.renderAdminMatches();
        } catch (e) {
            alert("Chyba při promazávání zápasu: " + e.message);
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
            window.renderAdminMatches();
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

    if (dVal === hVal) {
        const hiddenAdminInput = document.getElementById(`playoff-admin-val-${matchId}`);
        postupVal = hiddenAdminInput ? hiddenAdminInput.value : '';
        if (!postupVal) {
            window.showToast("🏆 V play-off musíš při remíze zvolit postupujícího!", true);
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
        window.renderAdminMatches();
    // 🚀 BLESKOVÝ RECALC: Vynutíme přepočet, aby se nový výsledek ihned zapsal do R2 rozpisu
        if (typeof window.triggerGlobalRecalculation === 'function') {
            window.triggerGlobalRecalculation();
        }
    } catch (e) {
        console.error("Chyba zápisu skóre:", e);
    }
};

// REKAPITULACE PRAVIDEL
window.renderScoring = () => {
    const container = document.getElementById('scoringCardsContainer');
    if (!container) return;
    const leagueName = Alpine.store('appState')?.selectedLeague;
    
    if (leagueName === "Premier League") {
        container.innerHTML = `
            <div class="zebra-block scoring-card font-white font-bold-card">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🏆 CELKOVÝ VÍTĚZ</div>
                    <div class="scoring-card-desc">Uhodnutý celkový vítěz Premier League (před 1. kolem)</div>
                </div>
                <div class="match-points-badge badge-pts-positive">+10 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white font-bold-card" style="margin-bottom: 15px;">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🥇 KRÁL STŘELCŮ</div>
                    <div class="scoring-card-desc">Uhodnutý nejlepší střelec Premier League (před 1. kolem)</div>
                </div>
                <div class="match-points-badge badge-pts-positive">+10 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white font-bold-card" style="margin-bottom: 15px; border-left-color: #ea580c; background: rgba(234, 88, 12, 0.1);">
                <div class="scoring-card-info">
                    <div class="scoring-card-title" style="color: #f97316;">🔥 TOP ZÁPAS KOLA</div>
                    <div class="scoring-card-desc">Body ze zápasu označeného jako TOP se 2x NÁSOBÍ!</div>
                </div>
                <div class="match-points-badge" style="background: #ea580c; color: #fff; border: 1px solid #f97316;">2x BODY</div>
            </div>
            <div class="zebra-block scoring-card font-white">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🎯 PŘESNÝ VÝSLEDEK</div>
                    <div class="scoring-card-desc">Trefíš přesné skóre zápasu</div>
                </div>
                <div class="match-points-badge badge-pts-positive">+6 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-cyan">🔥 CHYTRÁ TENDENCE</div>
                    <div class="scoring-card-desc">Vítěz + přesný gól jednoho z týmů NEBO přesný rozdíl gólů</div>
                </div>
                <div class="match-points-badge badge-pts-cyan">+3 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-cyan">🤝 NEPŘESNÁ REMÍZA</div>
                    <div class="scoring-card-desc">Tipneš remízu a zápas skončí jinou remízou</div>
                </div>
                <div class="match-points-badge badge-pts-cyan">+3 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-green">⚽ ZÁKLADNÍ TENDENCE</div>
                    <div class="scoring-card-desc">Trefíš pouze čistého vítěze zápasu</div>
                </div>
                <div class="match-points-badge badge-pts-green">+2 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-muted">🥅 GÓL ÚTĚCHY</div>
                    <div class="scoring-card-desc">Netrefíš nic, ale uhodneš přesný počet gólů aspoň jednoho týmu</div>
                </div>
                <div class="match-points-badge badge-pts-zero">+1 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-danger">⚠️ NENATIPOVANÝ ZÁPAS</div>
                    <div class="scoring-card-desc">Zápas odstartoval a ty nemáš v systému uložený žádný tip</div>
                </div>
                <div class="match-points-badge badge-pts-negative">-1 b.</div>
            </div>
        `;
    } else if (leagueName === "Chance Liga" || leagueName === "Liga národů") {
        container.innerHTML = `
            <div class="zebra-block scoring-card font-white font-bold-card" style="margin-bottom: 15px;">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🥇 KRÁL STŘELCŮ</div>
                    <div class="scoring-card-desc">Uhodnutý nejlepší střelec sezóny (před 1. kolem)</div>
                </div>
                <div class="match-points-badge badge-pts-positive">+10 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white font-bold-card" style="margin-bottom: 15px; border-left-color: #ea580c; background: rgba(234, 88, 12, 0.1);">
                <div class="scoring-card-info">
                    <div class="scoring-card-title" style="color: #f97316;">🔥 TOP ZÁPAS KOLA</div>
                    <div class="scoring-card-desc">Body ze zápasu označeného jako TOP se 2x NÁSOBÍ!</div>
                </div>
                <div class="match-points-badge" style="background: #ea580c; color: #fff; border: 1px solid #f97316;">2x BODY</div>
            </div>
            <div class="zebra-block scoring-card font-white" style="margin-bottom: 15px; border-left-color: #10b981; background: rgba(16, 185, 129, 0.08);">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-green">⚡ BONUS ZA CELÉ KOLO</div>
                    <div class="scoring-card-desc">Trefíš tendenci (1, X, 2) VŠECH zápasů v daném kole</div>
                </div>
                <div class="match-points-badge badge-pts-green">+5 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🎯 PŘESNÝ VÝSLEDEK</div>
                    <div class="scoring-card-desc">Trefíš přesné skóre zápasu po 90 minutách</div>
                </div>
                <div class="match-points-badge badge-pts-positive">+5 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-green">⚽ TENDENCE / REMÍZA</div>
                    <div class="scoring-card-desc">Trefíš správného vítěze nebo nepřesnou remízu</div>
                </div>
                <div class="match-points-badge badge-pts-green">+2 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-danger">⚠️ NENATIPOVANÝ ZÁPAS</div>
                    <div class="scoring-card-desc">Zápas odstartoval a ty nemáš uložený žádný tip</div>
                </div>
                <div class="match-points-badge badge-pts-negative">-1 b.</div>
            </div>
        `;
    } else if (leagueName === "MS ve fotbale") {
        container.innerHTML = `
            <div class="zebra-block scoring-card font-white font-bold-card">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🏆 ŠAMPION</div>
                    <div class="scoring-card-desc">Uhodnutý celkový vítěz turnaje (před 1. kolem)</div>
                </div>
                <div class="match-points-badge badge-pts-positive">+8 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white font-bold-card" style="margin-bottom: 15px;">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🥇 STŘELEC</div>
                    <div class="scoring-card-desc">Uhodnutý celkový nejlepší střelec (před 1. kolem)</div>
                </div>
                <div class="match-points-badge badge-pts-positive">+8 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🎯 PŘESNÝ VÝSLEDEK</div>
                    <div class="scoring-card-desc">Trefíš přesné skóre zápasu</div>
                </div>
                <div class="match-points-badge badge-pts-positive">+6 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-cyan">🔥 CHYTRÁ TENDENCE</div>
                    <div class="scoring-card-desc">Vítěz + přesný gól jednoho z týmů NEBO přesný rozdíl gólů</div>
                </div>
                <div class="match-points-badge badge-pts-cyan">+3 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-cyan">🤝 NEPŘESNÁ REMÍZA</div>
                    <div class="scoring-card-desc">Tipneš remízu a zápas skončí jinou remízou</div>
                </div>
                <div class="match-points-badge badge-pts-cyan">+3 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-green">⚽ ZÁKLADNÍ TENDENCE</div>
                    <div class="scoring-card-desc">Trefíš pouze čistého vítěze zápasu</div>
                </div>
                <div class="match-points-badge badge-pts-green">+2 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-muted">🥅 GÓL ÚTĚCHY</div>
                    <div class="scoring-card-desc">Netrefíš nic, ale uhodneš přesný počet gólů aspoň jednoho týmu</div>
                </div>
                <div class="match-points-badge badge-pts-zero">+1 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-blue">⏱️ VÍTĚZ PRODLOUŽENÍ</div>
                    <div class="scoring-card-desc">Trefíš správného postupujícího v play-off</div>
                </div>
                <div class="match-points-badge badge-pts-blue">+1 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-danger">⚠️ NENATIPOVANÝ ZÁPAS</div>
                    <div class="scoring-card-desc">Zápas odstartoval a ty nemáš v systému uložený žádný tip</div>
                </div>
                <div class="match-points-badge badge-pts-negative">-1 b.</div>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="zebra-block scoring-card font-white font-bold-card">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🏆 ŠAMPION</div>
                    <div class="scoring-card-desc">Uhodnutý celkový vítěz turnaje (před 1. kolem)</div>
                </div>
                <div class="match-points-badge badge-pts-positive">+10 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white font-bold-card" style="margin-bottom: 15px;">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🥇 STŘELEC</div>
                    <div class="scoring-card-desc">Uhodnutý celkový nejlepší střelec (před 1. kolem)</div>
                </div>
                <div class="match-points-badge badge-pts-positive">+10 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🎯 PŘESNÝ VÝSLEDEK</div>
                    <div class="scoring-card-desc">Trefíš přesné skóre zápasu</div>
                </div>
                <div class="match-points-badge badge-pts-positive">+3 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-green">🏒 TENDENCE / REMÍZA</div>
                    <div class="scoring-card-desc">Trefíš správného vítěze zápasu nebo remízu</div>
                </div>
                <div class="match-points-badge badge-pts-green">+1 b.</div>
            </div>
        `;
    }
};

window.handleUserScoreChange = (matchId, isPlayoff) => {
    const selD = document.getElementById(`tip-domaci-${matchId}`);
    const selH = document.getElementById(`tip-hoste-${matchId}`);
    if (!selD || !selH) return;

    const d = selD.value;
    const h = selH.value;
    const savedD = selD.dataset.saved;
    const savedH = selH.dataset.saved;

    // ⚡ Neprůstřelné reaktivní řízení barev přímo přes inline styles (imunní vůči CSS specificitě)
    if (d === '') selD.style.color = '#ef4444'; // Červená pro prázdné otazníky
    else if (savedD !== '' && parseInt(d) === parseInt(savedD)) selD.style.color = '#ffffff'; // Bílá pro uložený tip
    else selD.style.color = '#facc15'; // Zářivá žlutá pro rozvrtaný neuložený stav

    if (h === '') selH.style.color = '#ef4444';
    else if (savedH !== '' && parseInt(h) === parseInt(savedH)) selH.style.color = '#ffffff';
    else selH.style.color = '#facc15';

    if (!isPlayoff) return;
    const box = document.getElementById(`playoff-user-box-${matchId}`);
    if (box) {
        if (d !== "" && h !== "" && parseInt(d) === parseInt(h)) {
            box.style.display = 'flex';
        } else {
            box.style.display = 'none';
            document.getElementById(`playoff-user-val-${matchId}`).value = '';
            document.getElementById(`playoff-user-dom-${matchId}`).style.background = '#111827';
            document.getElementById(`playoff-user-hos-${matchId}`).style.background = '#111827';
        }
    }
};

window.selectPlayoffUser = (matchId, choice) => {
    // 🛡️ SECURITY GUARD: Vytáhneme data zápasu z Alpine RAM a zkontrolujeme čas (ochrana před DevTools hackem)
    const zZapas = Alpine.store('appState')?.rozpisData?.zapasyMapa?.[matchId];
    if (zZapas) {
        const pDatum = (zZapas.datum && typeof zZapas.datum.toDate === 'function') ? zZapas.datum.toDate() : new Date(zZapas.datum);
        if (pDatum <= new Date()) {
            window.showToast("❌ Tento zápas už odstartoval! Nelze měnit postupujícího.", true);
            return;
        }
    }

    document.getElementById(`playoff-user-val-${matchId}`).value = choice;

    // 🧠 SMART REGISTRACE: Porovnáme vybraný postup s tím, co už je bezpečně zapsané v Alpine RAM storu
    const ulozenyPostup = Alpine.store('appState')?.mojeTipy?.[matchId]?.postup || '';
    const klicRegistru = `playoff-user-val-${matchId}`;
    
    if (choice !== ulozenyPostup) {
        window.dirtyInputsRegistry.add(klicRegistru);
    } else {
        window.dirtyInputsRegistry.delete(klicRegistru);
    }
    window.isAppFormDirty = (window.dirtyInputsRegistry.size > 0);

    const btnDom = document.getElementById(`playoff-user-dom-${matchId}`);
    const btnHos = document.getElementById(`playoff-user-hos-${matchId}`);
    if (choice === 'domaci') {
        btnDom.style.background = '#059669'; btnDom.style.color = '#fff';
        btnHos.style.background = '#111827'; btnHos.style.color = '#9ca3af';
    } else {
        btnHos.style.background = '#059669'; btnHos.style.color = '#fff';
        btnDom.style.background = '#111827'; btnDom.style.color = '#9ca3af';
    }
};

window.handleAdminScoreChange = (matchId, isPlayoff) => {
    if (!isPlayoff) return;
    const d = document.getElementById(`admin-res-domaci-${matchId}`).value;
    const h = document.getElementById(`admin-res-hoste-${matchId}`).value;
    const box = document.getElementById(`playoff-admin-box-${matchId}`);
    if (box) {
        if (d !== "" && h !== "" && parseInt(d) === parseInt(h)) {
            box.style.display = 'flex';
        } else {
            box.style.display = 'none';
            document.getElementById(`playoff-admin-val-${matchId}`).value = '';
            document.getElementById('playoff-admin-dom-' + matchId).style.background = '#111827';
            document.getElementById('playoff-admin-hos-' + matchId).style.background = '#111827';
        }
    }
};

window.selectPlayoffAdmin = (matchId, choice) => {
    document.getElementById(`playoff-admin-val-${matchId}`).value = choice;
    const btnDom = document.getElementById(`playoff-admin-dom-${matchId}`);
    const btnHos = document.getElementById(`playoff-admin-hos-${matchId}`);
    if (choice === 'domaci') {
        btnDom.style.background = '#1e3a8a'; btnDom.style.color = '#fff';
        btnHos.style.background = '#111827'; btnHos.style.color = '#9ca3af';
    } else {
        btnHos.style.background = '#1e3a8a'; btnHos.style.color = '#fff';
        btnDom.style.background = '#111827'; btnDom.style.color = '#9ca3af';
    }
};

// 🪐 A) PRO HRÁČE: HROMADNÉ UKLÁDÁNÍ TIPŮ DO SEZÓNNÍHO MONOLITU REAKTIVNĚ
window.saveAllUserTips = async (leagueName, event) => {
    const user = window.auth.currentUser;
    if (!user) return;

if (!navigator.onLine) {
        window.showToast("⚠️ Jsi offline! Pro hromadné uložení tipů se připoj k internetu.", true);
        return;
    }

    if (Alpine.store('appState')?.isArchived) {
        window.showToast("📜 Archivní sezóna je pouze pro čtení!", true);
        return;
    }

    const nyni = Date.now();
    const posledniHromadnyKlik = window.globalniTipoveCooldowny["HROMADNY_ZAPIS"] || 0;
    const ubehloMili = nyni - posledniHromadnyKlik;

    if (ubehloMili < 15000) {
        const zbyvaVterin = Math.ceil((15000 - ubehloMili) / 1000);
        window.showToast(`⏱️ Zpomal! Hromadný zápis můžeš znovu odpálit až za ${zbyvaVterin} s.`, true);
        return;
    }

    const container = document.querySelector('#matchesScreen .zebra-container');
    if (!container) return;

    const vsechnyRoletkyDomaci = container.querySelectorAll('[id^="tip-domaci-"]');
    let citacNovychTipu = 0;
    
    const ligaKlic = leagueName.replace(/ /g, '_');
    const store = Alpine.store('appState');
    const myTips = store?.mojeTipy || {};
    
    const updateObj = { souteze: { [ligaKlic]: { tipy: {} } } };

    vsechnyRoletkyDomaci.forEach(roletkaDom => {
        const matchId = roletkaDom.id.replace('tip-domaci-', '');
        const roletkaHoste = document.getElementById(`tip-hoste-${matchId}`);
        
        const domaciSkore = roletkaDom.value;
        const hosteSkore = roletkaHoste ? roletkaHoste.value : '';

        if (domaciSkore !== "" && hosteSkore !== "") {
            const dVal = parseInt(domaciSkore);
            const hVal = parseInt(hosteSkore);
            const hiddenInput = document.getElementById(`playoff-user-val-${matchId}`);
            let postupVal = hiddenInput ? hiddenInput.value : '';

            const staryTip = myTips[matchId];
            if (staryTip && staryTip.tip_domaci === dVal && staryTip.tip_hoste === hVal && (staryTip.postup || '') === postupVal) {
                return;
            }

            updateObj.souteze[ligaKlic].tipy[matchId] = {
                userId: user.uid,
                userEmail: user.email,
                matchId: matchId,
                tip_domaci: dVal,
                tip_hoste: hVal,
                postup: postupVal
            };

            citacNovychTipu++;
        }
    });

    if (citacNovychTipu === 0) {
        window.showToast("⚠️ Navol nejprve v roletkách nějaké výsledky!", true);
        return;
    }

    // Čisté spuštění opony bez timeoutů
    if (typeof window.showSplash === 'function') window.showSplash("Zapisuji tipy...");

    const hromadnyBtn = document.getElementById('global-save-all-btn');
    if (hromadnyBtn) {
        hromadnyBtn.disabled = true;
        hromadnyBtn.style.opacity = "0.5";
        hromadnyBtn.innerText = "⏳ UKLÁDÁM...";
    }

    try {
        const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js");
        const functions = getFunctions(window.app);
        const saveUserTipsCF = httpsCallable(functions, 'saveUserTipsCF');

        const cistaMapaTipuProServer = {};
        Object.keys(updateObj.souteze[ligaKlic].tipy).forEach(mId => {
            cistaMapaTipuProServer[mId] = {
                tip_domaci: updateObj.souteze[ligaKlic].tipy[mId].tip_domaci,
                tip_hoste: updateObj.souteze[ligaKlic].tipy[mId].tip_hoste,
                postup: updateObj.souteze[ligaKlic].tipy[mId].postup
            };
        });

        // Kompletně vymažeme globální chybový registr chyb před odesláním sady tipů
        window.rejectedTipsCache = [];

        const res = await saveUserTipsCF({
            leagueName: leagueName,
            tipyMapa: cistaMapaTipuProServer,
            sezonaId: window.SEZONA_ID
        });

        const casUlozeni = Date.now();
        window.globalniTipoveCooldowny["HROMADNY_ZAPIS"] = casUlozeni;
        
        Object.keys(cistaMapaTipuProServer).forEach(mId => {
            window.globalniTipoveCooldowny[mId] = casUlozeni;
        });

        const rejected = res.data?.rejected || [];
        window.rejectedTipsCache = rejected;

        // ⚡ PROFI UI REAKTIVITA: Přepsání všech schválených tipů do RAM paměti
        if (store) {
            if (!store.mojeTipy) store.mojeTipy = {};
            if (!store.rozvrtaneTipy) store.rozvrtaneTipy = {};
            Object.keys(cistaMapaTipuProServer).forEach(mId => {
                if (!rejected.includes(mId)) {
                    const t = cistaMapaTipuProServer[mId];
                    store.mojeTipy[mId] = { tip_domaci: t.tip_domaci, tip_hoste: t.tip_hoste, postup: t.postup };
                    store.rozvrtaneTipy[`${mId}_domaci`] = String(t.tip_domaci);
                    store.rozvrtaneTipy[`${mId}_hoste`] = String(t.tip_hoste);
                    store.rozvrtaneTipy[`${mId}_postup`] = t.postup;
                }
            });
        }

        if (rejected.length > 0) {
            window.showToast(`⚠️ ULOŽENO: ${citacNovychTipu - rejected.length} tipů. Odmítnuto ${rejected.length} zápasů z důvodu zahájení hry!`, true);
        } else {
            window.showToast(`⚡ Úspěšně uloženo ${citacNovychTipu} tipů najednou!`);
        }

        window.isAppFormDirty = false;
        window.renderMatches(leagueName);
    } catch (e) {
        console.error("Chyba hromadného tipování:", e);
        window.showToast(`❌ ${e.message || "Server odmítl hromadný zápis."}`, true);
    } finally {
        if (hromadnyBtn) {
            hromadnyBtn.disabled = false;
            hromadnyBtn.style.opacity = "1";
            hromadnyBtn.innerText = "🎯 ZAPSAT VŠE";
        }
        // Stažení opony až po kompletním dokončení async a překreslení DOMu
        if (typeof window.hideSplash === 'function') {
            if (typeof Alpine !== 'undefined' && Alpine.nextTick) {
                Alpine.nextTick(() => window.hideSplash());
            } else {
                window.hideSplash();
            }
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
        window.isAppFormDirty = false; // 👑 FIX: Shodíme dirty stav po úspěšném hromadném uložení výsledků adminem
        window.renderAdminMatches();
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
// 👑 REAL-TIME SOUUPISKA: MODULÁRNÍ ŘÍZENÍ PŘÍSTUPŮ A LIGOVÝCH ROLÍ (RBAC)
// =========================================================================
window.toggleUserAdmin = async (uid, checked) => {
    window.showToast("⏳ Aktualizuji admin cejchy...", false);
    try {
        const userRef = doc(window.db, 'users', uid);
        const docSnap = await getDoc(userRef);
        const currentLeagues = docSnap.exists() ? (docSnap.data().leagues || []) : [];

        const functions = getFunctions(window.app);
        const managePermissions = httpsCallable(functions, 'manageUserPermissionsCF');
        
        await managePermissions({
            targetUid: uid,
            isAdminRole: checked,
            leagues: currentLeagues
        });
        
        window.showToast(checked ? "👑 Práva administrátora udělena do tokenu!" : "ℹ Práva administrátora odebrána z tokenu.");
    } catch (e) { 
        console.error(e); 
        window.showToast("❌ Zápis claims odmítnut serverem.", true);
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

        const functions = getFunctions(window.app);
        const managePermissions = httpsCallable(functions, 'manageUserPermissionsCF');
        
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

// 👑 REAKTIVNÍ VLÁDNÍ KOKPIT (SUPER ADMIN FACELIFT): DESIGN SOULAD, TABY + PURGE + TRANSFER
window.renderSuperAdmin = async () => {
    const container = document.getElementById('superAdminContainer');
    if (!container) return;

    const store = Alpine.store('appState');
    if (!store || (!store.isSuperAdmin && !store.isAdmin)) {
        window.goToScreen('leaguesScreen');
        return;
    }

    if (window.superAdminUsersUnsubscribe) {
        window.superAdminUsersUnsubscribe();
        window.superAdminUsersUnsubscribe = null;
    }

    // Nastavení reaktivního tabového překlikávání pro Super Admina
    window.superAdminActiveTab = window.superAdminActiveTab || 'users';
    const tab = window.superAdminActiveTab;

    const btnStyleUsers = tab === 'users' ? 'background: #059669; color: white; border-color: #10b981;' : 'background: #1f2937; color: #9ca3af; border-color: #374151;';
    const btnStyleTools = tab === 'tools' ? 'background: #ea580c; color: white; border-color: #f97316;' : 'background: #1f2937; color: #9ca3af; border-color: #374151;';

    container.innerHTML = `
        <div class="leaderboard-tabs-wrapper" style="margin-bottom: 15px; width: 100%; box-sizing: border-box;">
            <button class="nav-btn-leaderboard" style="${btnStyleUsers}" onclick="window.superAdminActiveTab='users'; window.renderSuperAdmin();">👥 Uživatelé</button>
            <button class="nav-btn-leaderboard" style="${btnStyleTools}" onclick="window.superAdminActiveTab='tools'; window.renderSuperAdmin();">🔧 Záchrana bodů</button>
        </div>
        <div id="superAdminTabContentArea" style="width:100%;"></div>
    `;

    const contentArea = document.getElementById('superAdminTabContentArea');
    if (!contentArea) return;

    // --- TAB 1: SOUPISKA S CHYTRÝMI ROLEMI (EMAIL VEDLE PŘEZDÍVKY) ---
    if (tab === 'users') {
        contentArea.innerHTML = '<div class="db-empty-msg">Načítám vládní soupisku... ⏳</div>';

        window.superAdminUsersUnsubscribe = onSnapshot(collection(window.db, 'users'), (snapshot) => {
            if (store.currentScreen !== 'superAdminScreen' || window.superAdminActiveTab !== 'users') {
                if (window.superAdminUsersUnsubscribe) { window.superAdminUsersUnsubscribe(); window.superAdminUsersUnsubscribe = null; }
                return;
            }

            contentArea.innerHTML = `
                <div style="margin-bottom: 12px; padding: 2px 0;"><p style="color: #9ca3af; font-size: 0.85rem; margin: 0; line-height: 1.4; text-align: left;">Kliknutím na hráče rozbalíš roli Admina a demoliční tlačítko pro kompletní vymazání z celého stadionu.</p></div>
                <div id="superAdminUsersRoletyWrapper" style="display: flex; flex-direction: column; gap: 8px; width: 100%;"></div>
            `;

            const wrapper = document.getElementById('superAdminUsersRoletyWrapper');
            let counter = 0;

            snapshot.forEach((uDoc) => {
                const data = uDoc.data();
                const uid = uDoc.id;
                const email = data.email || '';
                //if (data.isSuperAdmin === true) return;

                counter++;
                const zebraBg = counter % 2 === 0 ? '#1f2937' : '#111827';

                const userRow = document.createElement('div');
                userRow.className = 'leaderboard-row-wrapper';
                userRow.style.width = '100%';
                
                userRow.innerHTML = `
                    <div onclick="const det = this.nextElementSibling; const arr = this.querySelector('.super-arrow-icon'); if(det.style.display==='none'){det.style.display='flex'; arr.innerText='▲';}else{det.style.display='none'; arr.innerText='▼';}" 
                         class="leaderboard-row-trigger" style="background: ${zebraBg}; border-color: #374151; cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; border-radius: 8px;">
                        <div class="leaderboard-row-left" style="display:flex; align-items:center; gap:8px; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:75%;">
                            <strong style="color: #ffffff; font-size: 1rem; font-family: 'Oswald', sans-serif; letter-spacing: 0.3px;">${data.nickname || 'Nový Hráč'}</strong>
                            <span style="color: #9ca3af; font-size: 0.75rem; font-family: monospace; opacity: 0.85;">(${email})</span>
                        </div>
                        <div class="leaderboard-row-right" style="display: flex; align-items: center; gap: 8px;">
                            ${data.isAdmin ? '<span style="color:#ef4444; font-size:0.68rem; font-weight:bold; background:rgba(239,68,68,0.15); padding:2px 6px; border-radius:4px; border:1px solid rgba(239,68,68,0.3);">ADMIN</span>' : ''}
                            <span class="super-arrow-icon" style="color: #9ca3af; font-size: 0.78rem;">▼</span>
                        </div>
                    </div>
                    <div class="leaderboard-row-dropdown" style="display: none; background: #0f172a; border: 1px solid #374151; border-top: none; padding: 15px; border-radius: 0 0 8px 8px; margin-top: -4px; flex-direction: column; gap: 12px; text-align: left;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 0.85rem; color: #e5e7eb; font-weight: bold;">Udělit práva Admin panelu:</span>
                            <label style="display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: #ef4444; font-weight: bold; cursor: pointer; user-select: none;">
                                <input type="checkbox" ${data.isAdmin ? 'checked' : ''} onchange="window.toggleUserAdmin('${uid}', this.checked)" style="width: 18px; height: 18px; cursor: pointer; accent-color: #ef4444; margin: 0;"> ADMIN ROLE
                            </label>
                        </div>
                        <!-- 🛡️ ZERO-ESCAPE GATEWAY: Odpárané textové proměnné z HTML. Posíláme pouze bezpečné systémové UID -->
                        <div style="border-top: 1px dashed #374151; padding-top: 12px; margin-top: 4px; display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: #e5e7eb; font-size: 0.85rem; font-weight: bold;">🎭 Správa tipů (Zpětný zápis):</span>
                            <button class="btn-tip" style="height: 32px; width: auto; padding: 0 12px; background: #ea580c; border: 1px solid #f97316; font-size: 0.72rem; font-weight:bold; font-family:'Oswald',sans-serif;" onclick="window.openLoutkovodicModal('${uid}')">🎭 LOUTKOVODIČ</button>
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
        });
    }

    // --- TAB 2: ASISTENT PŘEVODU DAT (ELEGANTNĚ ZAVŘENÁ ROLETA) ---
    else if (tab === 'tools') {
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
                <button class="bonus-collapse-trigger" onclick="const c = this.nextElementSibling; const isHidden = c.style.display === 'none'; c.style.display = isHidden ? 'block' : 'none'; this.querySelector('.arrow').innerText = isHidden ? '▲' : '▼';" style="color: #dc2626; border-color: #991b1b; font-weight: bold; background: transparent;">
                    <span>🌋 GENERÁLNÍ REKALKULACE ŽEBŘÍČKU</span><span class="arrow">▼</span>
                </button>
                <div class="bonus-collapse-content" style="display: none; padding: 18px 15px; background: #111827; border-top: 1px solid #374151;">
                    <p style="color: #9ca3af; font-size: 0.85rem; margin: 0 0 15px 0; line-height: 1.4; text-align: left;">
                        Vynutí kompletní přepočítání tabulky a statistik všech hráčů od nuly na základě aktuálně zapsaných výsledků a historických tipů. Použij po dokončení hromadných úprav v loutkovodiči.
                    </p>
                    <div style="margin-bottom: 15px; text-align: left;">
                        <label class="bonus-input-label" style="color: #9ca3af; font-size: 0.8rem; display: block; margin-bottom: 4px;">Zvolit soutěž k přepočtu:</label>
                        <select id="recalc-league-select" class="bonus-text-input" style="width:100%; height:40px; background:#0f172a; color:#fff; border-color: #4b5563; font-weight: bold;">
                           <option value="MS v hokeji">🏒 MS V HOKEJI</option>
                            <option value="MS ve fotbale" selected>⚽ MS VE FOTBALE</option>
                            <option value="Tipsport Extraliga">🏒 TIPSPORT EXTRALIGA</option>
                            <option value="Chance Liga">⚽ CHANCE LIGA</option>
                            <option value="Premier League">⚽ PREMIER LEAGUE</option>
                            <option value="Liga národů">⚽ LIGA NÁRODŮ</option>
                        </select>
                    </div>
                    <button id="global-recalc-btn" class="action-btn" onclick="window.triggerGlobalRecalculation()" style="background: #dc2626; color: white; width: 100%; font-weight: bold; font-family: 'Oswald', sans-serif; letter-spacing: 0.5px; border: none; height: 44px; font-size: 0.9rem; border-radius: 8px; margin-top: 5px;">
                        🌋 VYNUTIT PŘEPOČET ŽEBŘÍČKU
                    </button>
                </div>
            </div>
        `;
    }
};

// 🌪️ SERVEROVÝ NUCLEAR PURGE BULDOZER: SMETAURACE ÚČTU Z AUTH I FIRESTORE POD PLNOU ROZVAHOU ADMIN SDK
window.purgeUserAbsolute = (uid) => {
    // 🛡️ IN-MEMORY RESOLVER: Vytáhneme si bezpečný čistý nick z perzistentního pole adminUsersCache
    const uDoc = window.adminUsersCache?.find(docSnap => docSnap.id === uid);
    const nickname = uDoc ? (uDoc.data()?.nickname || 'Hráč') : 'Hráč';

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
        window.showToast("⏳ Serverový buldozer startuje...", false);

        try {
            const functions = getFunctions(window.app);
            const purgeUserCF = httpsCallable(functions, 'purgeUserAbsoluteCF');
            
            // Odpálíme serverovou Cloud funkci
            await purgeUserCF({ targetUid: uid });
            
            window.showToast("🗑️ Účet i veškerá herní data kompletně smazána z vesmíru!");
        } catch (error) {
            console.error("Chyba při exekuci Nuclear Purge:", error);
            window.showToast("❌ Selhalo serverové mazání.", true);
        }
    };
};

// FUNKCE PRO VYNUCENÉ ULOŽENÍ UNIKÁTNÍ PŘEZDÍVKY HRÁČE (ZÁPIS POD UID KLÍČEM)
window.saveNickname = async () => {
    const user = window.auth.currentUser;
    if (!user) return;

    const nickInput = document.getElementById('new-nickname');
    const nickVal = nickInput ? nickInput.value.trim() : '';

    if (!nickVal || nickVal.length < 3 || nickVal.length > 16) {
        alert("Přezdívka musí mít 3 až 16 znaků! 🧐");
        return;
    }

    try {
        const q = query(collection(window.db, 'users'), where('nickname', '==', nickVal));
        const duplicateCheck = await getDocs(q);
        if (!duplicateCheck.empty) {
            alert("Tuhle přezdívku už vyfoukl někdo před tebou! Zvol si jinou. 🤯");
            return;
        }

        const docRef = doc(window.db, 'users', user.uid);
        const docSnap = await getDoc(docRef);
        
        // Pokud se přihlašuješ ty, jsi rovnou schválený, ostatní jdou nekompromisně do čekárny
        const autoApproved = Alpine.store('appState')?.isSuperAdmin === true;

        // 👑 Očištěno od isApproved, noví uživatelé začínají s čistým prázdným polem leagues: []
        await setDoc(docRef, {
            userId: user.uid,
            email: user.email.trim().toLowerCase(),
            nickname: nickVal,
            isAdmin: autoApproved,
            isSuperAdmin: autoApproved, // 🔥 TENHLE ŘÁDEK SEM PATŘÍ
            leagues: autoApproved ? ['Chance Liga', 'Premier League', 'Liga národů', 'MS ve fotbale', 'Tipsport Extraliga', 'MS v hokeji'] : [],
            vytvoreno: serverTimestamp()
        });

        const store = Alpine.store('appState');
        if (store) {
            store.nickname = nickVal;
            const nickLabel = document.getElementById('userMenuNickname');
            if (nickLabel) { nickLabel.innerText = nickVal; }
            store.currentScreen = 'leaguesScreen';
        }

        window.showToast("🎮 Přezdívka uložena, vítej ve hře!");
    } catch (e) {
        console.error(e);
        alert("Chyba při ukládání přezdívky: " + e.message);
    }
};

// 👁️ ŽIVÝ MODAL PRO JEDEN ZÁPAS (ČTE SOUBOR OD BOTA PŘÍMO Z CLOUDFLARE R2)
window.showSpyModal = async (matchId, matchTitle) => {
    window.tipniToCache = window.tipniToCache || { histories: {}, spy: {} };
    const store = Alpine.store('appState');
    const leagueName = store ? store.selectedLeague : null;
    if (!leagueName) return;

    let spyData;
    if (window.tipniToCache.spy[matchId]) {
        spyData = window.tipniToCache.spy[matchId];
    } else {
        window.showToast("🔍 Sosám tipy z tribuny...", false);
        try {
            const r2Base = CONFIG.R2_BASE_URL;
            const sezonaId = store?.activeSeason || window.SEZONA_ID || CONFIG.DEFAULT_SEASON;
            const ligaKlic = String(leagueName || '').replace(/ /g, "_");
            const resSpy = await fetch(`${r2Base}/sezony/${sezonaId}/${ligaKlic}/spy_zapas_${matchId}.json?t=${Date.now()}`);
            if (resSpy.ok) {
                spyData = await resSpy.json();
            }
            // Pokud soubor z R2 chybí nebo je prázdný (případ 1. zápasu), vynutíme skok do fallbacku
            if (!spyData || !spyData.tipy || spyData.tipy.length === 0) {
                throw new Error("R2 soubor je prázdný nebo chybí");
            }
            window.tipniToCache.spy[matchId] = spyData;
        } catch (e) {
            console.log("⚠️ R2 data pro zápas jsou nedostupná nebo prázdná. Zapínám záložní Firestore Fallback...");
            try {
                const stavDoc = await getDoc(doc(window.db, 'ligy', leagueName, 'stav', `tipy_zapasu_${matchId}`));
                if (stavDoc.exists()) {
                    spyData = stavDoc.data() || { tipy: [] };
                    window.tipniToCache.spy[matchId] = spyData;
                } else {
                    alert("Tipy pro tento zápas nebyly nalezeny ani v záložním systému databáze.");
                    return;
                }
            } catch (fsErr) {
                console.error("Kritické selhání záložního načítání:", fsErr);
                return;
            }
        }
    }
        const rozpisData = store?.rozpisData || {};
        const zapasyMapa = rozpisData.zapasyMapa || {};
        const matchData = zapasyMapa[matchId] || {};
        
        // 🔄 Načteme lidi z reaktivního Alpine Storu, který se plní přes Pulsní onSnapshot
        const leaderboardData = Alpine.store('appState').leaderboardData || {};
        const zebricek = leaderboardData.zebricek || [];
        
        const mapaPrezdivek = {};
        zebricek.forEach(p => {
            if (p.email) mapaPrezdivek[p.email.trim().toLowerCase()] = p.nickname;
        });

        let všichniHraciEmaily = zebricek.map(p => p.email).filter(Boolean);
        let isEvaluated = (matchData.vysledek_domaci !== undefined && matchData.vysledek_hoste !== undefined && matchData.apiStatus !== "IN_PLAY" && matchData.apiStatus !== "PAUSED");
        const tipyProZapas = spyData.tipy || [];

        // 🚨 Fallback pojistka pro načtení z dat od bota
        if (všichniHraciEmaily.length === 0 && tipyProZapas.length > 0) {
            všichniHraciEmaily = tipyProZapas.map(tip => tip.userEmail).filter(Boolean);
        }

        // Seřadíme maily podle abecedy přezdívek
        všichniHraciEmaily.sort((a, b) => {
            const nA = mapaPrezdivek[a] || a.split('@')[0];
            const nB = mapaPrezdivek[b] || b.split('@')[0];
            return nA.localeCompare(nB, 'cs');
        });

        let nenatipovaloPocet = 0;
        let rowsHtml = '';

        všichniHraciEmaily.forEach((em, idx) => {
            const hracNick = mapaPrezdivek[em] || em.split('@')[0];
            const t = tipyProZapas.find(tip => tip.userEmail && tip.userEmail.trim().toLowerCase() === em.trim().toLowerCase());
            const isMe = em === (window.auth.currentUser?.email || '').trim().toLowerCase();
            
            const nickColorStyle = isMe ? 'color: #10b981; font-weight: bold; text-align: left;' : 'color: #e5e7eb; text-align: left;';
            
            let exactClass = '';
            let bgStyle = idx % 2 === 0 ? 'background-color: #1f2937;' : 'background-color: #4b5563;';
            let ptsStr = '-';
            let ptsColor = '#9ca3af';
            let tipStr = '? : ?';
            let tipColor = '#ef4444';
            let tipWeight = 'bold';

            if (t && t.tip_domaci !== undefined && t.tip_domaci !== null && t.tip_domaci !== '') {
                // 🎯 RETRO-INTRLIGENTNÍ ŠTÍT: Finální sjednocení hvězdiček na vnějších okrajích v hromadném okně zápasu
                let tDomStr = t.tip_domaci;
                let tHosStr = t.tip_hoste;
                if (matchData.isPlayoff && t.tip_domaci === t.tip_hoste && t.postup) {
                    if (t.postup === 'domaci') tDomStr = '*' + tDomStr;
                    else if (t.postup === 'hoste') tHosStr = tHosStr + '*';
                }
                tipStr = `${tDomStr} : ${tHosStr}`;
                tipColor = '#ffffff';
                tipWeight = 'normal';
                
                if (isEvaluated) {
                    let pts = window.vypocitejBodyZapasu(t.tip_domaci, t.tip_hoste, matchData.vysledek_domaci, matchData.vysledek_hoste, leagueName, t.postup, matchData.postup, matchData.isPlayoff, matchData.isTopMatch);
                    ptsStr = `(${pts >= 0 ? '+' : ''}${pts} b.)`;
                    ptsColor = pts < 0 ? '#f87171' : (pts > 0 ? '#34d399' : '#9ca3af');
                    
                    if (pts === 6) {
                        exactClass = 'exact-tip';
                        bgStyle = 'background-color: #362a13; border-left: 4px solid #85661c;';
                        ptsColor = '#fbbf24';
                    }
                }
            } else {
                nenatipovaloPocet++;
                if (isEvaluated) {
                    const pravidla = window.PRAVIDLA_LIG?.[leagueName] || window.PRAVIDLA_LIG?.["DEFAULT"];
                    let pts = pravidla?.penaltyNenatipovano || 0;
                    ptsStr = `(${pts >= 0 ? '+' : ''}${pts} b.)`;
                    ptsColor = pts < 0 ? '#f87171' : '#9ca3af';
                }
            }

            // 👑 DOKONALÉ SLOUČENÍ: Kopírujeme identickou strukturu řádku z historie včetně výšky a sloupců!
            rowsHtml += `
                <div class="${exactClass}" style="display: grid; grid-template-columns: 1fr 65px 75px; gap: 4px; padding: 10px 14px; align-items: center; text-align: center; ${bgStyle} box-sizing: border-box; width: 100%;">
                    <div style="${nickColorStyle} overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${window.escapeHTML(hracNick)}</div>
                    <div style="color: ${tipColor}; font-weight: ${tipWeight}; font-family: monospace; font-size: 0.95rem;">${tipStr}</div>
                    <div style="color: ${ptsColor}; font-weight: bold; font-size: 0.9rem;">${ptsStr}</div>
                </div>
            `;
        });

        let scoreBadge = '';
        if (isEvaluated) {
            let resDomStr = matchData.vysledek_domaci;
            let resHosStr = matchData.vysledek_hoste;
            // Pokud je to play-off, skončilo to remízou a máme zapsaný postup, přidáme hvězdičku
            if (matchData.isPlayoff && matchData.vysledek_domaci === matchData.vysledek_hoste && matchData.postup) {
                if (matchData.postup === 'domaci') resDomStr = '*' + resDomStr;
                else if (matchData.postup === 'hoste') resHosStr = resHosStr + '*';
            }
            scoreBadge = ` (${resDomStr}:${resHosStr})`;
        } else if (matchData.apiStatus === "IN_PLAY" || matchData.apiStatus === "PAUSED") {
            let prubD = matchData.vysledek_domaci !== undefined ? matchData.vysledek_domaci : 0;
            let prubH = matchData.vysledek_hoste !== undefined ? matchData.vysledek_hoste : 0;
            // Ošetříme hvězdičku i pro živě běžící prodloužení/penalty
            if (matchData.isPlayoff && prubD === prubH && matchData.postup) {
                if (matchData.postup === 'domaci') prubD = '*' + prubD;
                else if (matchData.postup === 'hoste') prubH = prubH + '*';
            }
            scoreBadge = ` (${prubD}:${prubH})`;
        }

        // 📊 ŽIVÝ DYNAMICKÝ VÝPOČET PROCENT SKUPINY (Garantovaný součet přesně 100 %)
        let dWins = 0, rems = 0, hWins = 0;
        const aktualniTipyNaVypocet = spyData.tipy || [];
        
        aktualniTipyNaVypocet.forEach(t => {
            if (t.tip_domaci !== undefined && t.tip_hoste !== undefined && t.tip_domaci !== null && t.tip_hoste !== null && t.tip_domaci !== '' && t.tip_hoste !== '') {
                const td = parseInt(t.tip_domaci);
                const th = parseInt(t.tip_hoste);
                if (!isNaN(td) && !isNaN(th)) {
                    if (td > th) dWins++;
                    else if (td === th) rems++;
                    else hWins++;
                }
            }
        });
        
        let celkemZadanychTipu = dWins + rems + hWins;
        let pDom = 0, pRem = 0, pHos = 0;
        
        if (celkemZadanychTipu > 0) {
            pDom = Math.round((dWins / celkemZadanychTipu) * 100);
            pRem = Math.round((rems / celkemZadanychTipu) * 100);
            pHos = Math.round((hWins / celkemZadanychTipu) * 100);
            
            let soucetProcent = pDom + pRem + pHos;
            if (soucetProcent !== 100) {
                let rozdilProcent = 100 - soucetProcent;
                if (dWins >= rems && dWins >= hWins) pDom += rozdilProcent;
                else if (rems >= dWins && rems >= hWins) pRem += rozdilProcent;
                else pHos += rozdilProcent;
            }
        }
        
        let procentaBarHtml = `
            <div style="text-align: center; color: #9ca3af; font-size: 0.76rem; background: #1f2937; border: 1px solid #374151; padding: 6px 12px; border-radius: 6px; margin: 4px auto 6px auto; font-weight: bold; width: fit-content; letter-spacing: 0.3px;">
                📊 Skupina: <span style="color:#fff;">${pDom}%</span> – <span style="color:#fff;">${pRem}%</span> – <span style="color:#fff;">${pHos}%</span>
            </div>
        `;

        // 🚨 Centrovaný counter hříšníků
        let nenatipovaliAlertHtml = `
            <div style="text-align: center; color: ${nenatipovaloPocet > 0 ? '#f87171' : '#9ca3af'}; font-size: 0.72rem; font-weight: bold; margin-bottom: 12px; font-family: monospace; text-transform: uppercase;">
                ${nenatipovaloPocet > 0 ? `⚠️ NENATIPOVALO ${nenatipovaloPocet} HRÁČŮ` : '✅ VŠICHNI HRÁČI NATIPOVALI'}
            </div>
        `;

        const modalTitle = `Tipy: ${matchTitle}${scoreBadge}`;
        const fullBodyContent = `
            <div style="padding: 10px 15px 0 15px; background: #0b0f19; flex-shrink: 0; box-sizing: border-box; width: 100%;">
                ${procentaBarHtml}
                ${nenatipovaliAlertHtml}
            </div>
            <div style="display: grid; grid-template-columns: 1fr 65px 75px; gap: 4px; padding: 10px 14px; background: #111827; border-bottom: 2px solid #4b5563; font-family: 'Oswald', sans-serif; font-size: 0.75rem; color: #fbbf24; text-transform: uppercase; text-align: center; font-weight: bold; flex-shrink: 0; box-sizing: border-box; width: 100%;">
                <span style="text-align: left;">HRÁČ</span>
                <span>TIP</span>
                <span>BODY</span>
            </div>
            <div class="spy-modal-body" style="flex:1; overflow-y:auto; padding: 0; background:#0b0f19; display: flex; flex-direction: column; width: 100%;">
                ${rowsHtml}
            </div>
        `;

        window.openGlobalUiModal(modalTitle, fullBodyContent);
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
        const functions = getFunctions(window.app);
        const transferUserData = httpsCallable(functions, 'transferUserDataCF');

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

// BEZPEČNOSTNÍ ADMIN SPOUŠTĚČ GENERÁLNÍHO PŘEPOČTU ŽEBŘÍČKU
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
        const functions = getFunctions(window.app);
        const recalculateLeaderboard = httpsCallable(functions, 'recalculateLeaderboardCF');

        await recalculateLeaderboard({ leagueName: leagueName });

        window.showToast("⚡ Žebříček úspěšně kompletně přepočítán!");
    } catch (err) {
        console.error("Chyba přepočtu žebříčku:", err);
        // 🎯 Odkrytí skutečné pravdy: Vstříkneme reálnou síťovou chybu rovnou do toastu!
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
// 👑 INTELIGENTNÍ SYMETRICKÝ INTERCEPTOR PROTI FALEŠNÝM POPLACHŮM
// =========================================================================
let _isAppFormDirty = false;
window.dirtyInputsRegistry = new Set();

// Pomocí Object.defineProperty zachytíme jakýkoliv ruční reset zvenčí (např. po úspěšném save)
Object.defineProperty(window, 'isAppFormDirty', {
    configurable: true,
    enumerable: true,
    get() {
        return _isAppFormDirty;
    },
    set(novyStav) {
        _isAppFormDirty = !!novyStav;
        // Pokud kód čistí stav na false, automaticky vyprázdníme celý paměťový registr prvků
        if (!_isAppFormDirty) {
            window.dirtyInputsRegistry.clear();
        }
    }
});

// Centrální vyhodnocovací mozek změn porovnávající DOM se stavem v Alpine RAM storu
const analyzujRealnyStavZmenyPrvku = (target) => {
    if (!target || !target.isConnected) return;
    
    const jeTipSelect = target.classList.contains('select-score');
    const jeBonusInput = target.classList.contains('bonus-text-input');
    if (!jeTipSelect && !jeBonusInput) return; // Jakékoliv cizí prvky (včetně roletky kol) okamžitě propustíme

    const id = target.id || '';
    const val = target.value;
    const store = Alpine.store('appState');
    let prvekJeSkutecneDirty = false;

    // 1. Kontrola dlouhodobých šampionátových bonusů
    if (id === 'bonus-vitez') {
        prvekJeSkutecneDirty = (val.trim() !== (store?.mojeBonusy?.vitez || ''));
    } else if (id === 'bonus-strelec') {
        prvekJeSkutecneDirty = (val.trim() !== (store?.mojeBonusy?.strelec || ''));
    }
    // 2. Kontrola standardních uživatelských tipů na zápasy
    else if (id.startsWith('tip-domaci-') || id.startsWith('tip-hoste-')) {
        const matchId = id.replace('tip-domaci-', '').replace('tip-hoste-', '');
        const savedMatch = store?.mojeTipy?.[matchId];
        const savedValue = id.includes('domaci') ? (savedMatch ? String(savedMatch.tip_domaci) : '') : (savedMatch ? String(savedMatch.tip_hoste) : '');
        prvekJeSkutecneDirty = (val !== savedValue);
    }

    // 3. Symmetrická aktualizace registru změn
    if (prvekJeSkutecneDirty) {
        window.dirtyInputsRegistry.add(id);
    } else {
        window.dirtyInputsRegistry.delete(id);
    }

    // Stav aplikace je dirty pouze tehdy, pokud je v registru aspoň jeden reálně změněný prvek
    _isAppFormDirty = (window.dirtyInputsRegistry.size > 0);
};

document.addEventListener('change', (e) => {
    analyzujRealnyStavZmenyPrvku(e.target);
});

document.addEventListener('input', (e) => {
    if (e.target && e.target.classList.contains('bonus-text-input')) {
        analyzujRealnyStavZmenyPrvku(e.target);
    }
});

// 🔒 Pomocná funkce pro zobrazení nádherného varovného modálu z ui.js
const zobrazVarovnyModal = (onConfirm) => {
    const modalContent = `
        <div style="padding: 15px; text-align: center; color: #ffffff; font-family: 'Segoe UI', sans-serif;">
            <p style="font-size: 1rem; color: #f87171; font-weight: bold; margin-bottom: 15px; text-transform: uppercase; letter-spacing: 0.5px;">⚠️ NEULOŽENÉ ZMĚNY</p>
            <p style="font-size: 0.9rem; color: #9ca3af; line-height: 1.4; margin-bottom: 20px;">
                Máš rozvrtané tipy nebo výsledky, které ještě nejsou bezpečně zapsané! Pokud odejdeš, tvá práce bude trvale ztracena.
            </p>
            <div style="display: flex; gap: 10px; justify-content: center;">
                <button id="dirty-modal-stay" class="action-btn" style="margin:0; background: #059669; padding: 10px 16px; font-size: 0.85rem; font-family: 'Oswald', sans-serif; width: auto; border-radius: 6px;">ZŮSTAT A ULOŽIT</button>
                <button id="dirty-modal-leave" class="action-btn" style="margin:0; background: #4b5563; padding: 10px 16px; font-size: 0.85rem; font-family: 'Oswald', sans-serif; width: auto; border-radius: 6px;">ODEJÍT BEZ ULOŽENÍ</button>
            </div>
        </div>
    `;
    window.openGlobalUiModal("POZOR! ODCHÁZÍŠ ZE STADIONU", modalContent);

    const overlay = document.querySelector('.spy-modal-overlay');
    document.getElementById('dirty-modal-stay').onclick = () => { if (overlay) overlay.remove(); };
    document.getElementById('dirty-modal-leave').onclick = () => {
        window.isAppFormDirty = false;
        if (overlay) overlay.remove();
        onConfirm();
    };
};

// 📱 Sledujeme hardwarové/systémové gesto nebo tlačítko zpět zespodu mobilu
window.addEventListener('popstate', (event) => {
    const store = Alpine.store('appState');
    if (!store) return;
    if (store.currentScreen === 'leaguesScreen') return; 

    const navratovaObrazovka = (event.state && event.state.screen) ? event.state.screen : 'leaguesScreen';
    if (window.isAppFormDirty) {
        window.history.pushState({ screen: store.currentScreen }, "");
        zobrazVarovnyModal(() => {
            window.isAppFormDirty = false;
            window.goToScreen(navratovaObrazovka, false);
        });
        return;
    }
    window.goToScreen(navratovaObrazovka, false);
});

// 🎭 LOUTKOVODIČ & SPY KŘÍŽEK INTERCEPTOR
document.addEventListener('click', (e) => {
    const modal = document.getElementById('loutkovodic-modal');
    if (!modal) return;

    const closeBtn = e.target.closest('.spy-modal-close');
    const clickedOutside = e.target === modal;

    if ((closeBtn || clickedOutside) && window.isAppFormDirty) {
        e.stopPropagation();
        e.preventDefault();
        zobrazVarovnyModal(() => {
            window.isAppFormDirty = false;
            modal.remove();
        });
    }
}, true);

// 🚨 Nativní jistič prohlížeče pro případ zavření celé karty nebo Ctrl+R
window.addEventListener('beforeunload', (e) => {
    if (window.isAppFormDirty) {
        e.preventDefault();
        e.returnValue = '';
    }
});

// 🚀 NEPRŮSTŘELNÝ NATIVNÍ INTERCEPTOR PRO NAVIGACI (Bezpečná Proxy bez časové Race Condition)
let klientskaNavigaceApp = null;

const interceptorGoToScreen = (screenName, pushToHistory = true) => {
    if (window.isAppFormDirty) {
        zobrazVarovnyModal(() => {
            window.isAppFormDirty = false;
            interceptorGoToScreen(screenName, pushToHistory);
        });
        return;
    }

    if (typeof klientskaNavigaceApp === 'function') {
        klientskaNavigaceApp(screenName, pushToHistory);
    } else {
        const store = Alpine.store('appState');
        if (store) store.currentScreen = screenName;
    }
};

// Vytvoříme inteligentní vlastnost na objektu window, která schová klientskou funkci pod pokličku, jakmile se zapíše
Object.defineProperty(window, 'goToScreen', {
    configurable: true,
    enumerable: true,
    get() {
        return interceptorGoToScreen;
    },
    set(novaNavigace) {
        if (novaNavigace !== interceptorGoToScreen) {
            klientskaNavigaceApp = novaNavigace;
        }
    }
});

// =========================================================================
// 🎭 LOUTKOVODIČ REAKTIVNÍ CONTROLLER (ČISTÁ DATAVÁ FUNKČNOST BEZ HTML)
// =========================================================================
window.openLoutkovodicModal = (uid) => {
    const store = Alpine.store('appState');
    if (!store) return;

    // 🧠 CHYTRÝ RESOLVER HRÁČE: Hledáme v reaktivním Alpine poli i záložní cache
    const uItem = store.adminUsers?.find(u => u.id === uid) 
               || store.adminUsersCache?.find(u => u.id === uid)
               || window.adminUsersCache?.find(docSnap => docSnap.id === uid)?.data() || {};
    
    store.loutkovodicTargetUid = uid;
    store.loutkovodicTargetNickname = uItem.nickname || 'Hráč';
    store.loutkovodicTargetEmail = uItem.email || '';
    store.loutkovodicSelectedLeague = '';
    store.loutkovodicBonusVitez = '';
    store.loutkovodicBonusStrelec = '';
    store.loutkovodicMatches = [];
    store.loutkovodicMatchesLoaded = false;
    
    window.isAppFormDirty = false;
    store.loutkovodicOpen = true;
};

window.loadLoutkovodicLeagueData = async () => {
    const store = Alpine.store('appState');
    if (!store || !store.loutkovodicSelectedLeague) return;

    store.loutkovodicMatchesLoaded = false;
    store.loutkovodicMatches = [];

    try {
        const leagueName = store.loutkovodicSelectedLeague;
        const ligaKlic = leagueName.replace(/ /g, '_');
        const uid = store.loutkovodicTargetUid;
        const sezonaId = store.activeSeason || window.SEZONA_ID || "2026_2027";

        let rozpisData = null;
        if (store.selectedLeague === leagueName && store.rozpisData) {
            rozpisData = store.rozpisData;
        }

        // 🚀 BLESKOVÉ STAŽENÍ TIPŮ ZE SEZÓNY A ROZPISU Z R2 EDGE
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

        store.loutkovodicBonusVitez = bonusData.vitez || '';
        store.loutkovodicBonusStrelec = bonusData.strelec || '';

        const serazeneZapasy = Object.keys(zapasyMapa).map(id => {
            const match = zapasyMapa[id];
            const tip = existujiciTipy[id] || {};
            return {
                id,
                ...match,
                tip_domaci: tip.tip_domaci !== undefined ? String(tip.tip_domaci) : '',
                tip_hoste: tip.tip_hoste !== undefined ? String(tip.tip_hoste) : '',
                saved_domaci: tip.tip_domaci !== undefined ? String(tip.tip_domaci) : '',
                saved_hoste: tip.tip_hoste !== undefined ? String(tip.tip_hoste) : '',
                postup: tip.postup || '',
                hasTip: tip.tip_domaci !== undefined
            };
        });

        // 🚀 CHRONOLOGICKÉ ŘAZENÍ PODLE DATUMU A ČASU VÝKOPU
        serazeneZapasy.sort((a, b) => {
            const dA = a.datum?.toDate ? a.datum.toDate() : new Date(a.datum || 0);
            const dB = b.datum?.toDate ? b.datum.toDate() : new Date(b.datum || 0);
            return dA - dB;
        });

        store.loutkovodicMatches = serazeneZapasy;
        store.loutkovodicMatchesLoaded = true;
        
        // Asynchronní aktivace zeleného play-off boxu, pokud už existují remízové tipy
        setTimeout(() => {
            serazeneZapasy.forEach(m => {
                if (m.isPlayoff && m.tip_domaci !== '' && parseInt(m.tip_domaci) === parseInt(m.tip_hoste) && m.postup) {
                    window.handleProxyScoreChange(m.id, true);
                    window.selectProxyPlayoff(m.id, m.postup);
                }
            });
        }, 50);

    } catch (err) {
        console.error(err);
        store.loutkovodicMatchesLoaded = true;
    }
};

window.handleProxyScoreChange = (matchId, isPlayoff) => {
    if (!isPlayoff) return;
    const d = document.getElementById(`proxy-tip-domaci-${matchId}`)?.value;
    const h = document.getElementById(`proxy-tip-hoste-${matchId}`)?.value;
    const box = document.getElementById(`proxy-playoff-box-${matchId}`);
    if (box) {
        if (d !== undefined && h !== undefined && d !== "" && h !== "" && parseInt(d) === parseInt(h)) {
            box.style.display = 'flex';
        } else {
            box.style.display = 'none';
            const hidden = document.getElementById(`proxy-playoff-val-${matchId}`);
            if (hidden) hidden.value = '';
            const bD = document.getElementById(`proxy-playoff-dom-${matchId}`);
            const bH = document.getElementById(`proxy-playoff-hos-${matchId}`);
            if (bD) { bD.style.background = '#1f2937'; bD.style.color = '#9ca3af'; }
            if (bH) { bH.style.background = '#1f2937'; bH.style.color = '#9ca3af'; }
        }
    }
};

window.selectProxyPlayoff = (matchId, choice) => {
    const hidden = document.getElementById(`proxy-playoff-val-${matchId}`);
    if (hidden) hidden.value = choice;
    const btnDom = document.getElementById(`proxy-playoff-dom-${matchId}`);
    const btnHos = document.getElementById(`proxy-playoff-hos-${matchId}`);
    if (choice === 'domaci') {
        if (btnDom) { btnDom.style.background = '#ea580c'; btnDom.style.color = '#fff'; }
        if (btnHos) { btnHos.style.background = '#1f2937'; btnHos.style.color = '#9ca3af'; }
    } else if (choice === 'hoste') {
        if (btnHos) { btnHos.style.background = '#ea580c'; btnHos.style.color = '#fff'; }
        if (btnDom) { btnDom.style.background = '#1f2937'; btnDom.style.color = '#9ca3af'; }
    }
};

window.submitProxyData = async () => {
    const store = Alpine.store('appState');
    if (!store) return;

    const uid = store.loutkovodicTargetUid;
    const email = store.loutkovodicTargetEmail;
    const leagueName = store.loutkovodicSelectedLeague;
    const btn = document.getElementById('proxy-submit-btn');

    if (!uid || !leagueName) return;

    window.showToast("⏳ Vstřikuji proxy data přes Cloud...", false);

    const vitezVal = store.loutkovodicBonusVitez.trim();
    const strelecVal = store.loutkovodicBonusStrelec.trim();

    const tipyMapa = {};
    let chybajuciPostup = false;

    store.loutkovodicMatches.forEach(match => {
        const selDom = document.getElementById(`proxy-tip-domaci-${match.id}`);
        const selHos = document.getElementById(`proxy-tip-hoste-${match.id}`);
        const dVal = selDom ? selDom.value : '';
        const hVal = selHos ? selHos.value : '';

        if (dVal !== "" && hVal !== "") {
            const hiddenInput = document.getElementById(`proxy-playoff-val-${match.id}`);
            let postupVal = hiddenInput ? hiddenInput.value : '';

            if (parseInt(dVal) === parseInt(hVal) && match.isPlayoff && !postupVal) {
                chybajuciPostup = true;
            }

            tipyMapa[match.id] = {
                tip_domaci: parseInt(dVal),
                tip_hoste: parseInt(hVal),
                postup: postupVal
            };
        }
    });

    if (chybajuciPostup) {
        window.showToast("🏆 V play-off musíš při remíze zvolit postupujícího!", true);
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.style.opacity = "0.5";
        btn.innerText = "⏳...";
    }

    try {
        const functions = getFunctions(window.app);
        const saveProxyData = httpsCallable(functions, 'saveProxyDataCF');

        await saveProxyData({
            targetUid: uid,
            targetEmail: email,
            leagueName: leagueName,
            vitez: vitezVal,
            strelec: strelecVal,
            tipyMapa: tipyMapa
        });

        window.showToast("🎭 Data bezpečně uložena za hráče!");
        window.isAppFormDirty = false;
        store.loutkovodicOpen = false;

    } catch (err) {
        console.error(err);
        window.showToast("❌ Server proxy zápis odmítl.", true);
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = "1";
            btn.innerText = "💾 ZAPSAT";
        }
    }
};

window.handleLoutkovodicCloseIntercept = () => {
    const store = Alpine.store('appState');
    // Využijeme tvůj vestavěný interceptor varovného modálu z render.js
    if (typeof window.zobrazVarovnyModal === 'function') {
        window.zobrazVarovnyModal(() => {
            window.isAppFormDirty = false;
            if (store) store.loutkovodicOpen = false;
        });
    } else {
        window.isAppFormDirty = false;
        if (store) store.loutkovodicOpen = false;
    }
};

// =========================================================================
// 🏴󠁧󠁢󠁥󠁮󠁧󠁿 PREMIER LEAGUE 2026/2027 - MATICE KOŠŮ A DERBY RIVALIT (ROZŠÍŘENÁ NORMALIZACE)
// =========================================================================

const PL_BASKETS = {
    basket1: [
        "man city", "manchester city", "man. city",
        "arsenal",
        "liverpool",
        "man united", "manchester united", "man. united", "man utd", "man. utd",
        "aston villa",
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
        "newcastle", "newcastle united",
        "brighton", "brighton & hove albion", "brighton and hove albion",
        "tottenham", "tottenham hotspur", "spurs",
        "brentford",
        "crystal palace",
        "bournemouth", "afc bournemouth",
        "fulham"
    ],
    basket3: [
        "everton",
        "nottingham", "nottingham forest",
        "sunderland",
        "leeds", "leeds united",
        "ipswich", "ipswich town",
        "coventry", "coventry city",
        "hull", "hull city"
    ]
};

const PL_DERBY_PAIRINGS = [
    ["liverpool", "manchester united"], ["liverpool", "man united"], ["liverpool", "man. united"],
    ["manchester city", "manchester united"], ["man city", "man united"], ["man. city", "man. united"],
    ["arsenal", "tottenham hotspur"], ["arsenal", "tottenham"],
    ["arsenal", "chelsea"],
    ["chelsea", "tottenham hotspur"], ["chelsea", "tottenham"],
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

// 1. OTEVŘENÍ MODÁLU - ZOBRAZENÍ AKTUÁLNÍHO STAVU Z DATABÁZE (PRVNÍ KROK)
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

    document.querySelector('.spy-modal-overlay')?.remove();

    // 🎯 Skenujeme rozpis a spočítáme statistiky pro AKTUÁLNĚ ULOŽENÉ TOP zápasy z DB
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

// 2. SPUŠTĚČ ALGORITMU - STRIKTNÍ BEZ-DUPLICITNÍ GENERÁTOR (100% BEZ ODVET A DUPLICIT)
window.generujNoveTopZapasy = async () => {
    const store = Alpine.store('appState');
    const activeAdminLeague = store?.selectedAdminLeague;
    const zapasy = store?.adminMatches || [];

    if (!activeAdminLeague || zapasy.length === 0) return;

    document.querySelector('.spy-modal-overlay')?.remove();
    window.showToast("⚡ Generuji rozpis TOP zápasů bez odvet...", false);

    const kolaMapa = {};
    zapasy.forEach(m => {
        const nazevKola = window.prelozFaziTurnaje(m.stage, m.kolo, m.isPlayoff);
        if (!kolaMapa[nazevKola]) kolaMapa[nazevKola] = [];
        kolaMapa[nazevKola].push(m);
    });

    const seznamKol = Object.keys(kolaMapa);

    let nejlepsiPokus = null;
    let nejlepsiPocetKol = -1;

    // Vnitřní optimalizační cyklus pro nalezení 100% bezchybné kombinace
    for (let pokus = 0; pokus < 500; pokus++) {
        const vybraneTopMatchIds = [];
        const tymTopPocet = {};
        const tymPosledniKolo = {};
        const odehraneDvojice = new Set();
        const tymStats = {};
        let obsazenoInLoop = 0;

        seznamKol.forEach((nazevKola, koloIdx) => {
            const zapasyVKole = kolaMapa[nazevKola] || [];
            let nejlepsiZapas = null;
            let maxScore = -9999999;

            zapasyVKole.forEach(z => {
                const d = String(z.domaci || 'Neznámý').trim();
                const h = String(z.hoste || 'Neznámý').trim();
                const dvojiceKlic = [PL_NORM(d), PL_NORM(h)].sort().join(' vs ');

                const kosD = PL_URCI_KOS(d);
                const kosH = PL_URCI_KOS(h);

                // 🛑 ABSOLUTNÍ ZÁKAZ 1: Koš 1 vs Koš 3 NIKDY!
                if ((kosD === 1 && kosH === 3) || (kosD === 3 && kosH === 1)) return;

                // 🛑 ABSOLUTNÍ ZÁKAZ 2: ŽÁDNÁ DUPLICITNÍ DVOJICE TÝMŮ V SEZÓNĚ!
                if (odehraneDvojice.has(dvojiceKlic)) return;

                const cD = tymTopPocet[d] || 0;
                const cH = tymTopPocet[h] || 0;

                // 🛑 ABSOLUTNÍ STROP: Max 4 zápasy na tým
                if (cD >= 4 || cH >= 4) return;

                let score = 0;
                const dBig5 = PL_JE_BIG5(d);
                const hBig5 = PL_JE_BIG5(h);

                if (dBig5 && hBig5) score += 150;
                else if (kosD === 1 && kosH === 1) score += 110;
                else if (kosD === 1 && kosH === 2) score += 85;
                else if (kosD === 2 && kosH === 2) score += 65;
                else if (kosD === 2 && kosH === 3) score += 40;
                else score += 10;

                const jeDerby = PL_DERBY_PAIRINGS.some(pair => {
                    const p0 = PL_NORM(pair[0]); const p1 = PL_NORM(pair[1]);
                    const nd = PL_NORM(d); const nh = PL_NORM(h);
                    return (nd.includes(p0) && nh.includes(p1)) || (nd.includes(p1) && nh.includes(p0));
                });
                if (jeDerby) score += 30;

                // Tlak na dokončení 4 zápasů u Koše 1
                if (kosD === 1 && cD < 4) score += (4 - cD) * 35;
                if (kosH === 1 && cH < 4) score += (4 - cH) * 35;

                // Tlak na min 3 u ostatních
                if (cD < 3) score += 20;
                if (cH < 3) score += 20;

                // Penalizace za nasycenost
                score -= (cD * 15) + (cH * 15);

                const lastD = tymPosledniKolo[d];
                const lastH = tymPosledniKolo[h];
                if (lastD !== undefined && Math.abs(koloIdx - lastD) < 3) score -= 30;
                if (lastH !== undefined && Math.abs(koloIdx - lastH) < 3) score -= 30;

                score += Math.random() * 15;

                if (score > maxScore) {
                    maxScore = score;
                    nejlepsiZapas = z;
                }
            });

            if (nejlepsiZapas) {
                const d = String(nejlepsiZapas.domaci || 'Neznámý').trim();
                const h = String(nejlepsiZapas.hoste || 'Neznámý').trim();
                const dvojiceKlic = [PL_NORM(d), PL_NORM(h)].sort().join(' vs ');

                vybraneTopMatchIds.push(nejlepsiZapas.id);
                tymTopPocet[d] = (tymTopPocet[d] || 0) + 1;
                tymTopPocet[h] = (tymTopPocet[h] || 0) + 1;
                tymPosledniKolo[d] = koloIdx;
                tymPosledniKolo[h] = koloIdx;
                odehraneDvojice.add(dvojiceKlic);

                if (!tymStats[d]) tymStats[d] = { count: 0, matches: [] };
                tymStats[d].count++;
                tymStats[d].matches.push({ kolo: nazevKola, protivnik: h });

                if (!tymStats[h]) tymStats[h] = { count: 0, matches: [] };
                tymStats[h].count++;
                tymStats[h].matches.push({ kolo: nazevKola, protivnik: d });

                obsazenoInLoop++;
            }
        });

        if (obsazenoInLoop > nejlepsiPocetKol) {
            nejlepsiPocetKol = obsazenoInLoop;
            nejlepsiPokus = { vybraneTopMatchIds, tymStats, pocetKol: seznamKol.length };
        }

        if (obsazenoInLoop === 38) break; // Při plném počtu 38 kol ihned končíme
    }

    if (nejlepsiPokus) {
        window.vygenerovaneTopMatchIdsCache = nejlepsiPokus.vybraneTopMatchIds;
        window.otevriTopMatchesDashboardModal(nejlepsiPokus.tymStats, nejlepsiPokus.vybraneTopMatchIds.length, nejlepsiPokus.pocetKol, true);
    }
};

// 3. UI MODAL - S KONTROLOU ZDA JDE O AKTUÁLNÍ STAV NEBO NOVÝ NÁVRH (isProposal)
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
                <button class="action-btn" style="margin: 0; background: #4b5563; padding: 10px 14px; font-size: 0.82rem; font-family: 'Oswald', sans-serif; width: auto; border-radius: 6px;" onclick="document.querySelector('.spy-modal-overlay')?.remove()">❌ ZAVŘÍT</button>
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

    document.querySelector('.spy-modal-overlay')?.remove();
    if (typeof window.showSplash === 'function') window.showSplash("Ukládám TOP zápasy...");

    try {
        const { writeBatch, doc } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js");
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