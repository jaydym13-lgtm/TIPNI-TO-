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

// 🎨 CANVAS PRE-RENDER ENGINE S MEMOIZACÍ (L1 RAM CACHE): Bleskový výpočet z paměti
const canvasContext = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
const fontPismoCache = {};

window.vypocitejOptimalniPismo = (domaci, hoste) => {
    const dvojiceText = `${domaci} – ${hoste}`;
    if (!dvojiceText || !canvasContext) return '0.95rem';

    // ⚡ L1 CACHE: Pokud už byl zápas jednou změřen, vrátíme výsledek za 0.001 ms bez spouštění Canvasu
    if (fontPismoCache[dvojiceText]) {
        return fontPismoCache[dvojiceText];
    }
    
    // Měření při výchozí plné velikosti 0.95rem (~15.2px)
    canvasContext.font = "bold 15.2px 'Segoe UI', sans-serif";
    const sirkaPx = canvasContext.measureText(dvojiceText).width;
    
    const targetPx = 175; // 🎯 Reálná cílová šířka textu v kartě na mobilu
    
    if (sirkaPx <= targetPx) {
        fontPismoCache[dvojiceText] = '0.95rem';
        return '0.95rem';
    }
    
    // Přesný plynulý poměr: mírný přesah přesáhne mírně, extrémní přesah spadne až k 0.76rem
    const spocitaneRem = (targetPx / sirkaPx) * 0.95;
    const pismoRem = Math.max(0.76, spocitaneRem);
    const vysledek = `${pismoRem.toFixed(2)}rem`;
    
    fontPismoCache[dvojiceText] = vysledek;
    return vysledek;
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
            // ⚡ PROFI UI REAKTIVITA: Okamžitý přepis v RAM paměti Alpine storu i L1 Cache
                const store = Alpine.store('appState');
                if (store) {
                    if (!store.mojeTipy) store.mojeTipy = {};
                    store.mojeTipy[matchId] = { tip_domaci: dVal, tip_hoste: hVal, postup: postupVal };
                    if (!store.rozvrtaneTipy) store.rozvrtaneTipy = {};
                    store.rozvrtaneTipy[`${matchId}_domaci`] = String(dVal);
                    store.rozvrtaneTipy[`${matchId}_hoste`] = String(hVal);
                    store.rozvrtaneTipy[`${matchId}_postup`] = postupVal;

                    // ⚡ L1 CACHE SYNC: Okamžitý zápis do surové paměti sezóny
                    if (!store.rawSezonaData) store.rawSezonaData = { souteze: {} };
                    if (!store.rawSezonaData.souteze) store.rawSezonaData.souteze = {};
                    if (!store.rawSezonaData.souteze[ligaKlic]) store.rawSezonaData.souteze[ligaKlic] = { tipy: {} };
                    if (!store.rawSezonaData.souteze[ligaKlic].tipy) store.rawSezonaData.souteze[ligaKlic].tipy = {};
                    store.rawSezonaData.souteze[ligaKlic].tipy[matchId] = { tip_domaci: dVal, tip_hoste: hVal, postup: postupVal };
                }

                // ⚪ OKAMŽITÉ PŘEBARVENÍ ROLETOEK NA BÍLO PO ULOŽENÍ
                const dSel = document.getElementById(`tip-domaci-${matchId}`);
                const hSel = document.getElementById(`tip-hoste-${matchId}`);
                if (dSel) { dSel.style.color = '#ffffff'; dSel.dataset.saved = String(dVal); dSel.style.borderColor = ''; }
                if (hSel) { hSel.style.color = '#ffffff'; hSel.dataset.saved = String(hVal); hSel.style.borderColor = ''; }

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

    if (typeof Alpine !== 'undefined' && Alpine.nextTick) {
        Alpine.nextTick(() => {
            const inputVitez = document.getElementById('bonus-vitez');
            const inputStrelec = document.getElementById('bonus-strelec');
            const btnBonus = document.getElementById('btn-save-bonus');

            if (inputVitez) inputVitez.value = mojeBonusy.vitez || '';
            if (inputStrelec) inputStrelec.value = mojeBonusy.strelec || '';
            if (btnBonus) btnBonus.innerText = (mojeBonusy.vitez || mojeBonusy.strelec) ? 'ULOŽENO ✔' : 'ULOŽIT DLOUHODOBÉ TIPY';
        });
    }
};

// 🪐 UKLÁDÁNÍ DLOUHODOBÝCH BONUSŮ DO SEZÓNY
window.saveBonusTips = async () => {
    const user = window.auth.currentUser;
    const store = Alpine.store('appState');
    const leagueName = store?.selectedLeague;
    if (!user || !leagueName) return;

    if (!navigator.onLine) {
        window.showToast("⚠️ Jsi offline! Pro uložení bonusů se připoj k internetu.", true);
        return;
    }

    const vitezValue = store?.mojeBonusy?.vitez || '';
    const strelecValue = store?.mojeBonusy?.strelec || '';
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

        window.showToast(`🎁 Dlouhodobé tipy pro ${leagueName} úspěšně uloženy!`);
        window.loadBonusTips(leagueName);
    } catch (e) {
        console.error(e);
        if (btnBonus) btnBonus.innerText = 'ULOŽIT';
    }
};

// 2. KROK: ŽEBŘÍČEK (ČISTÁ VNITŘNÍ PAMĚŤ - 0 READS POŽADAVKŮ PŘI PŘEKLIKÁVÁNÍ TABŮ)
window.renderLeaderboard = (resetExpanded = false) => {
    const store = Alpine.store('appState');
    const leagueName = store ? store.selectedLeague : null;
    const container = document.querySelector('#leaderboardScreen .zebra-container');
    if (!container) return;

    if (!leagueName) {
        container.innerHTML = '<div class="db-empty-msg">⚠️ Žebříček je izolovaný. Nejprve běž Domů a klikni na konkrétní ligu!</div>';
        return;
    }

    // 🛡️ STATE GUARD: Pokud žádný zápas neběží LIVE, tab 'live' je neplatný -> fallback na 'total'
    const isLiveAvailable = Boolean(store?.isLive);
    if (!isLiveAvailable && window.leaderboardActiveTab === 'live') {
        window.leaderboardActiveTab = 'total';
    }

    window.leaderboardActiveTab = window.leaderboardActiveTab || 'total';
    window.leaderboardActiveSubTab = window.leaderboardActiveSubTab || 'table';

    // 🛡️ SUBTAB GUARD: V LIVE režimu je podzáložka 'radar' zakázaná -> auto-reset na 'table'
    if (window.leaderboardActiveTab === 'live' && window.leaderboardActiveSubTab === 'radar') {
        window.leaderboardActiveSubTab = 'table';
    }
    
    const tab = window.leaderboardActiveTab;
    const subTab = window.leaderboardActiveSubTab;

    // 🔴 PŘEPNUTÍ CELÉ ZDI / TAPETY OBRAZOVKY DO LIVE MÓDU
    const lbScreen = document.getElementById('leaderboardScreen');
    if (lbScreen) {
        if (tab === 'live') {
            lbScreen.classList.add('is-live-mode');
        } else {
            lbScreen.classList.remove('is-live-mode');
        }
    }

    if (resetExpanded) {
        window.rozbaleneUidsCacheGlobal = [];
    } else {
        const nalezeneRozbaleneUids = [];
        container.querySelectorAll('.leaderboard-row-wrapper').forEach(w => {
            const dropdown = w.querySelector('.leaderboard-row-dropdown');
            if (dropdown && dropdown.style.display === 'block' && w.dataset.uid) {
                nalezeneRozbaleneUids.push(w.dataset.uid);
            }
        });
        
        if (nalezeneRozbaleneUids.length > 0 || container.querySelector('.leaderboard-row-wrapper')) {
            window.rozbaleneUidsCacheGlobal = nalezeneRozbaleneUids;
        }
    }

    const subBtnTableStyle = subTab === 'table' ? 'is-active' : '';
    const subBtnStatsStyle = subTab === 'stats' ? 'is-active' : '';
    const subBtnRadarStyle = subTab === 'radar' ? 'is-active' : '';

    const screenHeaderTitle = document.querySelector('#leaderboardScreen h2');
    if (screenHeaderTitle) {
        screenHeaderTitle.innerText = tab === 'live' ? '🔴 LIVE POŘADÍ' : '🏆 POŘADÍ';
    }

    container.innerHTML = `
        <div class="leaderboard-tabs-wrapper">
            <button class="nav-btn-leaderboard ${tab === 'total' ? 'is-active is-total' : ''}" onclick="window.leaderboardActiveTab='total'; window.leaderboardActiveSubTab='table'; window.renderLeaderboard(true);">
                🏆 Pořadí
            </button>
            <button class="nav-btn-leaderboard class-live-btn-tab ${tab === 'live' ? 'is-active is-live' : ''}" style="display: ${isLiveAvailable ? 'flex' : 'none'};" onclick="window.leaderboardActiveTab='live'; window.leaderboardActiveSubTab='table'; window.renderLeaderboard(true);">
                🔴 LIVE Pořadí
            </button>
        </div>
        <div class="leaderboard-subtabs-wrapper ${tab === 'live' ? 'is-live-subtabs' : ''}">
            <button class="nav-subbtn-leaderboard ${subBtnTableStyle}" onclick="window.leaderboardActiveSubTab='table'; window.renderLeaderboard(false);">
                📋 Tabulka
            </button>
            <button class="nav-subbtn-leaderboard ${subBtnStatsStyle}" onclick="window.leaderboardActiveSubTab='stats'; window.renderLeaderboard(false);">
                📊 Statistiky
            </button>
            ${tab !== 'live' ? `
            <button class="nav-subbtn-leaderboard ${subBtnRadarStyle}" onclick="window.leaderboardActiveSubTab='radar'; window.renderLeaderboard(false);">
                👀 Zajímavosti
            </button>` : ''}
        </div>
        <div class="leaderboard-content-area ${tab === 'live' ? 'is-live-mode' : ''}"></div>
        <button id="myRankFab" class="my-rank-fab ${tab === 'live' ? 'is-live' : ''}" style="display: none;" onclick="window.scrollToMyRank()"></button>
    `;

    const contentArea = container.querySelector('.leaderboard-content-area');
    const leaderboardData = store?.leaderboardData;

    if (!leaderboardData) {
        contentArea.innerHTML = `<div class="db-empty-msg" style="color:#fbbf24;">Žebříček se na pozadí připravuje... ⚙️</div>`;
        const liveBtn = document.querySelector('.class-live-btn-tab');
        if (liveBtn) liveBtn.style.display = 'none';
        return;
    }

    if (subTab === 'stats') {
        window.vykresliRekordyAStatistiky(leaderboardData, contentArea, tab, leagueName);
    } else if (subTab === 'radar') {
        window.vykresliRadar(leaderboardData, contentArea, tab, leagueName);
    } else {
        window.vykresliDataZebříčku(leaderboardData, contentArea, tab, leagueName);
    }
};

// 🏆 ČISTÉ VYKRESLENÍ TABULKY HRÁČŮ (BEZ JAKÉKOLIV ROLETKY NAD JMÉNY)
window.vykresliDataZebříčku = (centralDoc, contentArea, tab, leagueName) => {
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
    const uidsKObnoveni = window.rozbaleneUidsCacheGlobal || [];

    // ⏱️ ENTERPRISE TIMESTAMP ROW
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

    let aktualniPoradiCislo = 1;

    zebricek.forEach((stats, index) => {
        const row = document.createElement('div');
        const isMe = stats.uid && stats.uid === window.auth?.currentUser?.uid;
        row.className = `leaderboard-row-wrapper ${isMe ? 'is-current-user' : ''}`;
        row.dataset.uid = stats.uid;

        if (index > 0) {
            const prev = zebricek[index - 1];
            const jeUplnaShoda = (
                stats.celkemBodu === prev.celkemBodu &&
                (stats.presneVysledkyCount || 0) === (prev.presneVysledkyCount || 0) &&
                (stats.presneTopMatchesCount || 0) === (prev.presneTopMatchesCount || 0) &&
                (stats.spravneTendenceCount || 0) === (prev.spravneTendenceCount || 0) &&
                (stats.nenatipovaneVyhodnocene || 0) === (prev.nenatipovaneVyhodnocene || 0) &&
                (stats.vyhranaKolaCount || 0) === (prev.vyhranaKolaCount || 0) &&
                (stats.nejviceBoduVKole || 0) === (prev.nejviceBoduVKole || 0) &&
                Number(stats.efektivitaProcento || 0).toFixed(2) === Number(prev.efektivitaProcento || 0).toFixed(2)
            );
            if (!jeUplnaShoda) {
                aktualniPoradiCislo = index + 1;
            }
        } else {
            aktualniPoradiCislo = 1;
        }

        let pozice = aktualniPoradiCislo === 1 ? '🥇' : (aktualniPoradiCislo === 2 ? '🥈' : (aktualniPoradiCislo === 3 ? '🥉' : `${aktualniPoradiCislo}.`));
        let deltaHtml = '';
        if (tab === 'live') {
            const existujeDohranyZapas = (centralDoc.zebricek || []).some(p => (p.natipovaneVyhodnocene > 0 || p.nenatipovaneVyhodnocene > 0 || p.celkemBodu !== 0));

            if (existujeDohranyZapas) {
                const delta = stats.poziceDelta || 0;
                if (delta > 0) {
                    deltaHtml = ` <span style="color: #10b981; font-size: 0.8rem; font-weight: bold; margin-left: 6px; font-family: 'Oswald', sans-serif;">▲ ${delta}</span>`;
                } else if (delta < 0) {
                    deltaHtml = ` <span style="color: #ef4444; font-size: 0.8rem; font-weight: bold; margin-left: 6px; font-family: 'Oswald', sans-serif;">▼ ${Math.abs(delta)}</span>`;
                } else {
                    deltaHtml = ` <span style="color: #6b7280; font-size: 0.8rem; font-weight: bold; margin-left: 6px; font-family: 'Oswald', sans-serif;">–</span>`;
                }
            }
        }

        let bonusRowsHtml = '';
        if (tab === 'total') {
            const isLeagueStarted = Alpine.store('appState')?.isLeagueStarted;
            const currentUid = window.auth?.currentUser?.uid;
            const isMe = stats.uid && stats.uid === currentUid;

            let vitezVal = (stats.vitezMs || '–').toUpperCase();
            let strelecVal = (stats.nejStrelec || '–').toUpperCase();

            if (!isLeagueStarted && !isMe) {
                vitezVal = '🔒 SKRYTO DO STARTU';
                strelecVal = '🔒 SKRYTO DO STARTU';
            }

            const vitezRowHtml = (leagueName === "Chance Liga") ? '' : `
                <div class="leaderboard-meta-row">
                    <span class="leaderboard-meta-label">🏆 TIP NA VÍTĚZE:</span>
                    <span class="leaderboard-meta-value">${vitezVal}</span>
                </div>
            `;

            bonusRowsHtml = `
                ${vitezRowHtml}
                <div class="leaderboard-meta-row">
                    <span class="leaderboard-meta-label">🥇 TIP NA STŘELCE:</span>
                    <span class="leaderboard-meta-value">${strelecVal}</span>
                </div>
            `;
        }

        row.setAttribute('data-uid', stats.uid);
        const melByBytOtevreny = uidsKObnoveni.includes(stats.uid);

        row.innerHTML = `
            <div onclick="const det = this.nextElementSibling; const arr = this.querySelector('.leaderboard-arrow-icon'); if(det.style.display==='none' || det.style.display===''){det.style.display='block'; arr.innerText='▲';}else{det.style.display='none'; arr.innerText='▼';}" class="leaderboard-row-trigger">
                <div class="leaderboard-row-left">
                    <span class="leaderboard-row-position">${pozice}</span>
                    <span class="leaderboard-row-nickname">${window.escapeHTML(stats.nickname)}${deltaHtml}</span>
                </div>
                <div class="leaderboard-row-right">
                    <div class="leaderboard-row-points ${stats.celkemBodu < 0 ? 'is-negative' : ''}">
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
                        <div class="leaderboard-stat-label">🔥 Přesné TOP zápasy</div>
                        <div class="leaderboard-stat-value-gold" style="color: #f97316;">${stats.presneTopMatchesCount || 0}x</div>
                    </div>
                    <div class="leaderboard-stat-card">
                        <div class="leaderboard-stat-label">👑 Hráč kola</div>
                        <div class="leaderboard-stat-value-gold" style="color: #c084fc;">${stats.vyhranaKolaCount || 0}x</div>
                    </div>
                    <div class="leaderboard-stat-card">
                        <div class="leaderboard-stat-label">⚽ Trefené tendence</div>
                        <div class="leaderboard-stat-value-cyan" style="color: #34d399;">${stats.spravneTendenceCount || 0}x</div>
                    </div>
                    <div class="leaderboard-stat-card">
                        <div class="leaderboard-stat-label">⚡ Max bodů za kolo</div>
                        <div class="leaderboard-stat-value-cyan">${stats.nejviceBoduVKole} b.${stats.nejviceBoduVKoleNazev && stats.nejviceBoduVKoleNazev !== '–' ? ` <span style="font-size: 0.75rem; color: #9ca3af; font-weight: normal; letter-spacing: 0px;">(${stats.nejviceBoduVKoleNazev})</span>` : ''}</div>
                    </div>
                    <div class="leaderboard-stat-card" ${(stats.otevrenaKola && stats.otevrenaKola.length > 1) ? `onclick="event.stopPropagation(); window.showPlayerOpenRoundsModal('${stats.uid}')" style="cursor: pointer; border-color: rgba(251,191,36,0.3); background: rgba(251,191,36,0.03);"` : ''}>
                        <div class="leaderboard-stat-label">
                            📈 ROZEHRANÉ KOLO
                        </div>
                        <div class="leaderboard-stat-value-cyan" style="color: #a7f3d0;">
                            ${(() => {
                                const ok = stats.otevrenaKola || [];
                                if (ok.length === 1) {
                                    return `${ok[0].points} b. <span style="font-size: 0.75rem; color: #9ca3af; font-weight: normal; letter-spacing: 0px;">(${ok[0].round})</span>`;
                                } else if (ok.length > 1) {
                                    const sumPts = ok.reduce((acc, r) => acc + (r.points || 0), 0);
                                    return `${sumPts >= 0 ? '+' : ''}${sumPts} b. <span style="font-size: 0.72rem; color: #fbbf24; font-weight: bold; letter-spacing: 0px;">(${ok.length} kola 👁️)</span>`;
                                } else {
                                    return `${stats.bodyKoloAktualni !== undefined ? stats.bodyKoloAktualni : 0} b. <span style="font-size: 0.75rem; color: #9ca3af; font-weight: normal; letter-spacing: 0px;">(–)</span>`;
                                }
                            })()}
                        </div>
                    </div>
                    <div class="leaderboard-stat-card">
                        <div class="leaderboard-stat-label">🏆 Perfektní kola</div>
                        <div class="leaderboard-stat-value-gold" style="color: #fbbf24;">${stats.perfektniKolaCount || 0}x</div>
                    </div>
                    <div class="leaderboard-stat-card">
                        <div class="leaderboard-stat-label">📊 Úspěšnost (Efektivita)</div>
                        <div class="leaderboard-stat-value-gold" style="color: #fbbf24; font-size: 0.85rem;">${Number(stats.efektivitaProcento || 0).toFixed(2)}% možných bodů</div>
                    </div>
                </div>
                ${bonusRowsHtml}
                <button onclick="window.showPlayerTipsModal('${stats.uid}', '${leagueName}')" class="leaderboard-spy-btn">
                    👁️ PROHLÉDNOUT TIPY HRÁČE
                </button>
            ${!isMe ? `
                <button onclick="window.showH2HModal('${stats.uid}')" class="leaderboard-h2h-btn">
                    ⚔️ POROVNAT SE MNOU
                </button>` : ''}
            </div>
        `;
        contentArea.appendChild(row);
    });

    window.rozbaleneUidsCacheGlobal = uidsKObnoveni;

    // 🎯 INTELIGENTNÍ DETEKCE POZICE HRÁČE (INTERSECTION OBSERVER)
    const myRow = contentArea.querySelector('.leaderboard-row-wrapper.is-current-user');
    const myFab = document.getElementById('myRankFab');

    if (window.myRankObserver) {
        window.myRankObserver.disconnect();
        window.myRankObserver = null;
    }

    if (myRow && myFab) {
        const myRankObj = zebricek.find(p => p.uid === window.auth?.currentUser?.uid);
        const myIdx = myRankObj ? (zebricek.indexOf(myRankObj) + 1) : null;
        if (myRankObj && myIdx) {
            myFab.innerHTML = `🎯 MOJE POZICE • ${myIdx}. (${myRankObj.celkemBodu} b.)`;
        }

        const scrollRoot = document.getElementById('leaderboardScreen');
        window.myRankObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                myFab.style.display = entry.isIntersecting ? 'none' : 'inline-flex';
            });
        }, { root: scrollRoot, threshold: 0.1 });

        window.myRankObserver.observe(myRow);
    } else if (myFab) {
        myFab.style.display = 'none';
    }
};

// 🎯 HLADKÝ SKOK NA VLASTNÍ POZICI PŘES PŘÍMÝ SCROLL KONTEJNERU (BEZ ČASOVAČE)
window.scrollToMyRank = () => {
    const lbScreen = document.getElementById('leaderboardScreen');
    const myRow = lbScreen?.querySelector('.leaderboard-row-wrapper.is-current-user');
    if (!lbScreen || !myRow) return;

    const targetTop = myRow.offsetTop - (lbScreen.clientHeight / 2) + (myRow.clientHeight / 2);
    lbScreen.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth'
    });

    myRow.classList.remove('is-scrolled-target');
    void myRow.offsetWidth;
    myRow.classList.add('is-scrolled-target');
    myRow.addEventListener('animationend', () => {
        myRow.classList.remove('is-scrolled-target');
    }, { once: true });
};

// 🎛️ EXPAND TOGGLER PRO JEDNORÁDKOVÝ PŘEHLED JMEN
window.toggleRekordRowExpand = (btn) => {
    const container = btn.closest('.rekord-names-container');
    if (!container) return;
    const collapsed = container.querySelector('.rekord-names-collapsed');
    const expanded = container.querySelector('.rekord-names-expanded');
    if (collapsed && expanded) {
        const isColl = collapsed.style.display !== 'none';
        collapsed.style.display = isColl ? 'none' : 'inline';
        expanded.style.display = isColl ? 'inline' : 'none';
    }
};

// 📊 DEDIKOVANÁ STRÁNKA: TV BROADCAST STRIP STATISTIKY (S ČÁRKAMI, ZNAKEM & A KOLY U OSOBNÍHO ŘÁDKU)
window.vykresliRekordyAStatistiky = (centralDoc, contentArea, tab, leagueName) => {
    if (!centralDoc) {
        contentArea.innerHTML = `<div class="db-empty-msg" style="color:#fbbf24;">Statistiky se na pozadí připravují... ⚙️</div>`;
        return;
    }

    const isLiveTab = (tab === 'live');
    const zebricek = isLiveTab ? (centralDoc.zebricekLive || []) : (centralDoc.zebricek || []);
    if (window.myRankObserver) {
        window.myRankObserver.disconnect();
        window.myRankObserver = null;
    }
    const myFab = document.getElementById('myRankFab');
    if (myFab) myFab.style.display = 'none';

    const myNick = Alpine.store('appState')?.nickname || '';
    const myUid = window.auth?.currentUser?.uid || '';
    const myNickClean = myNick.trim().toLowerCase();

    // ⏱️ TIMESTAMP SE STEJNOU LOGIKOU JAKO V TABULCE (DNES / VČERA / DATUM)
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

    // 👤 NALEZENÍ PŘIHLÁŠENÉHO UŽIVATELE
    const meObj = zebricek.find(p => (p.uid && p.uid === myUid) || (p.nickname && p.nickname.trim().toLowerCase() === myNickClean));

    // 🧠 FORMÁTOVÁNÍ SE SPOJKOU & A ČÁRKAMI (EDITORIAL FORMATTING)
    const formatNamesBroadcast = (namesStr) => {
        if (!namesStr) return '';
        const namesArr = namesStr.split(', ').map(n => n.trim()).filter(Boolean);
        
        let hasMe = false;
        let otherNames = [];

        namesArr.forEach(n => {
            const isMe = Boolean(myNickClean && (n.toLowerCase() === myNickClean || n.toLowerCase().startsWith(myNickClean + ' ')));
            if (isMe) hasMe = true;
            else otherNames.push(n);
        });

        const sortedNames = [];
        if (hasMe) {
            sortedNames.push({ name: myNick, isMe: true });
        }
        otherNames.forEach(n => {
            sortedNames.push({ name: n, isMe: false });
        });

        const renderItem = (item) => `<span class="rekord-name ${item.isMe ? 'is-me' : ''}">${window.escapeHTML(item.name)}</span>`;
        const ampSep = ` <span class="rekord-amp">&</span> `;
        const commaSep = `, `;

        // Plný výčet se znakem & před posledním jménem
        const formatFullList = (list) => {
            if (list.length === 0) return '';
            if (list.length === 1) return renderItem(list[0]);
            if (list.length === 2) return `${renderItem(list[0])}${ampSep}${renderItem(list[1])}`;
            const head = list.slice(0, -1).map(renderItem).join(commaSep);
            const tail = renderItem(list[list.length - 1]);
            return `${head}${ampSep}${tail}`;
        };

        if (sortedNames.length <= 1) {
            return `<div class="rekord-names-container">${formatFullList(sortedNames)}</div>`;
        }

        // Měření přes Canvas
        const screenW = typeof window !== 'undefined' ? (window.innerWidth || 380) : 380;
        const appMaxW = Math.min(screenW, 500);
        const availablePx = appMaxW - 128;

        if (canvasContext) {
            canvasContext.font = "600 13.5px 'Segoe UI', sans-serif";
        }

        const measurePx = (txt) => {
            if (!canvasContext) return txt.length * 7.5;
            return canvasContext.measureText(txt).width;
        };

        const commaWidth = measurePx(', ');
        const ampWidth = measurePx(' & ');

        // 1. Zkusíme, zda se vejdou VŠECHNA jména najednou
        let totalAllWidth = 0;
        sortedNames.forEach((item, idx) => {
            let sepWidth = 0;
            if (idx > 0) {
                sepWidth = (idx === sortedNames.length - 1) ? ampWidth : commaWidth;
            }
            totalAllWidth += measurePx(item.name) + sepWidth;
        });

        if (totalAllWidth <= availablePx) {
            return `<div class="rekord-names-container">${formatFullList(sortedNames)}</div>`;
        }

        // 2. Pokud ne, najdeme maximální počet jmen k, kde se vejde prefix + " a (N-k) dalších ▼"
        let bestK = 1;
        let currentPrefixWidth = measurePx(sortedNames[0].name);

        for (let i = 1; i < sortedNames.length; i++) {
            const nextNameWidth = commaWidth + measurePx(sortedNames[i].name);
            const remainingCount = sortedNames.length - (i + 1);
            
            if (remainingCount === 0) {
                break;
            }

            const tagText = ` a ${remainingCount} ${remainingCount === 1 ? 'další' : (remainingCount < 5 ? 'další' : 'dalších')} ▼`;
            const tagWidth = measurePx(tagText) + 6;

            if (currentPrefixWidth + nextNameWidth + tagWidth <= availablePx) {
                currentPrefixWidth += nextNameWidth;
                bestK = i + 1;
            } else {
                break;
            }
        }

        const visibleNames = sortedNames.slice(0, bestK);
        const hiddenCount = sortedNames.length - bestK;
        const visibleFormatted = visibleNames.map(renderItem).join(commaSep);
        const allFormatted = formatFullList(sortedNames);

        return `
            <div class="rekord-names-container">
                <span class="rekord-names-collapsed">
                    ${visibleFormatted} <span class="rekord-more-tag" onclick="window.toggleRekordRowExpand(this)"><span class="more-txt">a ${hiddenCount} ${hiddenCount === 1 ? 'další' : (hiddenCount < 5 ? 'další' : 'dalších')}</span> <span class="more-arr">▼</span></span>
                </span>
                <span class="rekord-names-expanded" style="display: none;">
                    ${allFormatted} <span class="rekord-less-tag" onclick="window.toggleRekordRowExpand(this)"><span class="more-arr">▲</span></span>
                </span>
            </div>
        `;
    };

    // ⚓ OSOBNÍ ŘÁDEK DOLE (POKUD HRÁČ NENÍ V TOP 3)
    const getMyAnchorRow = (top3Array, metricKey, suffix, customVal = null, customExtra = '') => {
        if (!myNick || !meObj) return '';
        const isInTop3 = top3Array.some(item => {
            const names = (item.names || item.text || '').toLowerCase();
            return names.split(', ').some(n => n.trim() === myNickClean || n.trim().startsWith(myNickClean + ' '));
        });
        if (isInTop3) return '';

        let val = customVal !== null ? customVal : (meObj[metricKey] || 0);
        if (val === undefined || val === null) val = 0;

        const uniqueVals = [...new Set(zebricek.map(p => p[metricKey] || 0))].sort((a, b) => b - a);
        const rank = uniqueVals.indexOf(val) + 1;
        const displayRank = rank > 0 ? `${rank}. místo` : '–';

        return `
            <div class="rekord-row is-my-rank">
                <div class="rekord-badge is-rank">${displayRank}</div>
                <div class="rekord-names-text">
                    <span class="rekord-name is-me">${window.escapeHTML(myNick)} (${val}${suffix}${customExtra})</span>
                </div>
            </div>`;
    };

    // 🎨 TITULKY PODLE REŽIMU
    const preciseLabel = isLiveTab ? '🎯 LIVE NEJVÍC TREFENÝCH PŘESNÝCH VÝSLEDKŮ' : '🎯 NEJVÍC TREFENÝCH PŘESNÝCH VÝSLEDKŮ';
    const topMatchLabel = isLiveTab ? '🔥 LIVE NEJVÍC TREFENÝCH PŘESNÝCH TOP ZÁPASŮ' : '🔥 NEJVÍC TREFENÝCH PŘESNÝCH TOP ZÁPASŮ';
    const tendenceLabel = isLiveTab ? '⚽ LIVE NEJVÍC TREFENÝCH SPRÁVNÝCH TENDENCÍ' : '⚽ NEJVÍC TREFENÝCH SPRÁVNÝCH TENDENCÍ';
    const hraciKolaLabel = isLiveTab ? '👑 LIVE NEJVÍCE TITULŮ HRÁČ KOLA' : '👑 NEJVÍCE TITULŮ HRÁČ KOLA';
    const roundLabel = isLiveTab ? '⚡ LIVE NEJLEPŠÍ BODOVÝ ZISK V KOLE' : '⚡ NEJLEPŠÍ BODOVÝ ZISK V KOLE';

    // 1. PŘESNÉ VÝSLEDKY
    const zdrojPresne = isLiveTab ? (centralDoc.top3PresneLive || []) : (centralDoc.top3Presne || []);
    let presneBlockHtml = '';
    if (zdrojPresne.length > 0) {
        const rows = zdrojPresne.map((item, i) => {
            const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : '🥉');
            const tierClass = i === 0 ? 'is-gold-tier' : (i === 1 ? 'is-silver-tier' : 'is-bronze-tier');
            return `
                <div class="rekord-row ${tierClass}">
                    <div class="rekord-badge">${medal} ${item.count}×</div>
                    <div class="rekord-names-text">${formatNamesBroadcast(item.names)}</div>
                </div>`;
        }).join('');
        const myAnchor = getMyAnchorRow(zdrojPresne, 'presneVysledkyCount', '×');
        presneBlockHtml = `
            <div class="rekord-card">
                <div class="rekord-card-header">${preciseLabel}</div>
                <div class="rekord-card-body">${rows}${myAnchor}</div>
            </div>`;
    }

    // 2. TOP ZÁPASY
    const zdrojTopMatches = isLiveTab 
        ? (centralDoc.top3PresneTopLive || centralDoc.top3PresneTopMatchLive || centralDoc.top3PresneTop || []) 
        : (centralDoc.top3PresneTop || centralDoc.top3PresneTopMatch || []);
    let topMatchesBlockHtml = '';
    if (zdrojTopMatches.length > 0) {
        const rows = zdrojTopMatches.map((item, i) => {
            const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : '🥉');
            const tierClass = i === 0 ? 'is-gold-tier' : (i === 1 ? 'is-silver-tier' : 'is-bronze-tier');
            return `
                <div class="rekord-row ${tierClass}">
                    <div class="rekord-badge">${medal} ${item.count}×</div>
                    <div class="rekord-names-text">${formatNamesBroadcast(item.names)}</div>
                </div>`;
        }).join('');
        const myAnchor = getMyAnchorRow(zdrojTopMatches, 'presneTopMatchesCount', '×');
        topMatchesBlockHtml = `
            <div class="rekord-card">
                <div class="rekord-card-header">${topMatchLabel}</div>
                <div class="rekord-card-body">${rows}${myAnchor}</div>
            </div>`;
    }

    // 3. TENDENCE
    const zdrojTendence = isLiveTab ? (centralDoc.top3SpravneTendenceLive || []) : (centralDoc.top3SpravneTendence || []);
    let tendenceBlockHtml = '';
    if (zdrojTendence.length > 0) {
        const rows = zdrojTendence.map((item, i) => {
            const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : '🥉');
            const tierClass = i === 0 ? 'is-gold-tier' : (i === 1 ? 'is-silver-tier' : 'is-bronze-tier');
            return `
                <div class="rekord-row ${tierClass}">
                    <div class="rekord-badge">${medal} ${item.count}×</div>
                    <div class="rekord-names-text">${formatNamesBroadcast(item.names)}</div>
                </div>`;
        }).join('');
        const myAnchor = getMyAnchorRow(zdrojTendence, 'spravneTendenceCount', '×');
        tendenceBlockHtml = `
            <div class="rekord-card">
                <div class="rekord-card-header">${tendenceLabel}</div>
                <div class="rekord-card-body">${rows}${myAnchor}</div>
            </div>`;
    }

    // 4. HRÁČ KOLA
    const zdrojHraciKola = isLiveTab ? (centralDoc.top3HraciKolaLive || []) : (centralDoc.top3HraciKola || []);
    let hraciKolaBlockHtml = '';
    if (zdrojHraciKola.length > 0) {
        const rows = zdrojHraciKola.map((item, i) => {
            const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : '🥉');
            const tierClass = i === 0 ? 'is-gold-tier' : (i === 1 ? 'is-silver-tier' : 'is-bronze-tier');
            return `
                <div class="rekord-row ${tierClass}">
                    <div class="rekord-badge">${medal} ${item.count}×</div>
                    <div class="rekord-names-text">${formatNamesBroadcast(item.names || item.text)}</div>
                </div>`;
        }).join('');
        const myAnchor = getMyAnchorRow(zdrojHraciKola, 'vyhranaKolaCount', '×');
        hraciKolaBlockHtml = `
            <div class="rekord-card">
                <div class="rekord-card-header">${hraciKolaLabel}</div>
                <div class="rekord-card-body">${rows}${myAnchor}</div>
            </div>`;
    }

    // 5. MAX BODY V KOLE
    const zdrojKola = isLiveTab ? (centralDoc.top3KolaLive || []) : (centralDoc.top3Kola || []);
    let kolaBlockHtml = '';
    if (zdrojKola.length > 0) {
        const rows = zdrojKola.map((item, i) => {
            const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : '🥉');
            const tierClass = i === 0 ? 'is-gold-tier' : (i === 1 ? 'is-silver-tier' : 'is-bronze-tier');
            return `
                <div class="rekord-row ${tierClass}">
                    <div class="rekord-badge">${medal} ${item.points} b.</div>
                    <div class="rekord-names-text">${formatNamesBroadcast(item.text || item.names)}</div>
                </div>`;
        }).join('');
        const koloNazevExtra = (meObj?.nejviceBoduVKoleNazev && meObj.nejviceBoduVKoleNazev !== '–') ? `, ${meObj.nejviceBoduVKoleNazev}` : '';
        const myAnchor = getMyAnchorRow(zdrojKola, 'nejviceBoduVKole', ' b.', null, koloNazevExtra);
        kolaBlockHtml = `
            <div class="rekord-card">
                <div class="rekord-card-header">${roundLabel}</div>
                <div class="rekord-card-body">${rows}${myAnchor}</div>
            </div>`;
    }

    // 6. PERFEKTNÍ KOLO (SÍŇ SLÁVY)
    const zdrojPerfektni = centralDoc.perfektniKola || [];
    let perfektniKoloBlockHtml = '';
    if (zdrojPerfektni && zdrojPerfektni.length > 0) {
        const rows = zdrojPerfektni.map(item => {
            const isMe = Boolean(myNickClean && (item.nickname.toLowerCase() === myNickClean || item.nickname.toLowerCase().startsWith(myNickClean + ' ')));
            return `
                <div class="rekord-row is-gold-tier">
                    <div class="rekord-badge">👑 100%</div>
                    <div class="rekord-names-text">
                        <span class="rekord-name ${isMe ? 'is-me' : ''}">${window.escapeHTML(item.nickname)} (${window.escapeHTML(item.round)})</span>
                    </div>
                </div>`;
        }).join('');
        perfektniKoloBlockHtml = `
            <div class="rekord-card">
                <div class="rekord-card-header">🏆 PERFEKTNÍ TIPNUTÉ CELÉ KOLO</div>
                <div class="rekord-card-body">${rows}</div>
            </div>`;
    }

    // 7. BODY V ROZEHRANÝCH KOLECH
    let aktualniKoloBlockHtml = '';
    const otevrenaStatistiky = centralDoc.otevrenaKolaStatistiky || [];
    if (otevrenaStatistiky.length > 0) {
        aktualniKoloBlockHtml = otevrenaStatistiky.map(kStat => {
            if (!kStat.top3 || kStat.top3.length === 0) return '';
            const rows = kStat.top3.map((item, i) => {
                const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : '🥉');
                const tierClass = i === 0 ? 'is-gold-tier' : (i === 1 ? 'is-silver-tier' : 'is-bronze-tier');
                return `
                    <div class="rekord-row ${tierClass}">
                        <div class="rekord-badge">${medal} ${item.points} b.</div>
                        <div class="rekord-names-text">${formatNamesBroadcast(item.names)}</div>
                    </div>`;
            }).join('');
            const cisloKola = String(kStat.round || '–').replace(/[^0-9]/g, '');
            const myAnchor = getMyAnchorRow(kStat.top3, 'bodyKoloAktualni', ' b.');
            const cardHeader = isLiveTab ? `🔴 LIVE BODY V ROZEHRANÉM KOLE – ${cisloKola}. KOLO` : `📈 BODY V ROZEHRANÉM KOLE – ${cisloKola}. KOLO`;
            return `
                <div class="rekord-card ${isLiveTab ? 'is-live' : ''}">
                    <div class="rekord-card-header">${cardHeader}</div>
                    <div class="rekord-card-body">${rows}${myAnchor}</div>
                </div>`;
        }).join('');
    }

    contentArea.innerHTML = `
        <div style="text-align: right; color: #9ca3af; font-size: 0.72rem; font-family: monospace; margin-bottom: 10px; padding-right: 4px; text-transform: uppercase; letter-spacing: 0.5px; width: 100%; box-sizing: border-box;">
            Aktualizováno: ${dText}
        </div>
        <div style="display: flex; flex-direction: column; gap: 14px; width: 100%; box-sizing: border-box; padding-bottom: 20px;">
            ${presneBlockHtml}
            ${topMatchesBlockHtml}
            ${tendenceBlockHtml}
            ${hraciKolaBlockHtml}
            ${kolaBlockHtml}
            ${perfektniKoloBlockHtml}
            ${aktualniKoloBlockHtml}
        </div>
    `;
};

// 📑 MODAL PRO PŘEHLED VŠECH ROZEHRANÝCH KOL HRÁČE
window.showPlayerOpenRoundsModal = (playerUid) => {
    const store = Alpine.store('appState');
    const leaderboardData = store?.leaderboardData;
    const zebricek = leaderboardData?.zebricek || leaderboardData?.zebricekLive || [];
    const player = zebricek.find(p => p.uid === playerUid);
    if (!player) return;

    const otevrenaKola = player.otevrenaKola || [];
    if (otevrenaKola.length === 0) {
        alert("Hráč nemá žádná aktivně rozehraná kola.");
        return;
    }

    let totalOpenPoints = 0;
    const rowsHtml = otevrenaKola.map(ok => {
        totalOpenPoints += (ok.points || 0);
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; background: #1f2937; border: 1px solid #374151; border-radius: 8px; font-family: 'Oswald', sans-serif;">
                <span style="color: #ffffff; font-size: 1rem; letter-spacing: 0.5px;">⚽ ${ok.round}</span>
                <span style="color: ${ok.points < 0 ? '#f87171' : (ok.points > 0 ? '#34d399' : '#9ca3af')}; font-size: 1.1rem; font-weight: bold;">
                    ${ok.points >= 0 ? '+' : ''}${ok.points} b.
                </span>
            </div>
        `;
    }).join('');

    const modalHtml = `
        <div style="padding: 12px; display: flex; flex-direction: column; gap: 8px; background: #0b0f19;">
            <div style="color: #9ca3af; font-size: 0.82rem; margin-bottom: 6px; text-align: left; line-height: 1.4;">
                Přehled bodů hráče <strong style="color: #fff;">${player.nickname}</strong> v kolech, která čekají na dohrávku:
            </div>
            ${rowsHtml}
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; background: rgba(16, 185, 129, 0.08); border: 1px solid #10b981; border-radius: 8px; margin-top: 4px; font-family: 'Oswald', sans-serif;">
                <span style="color: #10b981; font-weight: bold; font-size: 0.95rem;">CELKEM V ROZEHRANÝCH KOLECH:</span>
                <span style="color: #34d399; font-size: 1.2rem; font-weight: bold;">${totalOpenPoints >= 0 ? '+' : ''}${totalOpenPoints} b.</span>
            </div>
        </div>
    `;

    window.openGlobalUiModal(`Rozehraná kola: ${player.nickname}`, modalHtml);
};

// 🎛️ STRÁNKOVACÍ STAV A OVLÁDÁNÍ RADAR KARET
window.radarPageStates = window.radarPageStates || {};

window.changeRadarPage = (type, direction) => {
    const state = window.radarPageStates[type] || { current: 0, total: 1 };
    let newPage = state.current + direction;
    if (newPage < 0 || newPage >= state.total) return;
    state.current = newPage;
    window.radarPageStates[type] = state;

    const pages = document.querySelectorAll(`.radar-page-${type}`);
    pages.forEach((p, idx) => {
        p.style.display = (idx === newPage) ? 'flex' : 'none';
    });

    const indicator = document.getElementById(`radar-page-indicator-${type}`);
    if (indicator) {
        indicator.innerText = `${newPage + 1} / ${state.total}`;
    }

    const btnPrev = document.getElementById(`radar-page-prev-${type}`);
    const btnNext = document.getElementById(`radar-page-next-${type}`);
    if (btnPrev) btnPrev.style.opacity = (newPage === 0) ? '0.3' : '1';
    if (btnNext) btnNext.style.opacity = (newPage === state.total - 1) ? '0.3' : '1';
};

window.toggleRadarExpand = (btn) => {
    const wrapper = btn.closest('.radar-collapse-wrapper');
    if (!wrapper) return;
    const cardBody = wrapper.closest('.radar-card-body');
    const topPreview = cardBody ? cardBody.querySelector('.radar-top-preview') : null;
    const hiddenItems = wrapper.querySelector('.radar-hidden-items');
    if (!hiddenItems) return;
    const isHidden = hiddenItems.style.display === 'none';

    const count = btn.dataset.count;
    const label = btn.dataset.label;
    const isPaginated = btn.dataset.paginated === 'true';

    if (isHidden) {
        hiddenItems.style.display = 'flex';
        if (topPreview && isPaginated) {
            topPreview.style.display = 'none';
        }
        btn.innerHTML = `▴ Skrýt (${count})`;
    } else {
        hiddenItems.style.display = 'none';
        if (topPreview && isPaginated) {
            topPreview.style.display = 'flex';
        }
        btn.innerHTML = `▾ Zobrazit další ${label} (${count})`;
    }
};

// =========================================================================
// 💡 DEDIKOVANÁ STRÁNKA: LIGOVÝ RADAR (EXTRÉMY, TRENDY, TÝMY)
// =========================================================================
window.vykresliRadar = (centralDoc, contentArea, tab, leagueName) => {
    if (!centralDoc) {
        contentArea.innerHTML = `<div class="db-empty-msg" style="color:#fbbf24;">Radar se na pozadí připravuje... ⚙️</div>`;
        return;
    }

    if (window.myRankObserver) {
        window.myRankObserver.disconnect();
        window.myRankObserver = null;
    }
    const myFab = document.getElementById('myRankFab');
    if (myFab) myFab.style.display = 'none';

    const radar = centralDoc.radar || null;

    if (!radar || (!radar.zlatyDul && (!radar.totalniVybuchy || radar.totalniVybuchy.length === 0) && (!radar.stedrostKlubu || radar.stedrostKlubu.length === 0))) {
        contentArea.innerHTML = `
            <div class="db-empty-msg" style="padding: 40px 15px; text-align: center; color: #9ca3af; line-height: 1.5;">
                👀 <strong>Zajímavosti ožijí po odehrání prvních zápasů!</strong><br>
                Jakmile padnou první výsledky, objeví se zde Totální výbuchy, Vlci samotáři i žebříček klubů. 🏟️
            </div>
        `;
        return;
    }

    // ⏱️ TIMESTAMP
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

            if (d >= dnesPolnoc) dText = `dnes v ${cas}`;
            else if (d >= vceraPolnoc) dText = `včera v ${cas}`;
            else {
                const den = String(d.getDate()).padStart(2, '0');
                const mesic = String(d.getMonth() + 1).padStart(2, '0');
                const rok = d.getFullYear();
                dText = `${den}.${mesic}.${rok} v ${cas}`;
            }
        }
    }

    // 1. 💰 ZLATÝ DŮL
    let zlatyDulHtml = '';
    if (radar.zlatyDul) {
        zlatyDulHtml = `
            <div class="radar-card radar-card-gold">
                <div class="radar-card-header text-gold">💰 ZLATÝ DŮL (BODOVÝ FESTIVAL)</div>
                <div class="radar-card-body">
                    <div class="radar-highlight-match">🏆 ${window.escapeHTML(radar.zlatyDul.zapas)}</div>
                    <div class="radar-subtext">
                        <span>↳ <strong>${window.escapeHTML(radar.zlatyDul.kolo)}</strong></span> • 
                        <span><strong>${radar.zlatyDul.presnych}×</strong> přesný zásah</span> • 
                        <span class="text-gold"><strong>+${radar.zlatyDul.rozdanoBodu} b.</strong> celkem do ligy</span>
                    </div>
                </div>
            </div>
        `;
    }

    // 2. 💀 TOTÁLNÍ VÝBUCH (NEJNOVĚJŠÍ NAHOŘE + STRÁNKOVÁNÍ 11+)
    const vybuchyRaw = radar.totalniVybuchy || [];
    const vybuchy = [...vybuchyRaw].reverse();
    let vybuchyHtml = '';
    if (vybuchy.length === 0) {
        vybuchyHtml = `
            <div class="radar-card">
                <div class="radar-card-header" style="color: #34d399;">💀 TOTÁLNÍ VÝBUCH (0 BODŮ PRO CELOU LIGU)</div>
                <div class="radar-card-body">
                    <div class="radar-empty-note">🛡️ Čistý štít – V každém zápase sezóny někdo z ligy bodoval!</div>
                </div>
            </div>
        `;
    } else {
        const renderVybuch = (v) => `
            <div class="radar-list-item">
                <span class="radar-item-icon">❌</span>
                <div class="radar-item-info">
                    <span class="radar-item-match">${window.escapeHTML(v.zapas)}</span>
                    <span class="radar-item-meta">${window.escapeHTML(v.kolo)} • 0 bodů pro všechny tipéry</span>
                </div>
            </div>
        `;

        if (vybuchy.length <= 2) {
            vybuchyHtml = `
                <div class="radar-card radar-card-danger">
                    <div class="radar-card-header text-danger">💀 TOTÁLNÍ VÝBUCH (${vybuchy.length}× V SEZÓNĚ)</div>
                    <div class="radar-card-body">
                        ${vybuchy.map(renderVybuch).join('')}
                    </div>
                </div>
            `;
        } else if (vybuchy.length <= 10) {
            const top2Html = vybuchy.slice(0, 2).map(renderVybuch).join('');
            const restHtml = vybuchy.slice(2).map(renderVybuch).join('');
            vybuchyHtml = `
                <div class="radar-card radar-card-danger">
                    <div class="radar-card-header text-danger">💀 TOTÁLNÍ VÝBUCH (${vybuchy.length}× V SEZÓNĚ)</div>
                    <div class="radar-card-body">
                        <div class="radar-top-preview" style="display: flex; flex-direction: column; gap: 6px;">
                            ${top2Html}
                        </div>
                        <div class="radar-collapse-wrapper">
                            <div class="radar-hidden-items" style="display: none; flex-direction: column; gap: 6px;">
                                ${restHtml}
                            </div>
                            <button class="radar-expand-btn" data-count="${vybuchy.length - 2}" data-label="výbuchy" data-paginated="false" onclick="window.toggleRadarExpand(this)">
                                ▾ Zobrazit další výbuchy (${vybuchy.length - 2})
                            </button>
                        </div>
                    </div>
                </div>
            `;
        } else {
            const totalPages = Math.ceil(vybuchy.length / 10);
            window.radarPageStates['vybuchy'] = { current: 0, total: totalPages };
            const top2Html = vybuchy.slice(0, 2).map(renderVybuch).join('');
            
            let pagesHtml = '';
            for (let p = 0; p < totalPages; p++) {
                const pageItems = vybuchy.slice(p * 10, (p + 1) * 10);
                pagesHtml += `
                    <div class="radar-page-vybuchy" style="display: ${p === 0 ? 'flex' : 'none'}; flex-direction: column; gap: 6px;">
                        ${pageItems.map(renderVybuch).join('')}
                    </div>
                `;
            }

            vybuchyHtml = `
                <div class="radar-card radar-card-danger">
                    <div class="radar-card-header text-danger">💀 TOTÁLNÍ VÝBUCH (${vybuchy.length}× V SEZÓNĚ)</div>
                    <div class="radar-card-body">
                        <div class="radar-top-preview" style="display: flex; flex-direction: column; gap: 6px;">
                            ${top2Html}
                        </div>
                        <div class="radar-collapse-wrapper">
                            <div class="radar-hidden-items" style="display: none; flex-direction: column; gap: 6px;">
                                <div class="radar-pages-wrapper">
                                    ${pagesHtml}
                                </div>
                                <div class="radar-pagination-bar" style="display: flex; justify-content: center; align-items: center; gap: 14px; padding: 4px 0; border-top: 1px dashed #374151; margin-top: 4px;">
                                    <button id="radar-page-prev-vybuchy" class="carousel-btn" style="height: 28px; width: 34px; padding: 0; font-size: 0.75rem; opacity: 0.3;" onclick="window.changeRadarPage('vybuchy', -1)">◀</button>
                                    <span id="radar-page-indicator-vybuchy" style="font-family: 'Oswald', sans-serif; font-size: 0.82rem; color: #f87171; font-weight: bold; letter-spacing: 0.5px;">1 / ${totalPages}</span>
                                    <button id="radar-page-next-vybuchy" class="carousel-btn" style="height: 28px; width: 34px; padding: 0; font-size: 0.75rem; opacity: ${totalPages > 1 ? '1' : '0.3'};" onclick="window.changeRadarPage('vybuchy', 1)">▶</button>
                                </div>
                            </div>
                            <button class="radar-expand-btn" data-count="${vybuchy.length - 2}" data-label="výbuchy" data-paginated="true" onclick="window.toggleRadarExpand(this)">
                                ▾ Zobrazit další výbuchy (${vybuchy.length - 2})
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    // 3. 🐺 VLCI SAMOTÁŘI (NEJNOVĚJŠÍ NAHOŘE + STRÁNKOVÁNÍ 11+)
    const vlciRaw = radar.vlciSamotari || [];
    const vlci = [...vlciRaw].reverse();
    let vlciHtml = '';
    if (vlci.length === 0) {
        vlciHtml = `
            <div class="radar-card">
                <div class="radar-card-header" style="color: #38bdf8;">🐺 VLCI SAMOTÁŘI (SÓLO TREFA PRO 1 HRÁČE)</div>
                <div class="radar-card-body">
                    <div class="radar-empty-note">🤝 Kolektivní liga – V žádném zápase nezůstal bodující hráč osamocen.</div>
                </div>
            </div>
        `;
    } else {
        const renderVlk = (v) => `
            <div class="radar-list-item">
                <span class="radar-item-icon">🎯</span>
                <div class="radar-item-info">
                    <span class="radar-item-match">${window.escapeHTML(v.zapas)}</span>
                    <span class="radar-item-meta">${window.escapeHTML(v.kolo)} • Trefil jediný <strong style="color: #34d399;">@${window.escapeHTML(v.hrac)}</strong> (+${v.body} b.)</span>
                </div>
            </div>
        `;

        if (vlci.length <= 2) {
            vlciHtml = `
                <div class="radar-card radar-card-cyan">
                    <div class="radar-card-header text-cyan">🐺 VLCI SAMOTÁŘI (${vlci.length}× SÓLO TREFA)</div>
                    <div class="radar-card-body">
                        ${vlci.map(renderVlk).join('')}
                    </div>
                </div>
            `;
        } else if (vlci.length <= 10) {
            const top2Html = vlci.slice(0, 2).map(renderVlk).join('');
            const restHtml = vlci.slice(2).map(renderVlk).join('');
            vlciHtml = `
                <div class="radar-card radar-card-cyan">
                    <div class="radar-card-header text-cyan">🐺 VLCI SAMOTÁŘI (${vlci.length}× SÓLO TREFA)</div>
                    <div class="radar-card-body">
                        <div class="radar-top-preview" style="display: flex; flex-direction: column; gap: 6px;">
                            ${top2Html}
                        </div>
                        <div class="radar-collapse-wrapper">
                            <div class="radar-hidden-items" style="display: none; flex-direction: column; gap: 6px;">
                                ${restHtml}
                            </div>
                            <button class="radar-expand-btn" data-count="${vlci.length - 2}" data-label="sólo trefy" data-paginated="false" onclick="window.toggleRadarExpand(this)">
                                ▾ Zobrazit další sólo trefy (${vlci.length - 2})
                            </button>
                        </div>
                    </div>
                </div>
            `;
        } else {
            const totalPages = Math.ceil(vlci.length / 10);
            window.radarPageStates['vlci'] = { current: 0, total: totalPages };
            const top2Html = vlci.slice(0, 2).map(renderVlk).join('');
            
            let pagesHtml = '';
            for (let p = 0; p < totalPages; p++) {
                const pageItems = vlci.slice(p * 10, (p + 1) * 10);
                pagesHtml += `
                    <div class="radar-page-vlci" style="display: ${p === 0 ? 'flex' : 'none'}; flex-direction: column; gap: 6px;">
                        ${pageItems.map(renderVlk).join('')}
                    </div>
                `;
            }

            vlciHtml = `
                <div class="radar-card radar-card-cyan">
                    <div class="radar-card-header text-cyan">🐺 VLCI SAMOTÁŘI (${vlci.length}× SÓLO TREFA)</div>
                    <div class="radar-card-body">
                        <div class="radar-top-preview" style="display: flex; flex-direction: column; gap: 6px;">
                            ${top2Html}
                        </div>
                        <div class="radar-collapse-wrapper">
                            <div class="radar-hidden-items" style="display: none; flex-direction: column; gap: 6px;">
                                <div class="radar-pages-wrapper">
                                    ${pagesHtml}
                                </div>
                                <div class="radar-pagination-bar" style="display: flex; justify-content: center; align-items: center; gap: 14px; padding: 4px 0; border-top: 1px dashed #374151; margin-top: 4px;">
                                    <button id="radar-page-prev-vlci" class="carousel-btn" style="height: 28px; width: 34px; padding: 0; font-size: 0.75rem; opacity: 0.3;" onclick="window.changeRadarPage('vlci', -1)">◀</button>
                                    <span id="radar-page-indicator-vlci" style="font-family: 'Oswald', sans-serif; font-size: 0.82rem; color: #38bdf8; font-weight: bold; letter-spacing: 0.5px;">1 / ${totalPages}</span>
                                    <button id="radar-page-next-vlci" class="carousel-btn" style="height: 28px; width: 34px; padding: 0; font-size: 0.75rem; opacity: ${totalPages > 1 ? '1' : '0.3'};" onclick="window.changeRadarPage('vlci', 1)">▶</button>
                                </div>
                            </div>
                            <button class="radar-expand-btn" data-count="${vlci.length - 2}" data-label="sólo trefy" data-paginated="true" onclick="window.toggleRadarExpand(this)">
                                ▾ Zobrazit další sólo trefy (${vlci.length - 2})
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    // 4. 🎭 HRDINOVÉ & SMOLAŘI
    let smolarHtml = '';
    if (radar.smolarSezony && radar.smolarSezony.pocet > 0) {
        smolarHtml = `
            <div class="radar-card">
                <div class="radar-card-header" style="color: #fbbf24;">🎭 HRDINOVÉ & SMOLAŘI SEZÓNY</div>
                <div class="radar-card-body">
                    <div class="radar-hero-row">
                        <span class="radar-hero-icon">🩹</span>
                        <div class="radar-hero-info">
                            <span class="radar-hero-title">SMOLAŘ SEZÓNY</span>
                            <span class="radar-hero-sub">Nejčastěji minul přesný výsledek o jediný gól</span>
                        </div>
                        <div class="radar-hero-badge">
                            <span class="radar-hero-name">@${window.escapeHTML(radar.smolarSezony.nick)}</span>
                            <span class="radar-hero-val">${radar.smolarSezony.pocet}× těsně</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // 5. 🔮 NEJČASTĚJŠÍ TIPY VS. REALITA
    const praniRealitaHtml = `
        <div class="radar-card">
            <div class="radar-card-header" style="color: #c084fc;">🔮 NEJČASTĚJŠÍ TIPY VS. REALITA</div>
            <div class="radar-card-body" style="gap: 10px;">
                <div class="radar-comparison-grid">
                    <div class="radar-comparison-col">
                        <span class="radar-comparison-label text-cyan">🎯 NEJČASTĚJŠÍ TIP</span>
                        <div class="radar-comparison-val">${radar.nejcastejsiTip || '–'}</div>
                        <span class="radar-comparison-sub">${radar.nejcastejsiTipPct || 0} % všech tipů</span>
                    </div>
                    <div class="radar-comparison-divider"></div>
                    <div class="radar-comparison-col">
                        <span class="radar-comparison-label text-gold">⚽ NEJČASTĚJŠÍ VÝSLEDEK</span>
                        <div class="radar-comparison-val">${radar.nejcastejsiVysledek || '–'}</div>
                        <span class="radar-comparison-sub">${radar.nejcastejsiVysledekPct || 0} % zápasů</span>
                    </div>
                </div>
                <div class="radar-stats-pills">
                    <div class="radar-stat-pill">
                        <span class="pill-label">Úspěšnost na vítěze:</span>
                        <span class="pill-val text-green">${radar.uspesnostTendencePct || 0} %</span>
                    </div>
                    <div class="radar-stat-pill">
                        <span class="pill-label">Úspěšnost na přesný stav:</span>
                        <span class="pill-val text-gold">${radar.uspesnostPresnePct || 0} %</span>
                    </div>
                </div>
            </div>
        </div>
    `;

    // 6. 🏟️ ŠTĚDROST KLUBŮ (AUTOMATICKÝ BANKOMAT & HROBAŘ)
    const kluby = radar.stedrostKlubu || [];
    let klubyHtml = '';
    if (kluby.length > 0) {
        const rows = kluby.map((k, idx) => {
            let badge = '';
            if (idx < 2) {
                badge = '<span class="radar-club-badge badge-bankomat">💰 BANKOMAT</span>';
            } else if (idx >= kluby.length - 2) {
                badge = '<span class="radar-club-badge badge-hrobar">💀 HROBAŘ</span>';
            }

            const prumerColor = k.prumerBodu >= 2.5 ? '#34d399' : (k.prumerBodu >= 1.5 ? '#fbbf24' : '#f87171');

            return `
                <div class="radar-club-row">
                    <div class="radar-club-left">
                        <span class="radar-club-rank">${idx + 1}.</span>
                        <span class="radar-club-name">${window.escapeHTML(k.tym)}</span>
                        ${badge}
                    </div>
                    <div class="radar-club-right">
                        <span class="radar-club-pts" style="color: ${prumerColor};">${k.prumerBodu} b. <small style="color:#9ca3af; font-size:0.68rem;">/ záp.</small></span>
                        <span class="radar-club-pct">${k.uspesnost} % tref</span>
                    </div>
                </div>
            `;
        }).join('');

        klubyHtml = `
            <div class="radar-card">
                <div class="radar-card-header" style="color: #34d399;">🏟️ ŠTĚDROST KLUBŮ (KDO SYPAL A KDO PÁLIL BODY)</div>
                <div class="radar-card-body" style="padding: 4px 0;">
                    <div class="radar-club-table-header">
                        <span># KLUB</span>
                        <div style="display: flex; gap: 20px; padding-right: 12px;">
                            <span>PRŮMĚR</span>
                            <span>ÚSPĚŠNOST</span>
                        </div>
                    </div>
                    <div class="radar-club-list">
                        ${rows}
                    </div>
                </div>
            </div>
        `;
    }

    contentArea.innerHTML = `
        <div style="text-align: right; color: #9ca3af; font-size: 0.72rem; font-family: monospace; margin-bottom: 10px; padding-right: 4px; text-transform: uppercase; letter-spacing: 0.5px; width: 100%; box-sizing: border-box;">
            Aktualizováno: ${dText}
        </div>
        <div style="display: flex; flex-direction: column; gap: 14px; width: 100%; box-sizing: border-box; padding-bottom: 20px;">
            ${zlatyDulHtml}
            ${vybuchyHtml}
            ${vlciHtml}
            ${smolarHtml}
            ${praniRealitaHtml}
            ${klubyHtml}
        </div>
    `;
};

// 👁️ BEZPEČNÝ SPY MODAL PRO HISTORII TIPŮ (FAST-PATH PRO VLASTNÍ PROFIL & ZERO-STALE ARCHITEKTURA)
window.showPlayerTipsModal = async (playerUid, leagueName) => {
    const store = Alpine.store('appState');
    const rozpisData = store?.rozpisData;
    const myUid = window.auth?.currentUser?.uid;
    const isMe = Boolean(myUid && playerUid === myUid);

    if (!rozpisData || !rozpisData.zapasyMapa) return;

    // 🛡️ IN-MEMORY RESOLVER PŘEZDÍVKY: Vytáhneme si bezpečný čistý nick přímo z mezipaměti storu
    const hracSlozka = store.leaderboardData?.zebricek?.find(p => p.uid === playerUid) || store.leaderboardData?.zebricekLive?.find(p => p.uid === playerUid);
    const nickname = hracSlozka ? hracSlozka.nickname : (isMe ? (store.nickname || 'Já') : 'Hráč');

    let hracovyTipyData;

    // ⚡ 1. FAST-PATH PRO PŘIHLÁŠENÉHO UŽIVATELE (0 ms z lokální RAM paměti storu)
    if (isMe) {
        hracovyTipyData = { mapaTipu: store.mojeTipy || {} };
    } else {
        window.showToast("⏳ Stahuji historii tipů...", false);
        try {
            const r2Base = CONFIG.R2_BASE_URL;
            const sezonaId = store?.activeSeason || window.SEZONA_ID || CONFIG.DEFAULT_SEASON;
            const ligaKlic = String(leagueName || store?.selectedLeague || '').replace(/ /g, "_");
            const resHistory = await fetch(`${r2Base}/sezony/${sezonaId}/${ligaKlic}/historie_hrace_${playerUid}.json?v=${Date.now()}`);
            if (!resHistory.ok) {
                alert("Hráč zatím nemá žádné uzavřené tipy k zobrazení.");
                return;
            }
            hracovyTipyData = await resHistory.json();
        } catch (e) {
            console.error("Chyba při stahování historie tipů:", e);
            window.showToast("❌ Chyba při stahování historie tipů.", true);
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

    // 🏆 SKUPINOVÁNÍ ZÁPASŮ PODLE KOL + ČÍTAČ CELKOVÉHO ROZPISU KOLA
    const kolaMap = {};
    const roundTotalMatchesMap = {};

    serazeneZapasy.forEach(zap => {
        const koloNazev = window.prelozFaziTurnaje(zap.stage, zap.kolo, zap.isPlayoff) || '1. Kolo';
        roundTotalMatchesMap[koloNazev] = (roundTotalMatchesMap[koloNazev] || 0) + 1;

        const isEvaluated = (zap.vysledek_domaci !== undefined && zap.vysledek_hoste !== undefined && zap.apiStatus !== "IN_PLAY" && zap.apiStatus !== "PAUSED");
        const jeBeziciLive = (zap.apiStatus === "IN_PLAY" || zap.apiStatus === "PAUSED");

        // 🛡️ SECURITY: Do zobrazení pustíme pouze zápasy, které už reálně odstartovaly
        if (!isEvaluated && !jeBeziciLive) return;

        if (!kolaMap[koloNazev]) kolaMap[koloNazev] = [];
        kolaMap[koloNazev].push(zap);
    });

    const unikatniKola = Object.keys(kolaMap);
    if (unikatniKola.length === 0) {
        alert("Hráč zatím nemá žádné vyhodnocené tipy k zobrazení.");
        return;
    }

    // Uložíme reaktivní stav modálu (výchozí kolo = nejnovější / poslední odehrané)
    window.playerTipsModalState = {
        playerUid,
        leagueName,
        nickname,
        hracovyTipy,
        kolaMap,
        roundTotalMatchesMap,
        unikatniKola,
        currentRoundIndex: unikatniKola.length - 1
    };

    window.renderPlayerTipsModalContent();
};

// 🎨 CENTRÁLNÍ SÉMANTICKÝ SEMAFOR BODŮ PRO CELOU APLIKACI (Návod, Výsledky, Modaly)
window.urciBarvuATriduBodu = (tDom, tHos, rDom, rHos, league, tPostup, rPostup, isPlayoff, isTopMatch, hasTip) => {
    if (!hasTip || tDom === undefined || tDom === null || tDom === '' || tHos === undefined || tHos === null || tHos === '') {
        const pravidla = window.PRAVIDLA_LIG?.[league] || window.PRAVIDLA_LIG?.["DEFAULT"];
        const pts = pravidla?.penaltyNenatipovano !== undefined ? pravidla.penaltyNenatipovano : -1;
        return {
            pts: pts,
            ptsStr: `(${pts >= 0 ? '+' : ''}${pts} b.)`,
            ptsBadgeStr: `${pts >= 0 ? '+' : ''}${pts} b.`,
            color: '#f87171',
            badgeClass: 'badge-pts-negative',
            isExact: false,
            exactClass: '',
            bgStyle: ''
        };
    }

    const pts = window.vypocitejBodyZapasu(tDom, tHos, rDom, rHos, league, tPostup, rPostup, isPlayoff, isTopMatch);
    const dVal = parseInt(tDom);
    const hVal = parseInt(tHos);
    const rdVal = parseInt(rDom);
    const rhVal = parseInt(rHos);

    if (pts === 0) {
        return {
            pts: 0,
            ptsStr: '(0 b.)',
            ptsBadgeStr: '+0 b.',
            color: '#9ca3af',
            badgeClass: 'badge-pts-zero',
            isExact: false,
            exactClass: '',
            bgStyle: ''
        };
    }

    if (pts < 0) {
        return {
            pts: pts,
            ptsStr: `(${pts} b.)`,
            ptsBadgeStr: `${pts} b.`,
            color: '#f87171',
            badgeClass: 'badge-pts-negative',
            isExact: false,
            exactClass: '',
            bgStyle: ''
        };
    }

    // 🎯 1. PŘESNÝ VÝSLEDEK (ORANŽOVÁ PRO TOP ZÁPAS / ZLATÁ PRO BĚŽNÝ ZÁPAS)
    const isExact = (dVal === rdVal && hVal === rhVal && (!isPlayoff || rdVal !== rhVal || tPostup === rPostup));
    if (isExact) {
        if (isTopMatch) {
            return {
                pts: pts,
                ptsStr: `(+${pts} b.)`,
                ptsBadgeStr: `+${pts} b.`,
                color: '#f97316',
                badgeClass: 'badge-pts-top-exact',
                isExact: true,
                exactClass: 'exact-top-tip',
                bgStyle: ''
            };
        }
        return {
            pts: pts,
            ptsStr: `(+${pts} b.)`,
            ptsBadgeStr: `+${pts} b.`,
            color: '#fbbf24',
            badgeClass: 'badge-pts-exact',
            isExact: true,
            exactClass: 'exact-tip',
            bgStyle: ''
        };
    }

    // 2. SPECIFICKÁ PRAVIDLA PRO PREMIER LEAGUE A MS VE FOTBALE
    if (league === "Premier League" || league === "MS ve fotbale") {
        const mult = isTopMatch ? 2 : 1;
        // Chytrá tendence / nepřesná remíza (+3 b. základ / +6 b. u TOP)
        if (pts === 3 * mult) {
            return {
                pts: pts,
                ptsStr: `(+${pts} b.)`,
                ptsBadgeStr: `+${pts} b.`,
                color: '#38bdf8',
                badgeClass: 'badge-pts-cyan',
                isExact: false,
                exactClass: '',
                bgStyle: ''
            };
        }
        // Gól útěchy / postup (+1 b. základ / +2 b. u TOP)
        if (pts === 1 * mult) {
            return {
                pts: pts,
                ptsStr: `(+${pts} b.)`,
                ptsBadgeStr: `+${pts} b.`,
                color: '#a3e635',
                badgeClass: 'badge-pts-lime',
                isExact: false,
                exactClass: '',
                bgStyle: ''
            };
        }
    }

    // 3. ZÁKLADNÍ TENDENCE (SMARAGDOVÁ ZELENÁ)
    return {
        pts: pts,
        ptsStr: `(+${pts} b.)`,
        ptsBadgeStr: `+${pts} b.`,
        color: '#34d399',
        badgeClass: 'badge-pts-green',
        isExact: false,
        exactClass: '',
        bgStyle: ''
    };
};

// 🎛️ RENDERER OBSAHU MODÁLU HISTORIE HRÁČE BEZ LIGOVÉHO LAGU
window.renderPlayerTipsModalContent = () => {
    const state = window.playerTipsModalState;
    if (!state || !state.unikatniKola.length) return;

    const currentRoundName = state.unikatniKola[state.currentRoundIndex];
    const zapasyVKole = state.kolaMap[currentRoundName] || [];
    const totalScheduled = state.roundTotalMatchesMap?.[currentRoundName] || zapasyVKole.length;

    let roundTotalPts = 0;
    let evaluatedCount = 0;
    let liveCount = 0;

    let rowsHtml = '';
    zapasyVKole.forEach(zap => {
        const t = state.hracovyTipy[zap.matchId];
        const isEvaluated = (zap.vysledek_domaci !== undefined && zap.vysledek_hoste !== undefined && zap.apiStatus !== "IN_PLAY" && zap.apiStatus !== "PAUSED");
        const jeBeziciLive = (zap.apiStatus === "IN_PLAY" || zap.apiStatus === "PAUSED");

        if (isEvaluated) evaluatedCount++;
        else if (jeBeziciLive) liveCount++;

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
        let tipColor = '#9ca3af';
        let tipStr = '? : ?';

        if (t) {
            let tDomStr = t.tip_domaci;
            let tHosStr = t.tip_hoste;
            if (zap.isPlayoff && t.tip_domaci === t.tip_hoste && t.postup) {
                if (t.postup === 'domaci') tDomStr = '*' + tDomStr;
                else if (t.postup === 'hoste') tHosStr = tHosStr + '*';
            }
            tipStr = `${tDomStr} : ${tHosStr}`;
            tipColor = '#ffffff';

            if (isEvaluated || jeBeziciLive) {
                const badgeInfo = window.urciBarvuATriduBodu(t.tip_domaci, t.tip_hoste, prubDomaci, prubHoste, state.leagueName, t.postup, zap.postup, zap.isPlayoff, zap.isTopMatch, true);
                ptsStr = badgeInfo.ptsStr;
                ptsColor = badgeInfo.color;
                tipColor = badgeInfo.color;
                exactClass = badgeInfo.exactClass;
                roundTotalPts += badgeInfo.pts;
            }
        } else if (isEvaluated || jeBeziciLive) {
            const badgeInfo = window.urciBarvuATriduBodu('', '', prubDomaci, prubHoste, state.leagueName, '', zap.postup, zap.isPlayoff, zap.isTopMatch, false);
            ptsStr = badgeInfo.ptsStr;
            ptsColor = badgeInfo.color;
            tipColor = badgeInfo.color;
            roundTotalPts += badgeInfo.pts;
        }

        const topIconHtml = zap.isTopMatch ? '<span class="player-modal-top-icon" title="TOP zápas kola">🔥</span>' : '';

        rowsHtml += `
            <div class="player-tips-table-row ${exactClass}">
                <div style="color: #e5e7eb; font-size: ${window.vypocitejOptimalniPismo(zap.domaci, zap.hoste)};">${topIconHtml}${zap.domaci} - ${zap.hoste}</div>
                <div class="player-tips-cell-result" style="color: #ffffff;">${resStr}</div>
                <div class="player-tips-cell-tip" style="color: ${tipColor}; font-weight: bold;">${tipStr}</div>
                <div class="player-tips-cell-points" style="color: ${ptsColor}; font-weight: bold;">${ptsStr}</div>
            </div>
        `;
    });

    const totalMatches = Math.max(totalScheduled, zapasyVKole.length);
    const inActionCount = evaluatedCount + liveCount;
    const waitingCount = Math.max(0, totalMatches - inActionCount);

    let statusText = '';
    let statusClass = '';
    let prefixLabel = '';

    if (totalMatches > 0 && evaluatedCount === totalMatches) {
        statusText = `✓ DOKONČENO (${evaluatedCount}/${totalMatches})`;
        statusClass = 'is-finished';
        prefixLabel = 'ZISK:';
    } else if (liveCount > 0) {
        const waitingStr = waitingCount > 0 ? ` • ${waitingCount} čeká` : '';
        statusText = `🔴 LIVE (${inActionCount}/${totalMatches}${waitingStr})`;
        statusClass = 'is-live';
        prefixLabel = 'BODY:';
    } else {
        const waitingStr = waitingCount > 0 ? ` • ${waitingCount} čeká` : '';
        statusText = `⏳ ROZEHRÁNO (${evaluatedCount}/${totalMatches}${waitingStr})`;
        statusClass = 'is-pending';
        prefixLabel = 'BODY:';
    }

    const ptsFormatted = (roundTotalPts >= 0 ? '+' : '') + roundTotalPts + ' b.';
    const ptsValueClass = roundTotalPts < 0 ? 'is-negative' : '';

    const optionsHtml = state.unikatniKola.map((kolo, idx) => `
        <div class="custom-dropdown-item ${idx === state.currentRoundIndex ? 'is-active' : ''}" onclick="window.zmenKoloPlayerModal(${idx})">
            ${kolo}
        </div>
    `).join('');

    const fullModalHtml = `
        <div class="carousel-container player-modal-carousel">
            <button class="nav-btn-leaderboard carousel-btn" onclick="window.posunKoloPlayerModal(-1)">◀</button>
            <div class="custom-dropdown-wrapper">
                <div class="custom-dropdown-trigger" onclick="const m = this.nextElementSibling; const isVis = m.style.display === 'flex'; m.style.display = isVis ? 'none' : 'flex';">
                    <span>${currentRoundName}</span>
                    <span class="custom-dropdown-arrow">▼</span>
                </div>
                <div class="custom-dropdown-menu" style="display: none;">
                    ${optionsHtml}
                </div>
            </div>
            <button class="nav-btn-leaderboard carousel-btn" onclick="window.posunKoloPlayerModal(1)">▶</button>
        </div>

        <div class="player-tips-table-header">
            <span>ZÁPAS</span>
            <span>VÝSLEDEK</span>
            <span>TIP</span>
            <span>BODY</span>
        </div>

        <div class="spy-modal-body" style="flex:1; overflow-y:auto; padding:0; background:#0b0f19;">
            ${rowsHtml}
        </div>

        <div class="player-modal-sticky-footer">
            <div class="player-modal-footer-status ${statusClass}">
                <span>${statusText}</span>
            </div>
            <div class="player-modal-footer-pts">
                <span class="footer-pts-label">${prefixLabel}</span>
                <span class="footer-pts-value ${ptsValueClass}">${ptsFormatted}</span>
            </div>
        </div>
    `;

    window.openGlobalUiModal(`Tipy hráče: ${state.nickname}`, fullModalHtml);
};

// ◀ ▶ OVLÁDÁNÍ KARUSELU V MODÁLU HISTORIE HRÁČE (◀ = dřívější kola, ▶ = novější kola)
window.posunKoloPlayerModal = (delta) => {
    const state = window.playerTipsModalState;
    if (!state || !state.unikatniKola.length) return;
    let newIndex = state.currentRoundIndex + delta;
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= state.unikatniKola.length) newIndex = state.unikatniKola.length - 1;
    if (newIndex !== state.currentRoundIndex) {
        state.currentRoundIndex = newIndex;
        window.renderPlayerTipsModalContent();
    }
};

window.zmenKoloPlayerModal = (newIndex) => {
    const state = window.playerTipsModalState;
    if (!state || !state.unikatniKola.length) return;
    if (newIndex >= 0 && newIndex < state.unikatniKola.length && newIndex !== state.currentRoundIndex) {
        state.currentRoundIndex = newIndex;
        window.renderPlayerTipsModalContent();
    }
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
    // ⚡ OKAMŽITÝ MICRO-PATCH RAM: Přepíšeme skóre v Alpine paměti za 0 ms bez čekání na bota
        if (store.rozpisData && store.rozpisData.zapasyMapa && store.rozpisData.zapasyMapa[matchId]) {
            store.rozpisData.zapasyMapa[matchId].vysledek_domaci = dVal;
            store.rozpisData.zapasyMapa[matchId].vysledek_hoste = hVal;
            store.rozpisData.zapasyMapa[matchId].postup = postupVal;
            store.rozpisData.zapasyMapa[matchId].apiStatus = "FINISHED";
            store.obnovCacheTimeline();
        }

        // 🚀 BLESKOVÝ RECALC: Vynutíme přepočet na backendu
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
            <div class="scoring-card font-white card-border-gold">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🏆 CELKOVÝ VÍTĚZ</div>
                    <div class="scoring-card-desc">Uhodnutý celkový vítěz Premier League (před 1. kolem)</div>
                </div>
                <div class="match-points-badge badge-pts-gold">+10 b.</div>
            </div>
            <div class="scoring-card font-white card-border-gold">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🥇 KRÁL STŘELCŮ</div>
                    <div class="scoring-card-desc">Uhodnutý nejlepší střelec Premier League (před 1. kolem)</div>
                </div>
                <div class="match-points-badge badge-pts-gold">+10 b.</div>
            </div>
            <div class="scoring-card font-white card-border-orange">
                <div class="scoring-card-info">
                    <div class="scoring-card-title" style="color: #f97316;">🔥 TOP ZÁPAS KOLA</div>
                    <div class="scoring-card-desc">Body ze zápasu označeného jako TOP se 2x NÁSOBÍ!</div>
                </div>
                <div class="match-points-badge badge-pts-orange">2x BODY</div>
            </div>
            <div class="scoring-card font-white card-border-gold">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🎯 PŘESNÝ VÝSLEDEK</div>
                    <div class="scoring-card-desc">Trefíš přesné skóre zápasu</div>
                </div>
                <div class="match-points-badge badge-pts-gold">+6 b.</div>
            </div>
            <div class="scoring-card font-white card-border-cyan">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-cyan">🔥 CHYTRÁ TENDENCE</div>
                    <div class="scoring-card-desc">Vítěz + přesný gól jednoho z týmů NEBO přesný rozdíl gólů</div>
                </div>
                <div class="match-points-badge badge-pts-cyan">+3 b.</div>
            </div>
            <div class="scoring-card font-white card-border-cyan">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-cyan">🤝 NEPŘESNÁ REMÍZA</div>
                    <div class="scoring-card-desc">Tipneš remízu a zápas skončí jinou remízou</div>
                </div>
                <div class="match-points-badge badge-pts-cyan">+3 b.</div>
            </div>
            <div class="scoring-card font-white card-border-green">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-green">⚽ ZÁKLADNÍ TENDENCE</div>
                    <div class="scoring-card-desc">Trefíš pouze čistého vítěze zápasu</div>
                </div>
                <div class="match-points-badge badge-pts-green">+2 b.</div>
            </div>
            <div class="scoring-card font-white card-border-lime">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-lime">🥅 GÓL ÚTĚCHY</div>
                    <div class="scoring-card-desc">Netrefíš nic, ale uhodneš přesný počet gólů aspoň jednoho týmu</div>
                </div>
                <div class="match-points-badge badge-pts-lime">+1 b.</div>
            </div>
            <div class="scoring-card font-white card-border-muted">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-muted">❌ ŠPATNÝ TIP</div>
                    <div class="scoring-card-desc">Zápas jsi natipoval, ale netrefil jsi tendenci ani gól útěchy</div>
                </div>
                <div class="match-points-badge badge-pts-zero">0 b.</div>
            </div>
           <div class="scoring-card font-white card-border-red">
                    <div class="scoring-card-info">
                        <div class="scoring-card-title text-danger">⚠️ NENATIPOVANÝ ZÁPAS</div>
                        <div class="scoring-card-desc">Zápas odstartoval a ty nemáš v systému uložený žádný tip</div>
                    </div>
                    <div class="match-points-badge badge-pts-negative">-1 b.</div>
                </div>
            <div class="scoring-card font-white" style="margin-top: 6px; border-left: 4px solid #38bdf8; background: rgba(56, 189, 248, 0.05); flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px;">
                <div class="scoring-card-title" style="color: #38bdf8; font-size: 0.85rem;">⚖️ KRITÉRIA PŘI ROVNOSTI BODŮ V TABULCE</div>
                <div class="scoring-card-desc" style="color: #cbd5e1; font-size: 0.76rem; line-height: 1.5;">
                    Při stejném počtu bodů rozhoduje postupně:<br>
                    1. Vyšší počet <strong>přesných výsledků</strong> (🎯)<br>
                    2. Vyšší počet <strong>přesných TOP zápasů</strong> (🔥)<br>
                    3. Vyšší počet <strong>trefených tendencí</strong> (⚽)<br>
                    4. Méně <strong>nenatipovaných zápasů</strong> (❌)<br>
                    5. Více titulů <strong>Hráč kola</strong> (👑)<br>
                    6. Vyšší <strong>max bodů za kolo</strong> (⚡)<br>
                    7. Vyšší <strong>efektivita / úspěšnost</strong> (%)<br>
                    8. <strong>Dělené místo</strong>
                </div>
            </div>
        `;
    } else if (leagueName === "Chance Liga" || leagueName === "Liga národů") {
        container.innerHTML = `
            <div class="scoring-card font-white card-border-gold">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🥇 KRÁL STŘELCŮ</div>
                    <div class="scoring-card-desc">Uhodnutý nejlepší střelec sezóny (před 1. kolem)</div>
                </div>
                <div class="match-points-badge badge-pts-gold">+10 b.</div>
            </div>
            <div class="scoring-card font-white card-border-orange">
                <div class="scoring-card-info">
                    <div class="scoring-card-title" style="color: #f97316;">🔥 TOP ZÁPAS KOLA</div>
                    <div class="scoring-card-desc">Body ze zápasu označeného jako TOP se 2x NÁSOBÍ!</div>
                </div>
                <div class="match-points-badge badge-pts-orange">2x BODY</div>
            </div>
            <div class="scoring-card font-white card-border-purple">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-purple">⚡ BONUS ZA CELÉ KOLO</div>
                    <div class="scoring-card-desc">Trefíš tendenci (1, X, 2) VŠECH zápasů v daném kole</div>
                </div>
                <div class="match-points-badge badge-pts-purple">+5 b.</div>
            </div>
            <div class="scoring-card font-white card-border-gold">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🎯 PŘESNÝ VÝSLEDEK</div>
                    <div class="scoring-card-desc">Trefíš přesné skóre zápasu po 90 minutách</div>
                </div>
                <div class="match-points-badge badge-pts-gold">+5 b.</div>
            </div>
            <div class="scoring-card font-white card-border-green">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-green">⚽ TENDENCE / REMÍZA</div>
                    <div class="scoring-card-desc">Trefíš správného vítěze nebo nepřesnou remízu</div>
                </div>
                <div class="match-points-badge badge-pts-green">+2 b.</div>
            </div>
            <div class="scoring-card font-white card-border-muted">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-muted">❌ ŠPATNÝ TIP</div>
                    <div class="scoring-card-desc">Zápas jsi natipoval, ale netrefil jsi vítěze ani remízu</div>
                </div>
                <div class="match-points-badge badge-pts-zero">0 b.</div>
            </div>
            <div class="scoring-card font-white card-border-red">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-danger">⚠️ NENATIPOVANÝ ZÁPAS</div>
                    <div class="scoring-card-desc">Zápas odstartoval a ty nemáš uložený žádný tip</div>
                </div>
                <div class="match-points-badge badge-pts-negative">-1 b.</div>
            </div>
        `;
    } else if (leagueName === "MS ve fotbale") {
        container.innerHTML = `
            <div class="scoring-card font-white card-border-gold">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🏆 ŠAMPION</div>
                    <div class="scoring-card-desc">Uhodnutý celkový vítěz turnaje (před 1. kolem)</div>
                </div>
                <div class="match-points-badge badge-pts-gold">+8 b.</div>
            </div>
            <div class="scoring-card font-white card-border-gold">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🥇 STŘELEC</div>
                    <div class="scoring-card-desc">Uhodnutý celkový nejlepší střelec (před 1. kolem)</div>
                </div>
                <div class="match-points-badge badge-pts-gold">+8 b.</div>
            </div>
            <div class="scoring-card font-white card-border-gold">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🎯 PŘESNÝ VÝSLEDEK</div>
                    <div class="scoring-card-desc">Trefíš přesné skóre zápasu</div>
                </div>
                <div class="match-points-badge badge-pts-gold">+6 b.</div>
            </div>
            <div class="scoring-card font-white card-border-cyan">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-cyan">🔥 CHYTRÁ TENDENCE</div>
                    <div class="scoring-card-desc">Vítěz + přesný gól jednoho z týmů NEBO přesný rozdíl gólů</div>
                </div>
                <div class="match-points-badge badge-pts-cyan">+3 b.</div>
            </div>
            <div class="scoring-card font-white card-border-cyan">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-cyan">🤝 NEPŘESNÁ REMÍZA</div>
                    <div class="scoring-card-desc">Tipneš remízu a zápas skončí jinou remízou</div>
                </div>
                <div class="match-points-badge badge-pts-cyan">+3 b.</div>
            </div>
            <div class="scoring-card font-white card-border-green">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-green">⚽ ZÁKLADNÍ TENDENCE</div>
                    <div class="scoring-card-desc">Trefíš pouze čistého vítěze zápasu</div>
                </div>
                <div class="match-points-badge badge-pts-green">+2 b.</div>
            </div>
            <div class="scoring-card font-white card-border-lime">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-lime">🥅 GÓL ÚTĚCHY</div>
                    <div class="scoring-card-desc">Netrefíš nic, ale uhodneš přesný počet gólů aspoň jednoho týmu</div>
                </div>
                <div class="match-points-badge badge-pts-lime">+1 b.</div>
            </div>
            <div class="scoring-card font-white card-border-lime">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-lime">⏱️ VÍTĚZ PRODLOUŽENÍ</div>
                    <div class="scoring-card-desc">Trefíš správného postupujícího v play-off</div>
                </div>
                <div class="match-points-badge badge-pts-lime">+1 b.</div>
            </div>
            <div class="scoring-card font-white card-border-muted">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-muted">❌ ŠPATNÝ TIP</div>
                    <div class="scoring-card-desc">Zápas jsi natipoval, ale netrefil jsi žádný z bodovaných parametrů</div>
                </div>
                <div class="match-points-badge badge-pts-zero">0 b.</div>
            </div>
            <div class="scoring-card font-white card-border-red">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-danger">⚠️ NENATIPOVANÝ ZÁPAS</div>
                    <div class="scoring-card-desc">Zápas odstartoval a ty nemáš v systému uložený žádný tip</div>
                </div>
                <div class="match-points-badge badge-pts-negative">-1 b.</div>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="scoring-card font-white card-border-gold">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🏆 ŠAMPION</div>
                    <div class="scoring-card-desc">Uhodnutý celkový vítěz turnaje (před 1. kolem)</div>
                </div>
                <div class="match-points-badge badge-pts-gold">+10 b.</div>
            </div>
            <div class="scoring-card font-white card-border-gold">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🥇 STŘELEC</div>
                    <div class="scoring-card-desc">Uhodnutý celkový nejlepší střelec (před 1. kolem)</div>
                </div>
                <div class="match-points-badge badge-pts-gold">+10 b.</div>
            </div>
            <div class="scoring-card font-white card-border-gold">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🎯 PŘESNÝ VÝSLEDEK</div>
                    <div class="scoring-card-desc">Trefíš přesné skóre zápasu</div>
                </div>
                <div class="match-points-badge badge-pts-gold">+3 b.</div>
            </div>
            <div class="scoring-card font-white card-border-green">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-green">🏒 TENDENCE / REMÍZA</div>
                    <div class="scoring-card-desc">Trefíš správného vítěze zápasu nebo remízu</div>
                </div>
                <div class="match-points-badge badge-pts-green">+1 b.</div>
            </div>
            <div class="scoring-card font-white card-border-muted">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-muted">❌ ŠPATNÝ TIP</div>
                    <div class="scoring-card-desc">Zápas jsi natipoval, ale netrefil jsi vítěze ani remízu</div>
                </div>
                <div class="match-points-badge badge-pts-zero">0 b.</div>
            </div>
            <div class="scoring-card font-white card-border-red">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-danger">⚠️ NENATIPOVANÝ ZÁPAS</div>
                    <div class="scoring-card-desc">Zápas odstartoval a ty nemáš uložený žádný tip</div>
                </div>
                <div class="match-points-badge badge-pts-negative">-1 b.</div>
            </div>
        `;
    }
};

window.handleUserScoreChange = (matchId, isPlayoff) => {
    const selD = document.getElementById(`tip-domaci-${matchId}`);
    const selH = document.getElementById(`tip-hoste-${matchId}`);
    if (!selD || !selH) return;

    const store = Alpine.store('appState');
    const savedTip = store?.mojeTipy?.[matchId];
    const savedD = savedTip && savedTip.tip_domaci !== undefined && savedTip.tip_domaci !== null && savedTip.tip_domaci !== '' ? String(savedTip.tip_domaci) : (selD.dataset.saved || '');
    const savedH = savedTip && savedTip.tip_hoste !== undefined && savedTip.tip_hoste !== null && savedTip.tip_hoste !== '' ? String(savedTip.tip_hoste) : (selH.dataset.saved || '');

    const d = selD.value;
    const h = selH.value;

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

        // ⚡ PROFI UI REAKTIVITA: Přepsání všech schválených tipů do RAM paměti i L1 Cache
        if (store) {
            if (!store.mojeTipy) store.mojeTipy = {};
            if (!store.rozvrtaneTipy) store.rozvrtaneTipy = {};
            if (!store.rawSezonaData) store.rawSezonaData = { souteze: {} };
            if (!store.rawSezonaData.souteze) store.rawSezonaData.souteze = {};
            if (!store.rawSezonaData.souteze[ligaKlic]) store.rawSezonaData.souteze[ligaKlic] = { tipy: {} };
            if (!store.rawSezonaData.souteze[ligaKlic].tipy) store.rawSezonaData.souteze[ligaKlic].tipy = {};

            Object.keys(cistaMapaTipuProServer).forEach(mId => {
                if (!rejected.includes(mId)) {
                    const t = cistaMapaTipuProServer[mId];
                    store.mojeTipy[mId] = { tip_domaci: t.tip_domaci, tip_hoste: t.tip_hoste, postup: t.postup };
                    store.rozvrtaneTipy[`${mId}_domaci`] = String(t.tip_domaci);
                    store.rozvrtaneTipy[`${mId}_hoste`] = String(t.tip_hoste);
                    store.rozvrtaneTipy[`${mId}_postup`] = t.postup;

                    // ⚡ L1 CACHE SYNC
                    store.rawSezonaData.souteze[ligaKlic].tipy[mId] = { tip_domaci: t.tip_domaci, tip_hoste: t.tip_hoste, postup: t.postup };

                    // ⚪ OKAMŽITÉ PŘEBARVENÍ ROLETOEK NA BÍLO PO HROMADNÉM ULOŽENÍ
                    const dSel = document.getElementById(`tip-domaci-${mId}`);
                    const hSel = document.getElementById(`tip-hoste-${mId}`);
                    if (dSel) { dSel.style.color = '#ffffff'; dSel.dataset.saved = String(t.tip_domaci); dSel.style.borderColor = ''; }
                    if (hSel) { hSel.style.color = '#ffffff'; hSel.dataset.saved = String(t.tip_hoste); hSel.style.borderColor = ''; }
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
        window.isAppFormDirty = false;
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
// 👑 REAL-TIME SOUPISKA: MODULÁRNÍ ŘÍZENÍ PŘÍSTUPŮ A LIGOVÝCH ROLÍ (RBAC)
// =========================================================================
window.toggleUserAdmin = async (uid, checked) => {
    window.showToast("⏳ Aktualizuji admin roli...", false);
    
    // ⚡ Bleskový optimistický přepis v lokální paměti (0 ms)
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

        const functions = getFunctions(window.app);
        const managePermissions = httpsCallable(functions, 'manageUserPermissionsCF');
        
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
    const btnStyleSurvey = tab === 'survey' ? 'background: #2563eb; color: white; border-color: #60a5fa;' : 'background: #1f2937; color: #9ca3af; border-color: #374151;';
    const btnStyleTools = tab === 'tools' ? 'background: #ea580c; color: white; border-color: #f97316;' : 'background: #1f2937; color: #9ca3af; border-color: #374151;';

    // 🎛️ 3 HLAVNÍ ZÁLOŽKY VLÁDNÍHO KOKPITU
    container.innerHTML = `
        <div class="leaderboard-tabs-wrapper" style="margin-bottom: 15px; width: 100%; box-sizing: border-box; display: flex; gap: 6px;">
            <button class="nav-btn-leaderboard" style="flex: 1; height: 38px; padding: 0 4px; font-size: 0.78rem; ${btnStyleUsers}" onclick="window.switchSuperAdminTab('users');">
                👥 UŽIVATELÉ
            </button>
            <button class="nav-btn-leaderboard" style="flex: 1; height: 38px; padding: 0 4px; font-size: 0.78rem; ${btnStyleSurvey}" onclick="window.switchSuperAdminTab('survey');">
                📊 ANKETA
            </button>
            <button class="nav-btn-leaderboard" style="flex: 1; height: 38px; padding: 0 4px; font-size: 0.78rem; ${btnStyleTools}" onclick="window.switchSuperAdminTab('tools');">
                🔧 ZÁCHRANA BODŮ
            </button>
        </div>
        <div id="superAdminTabContentArea" style="width:100%;"></div>
    `;

    const contentArea = document.getElementById('superAdminTabContentArea');
    if (!contentArea) return;

    // --- TAB 1: ŽIVÁ SOUPISKA HRÁČŮ ---
    if (tab === 'users') {
        const uzivatele = store?.adminUsers || [];
        if (!store?.adminUsersLoaded && uzivatele.length === 0) {
            contentArea.innerHTML = '<div class="db-empty-msg">Načítám vládní soupisku... ⏳</div>';
        } else {
            window.vykresliSuperAdminUzivatele(uzivatele);
        }
    }

    // --- TAB 2: ŽIVÁ ANALYTIKA ANKETY PREMIER CUP ---
    else if (tab === 'survey') {
        contentArea.innerHTML = `
            <div class="db-empty-msg" style="padding: 25px 0; text-align: center; color: #60a5fa;">
                Načítám živé výsledky ankety ze stadionu... ⏳
            </div>
        `;

        try {
            const db = window.db;
            const { collection, getDocs } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js");
            const snap = await getDocs(collection(db, "ankety", "premier_cup", "hraci"));
            const allSurveys = {};
            snap.forEach(docSnap => {
                allSurveys[docSnap.id] = docSnap.data();
            });

            const allUsers = store?.adminUsers || [];
            // 🏴󠁧󠁢󠁥󠁮󠁧󠁿 Filtrujeme pouze běžné hráče s aktivním přístupem do Premier League
            const players19 = allUsers.filter(u => !u.isSuperAdmin && Array.isArray(u.leagues) && u.leagues.includes('Premier League'));

            let countVoted = 0, countSkipped = 0, countIncomplete = 0, countNotVisited = 0;
            let voteNo = 0, voteDiff = 0, voteYes = 0;

            const playersRows = players19.map(player => {
                const s = allSurveys[player.id];
                let statusBadge = '<span class="survey-status-badge badge-not-visited">⚪ NEOTEVŘEL</span>';

                if (s) {
                    if (s.status === 'VOTED') {
                        countVoted++;
                        if (s.volba === 1) { voteNo++; statusBadge = '<span class="survey-status-badge badge-voted-no">🔴 NE, NECHCI</span>'; }
                        else if (s.volba === 2) { voteDiff++; statusBadge = '<span class="survey-status-badge badge-voted-diff">🟡 JINÝ FORMÁT</span>'; }
                        else if (s.volba === 3) { voteYes++; statusBadge = '<span class="survey-status-badge badge-voted-yes">🟢 PŘESNĚ TOHLE</span>'; }
                    } else if (s.status === 'SKIPPED') {
                        countSkipped++;
                        statusBadge = '<span class="survey-status-badge badge-skipped">🟠 PŘESKOČIL</span>';
                    } else if (s.status === 'VISITED_INCOMPLETE') {
                        countIncomplete++;
                        statusBadge = '<span class="survey-status-badge badge-incomplete">🔵 NEÚPLNÉ</span>';
                    }
                } else {
                    countNotVisited++;
                }

                const tabs = s?.visitedTabs || [];
                const tabsStr = `${tabs.includes('groups') ? 'Skupiny ✔' : 'Skupiny ✖'} | ${tabs.includes('bracket') ? 'Pavouk ✔' : 'Pavouk ✖'} | ${tabs.includes('rules') ? 'Pravidla ✔' : 'Pravidla ✖'}`;

                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #111827; border-radius: 8px; border: 1px solid #1f2937;">
                        <div style="display: flex; flex-direction: column; gap: 2px; text-align: left;">
                            <strong style="color: #fff; font-size: 0.9rem;">${player.nickname || player.nick || 'Hráč'}</strong>
                            <span style="color: #64748b; font-size: 0.72rem;">${tabsStr}</span>
                        </div>
                        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                            ${statusBadge}
                            <span style="color: #94a3b8; font-size: 0.72rem;">${s?.votedAt ? new Date(s.votedAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                        </div>
                    </div>
                `;
            }).join('');

            contentArea.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    <!-- 3 BAREVNÉ KPI DLAŽDICE -->
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
                        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; border-radius: 8px; padding: 12px 6px; text-align: center;">
                            <div style="color: #34d399; font-size: 1.4rem; font-weight: bold; font-family: 'Oswald', sans-serif;">${voteYes}</div>
                            <div style="color: #94a3b8; font-size: 0.7rem; text-transform: uppercase;">🟢 Chci tohle</div>
                        </div>
                        <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid #f59e0b; border-radius: 8px; padding: 12px 6px; text-align: center;">
                            <div style="color: #fbbf24; font-size: 1.4rem; font-weight: bold; font-family: 'Oswald', sans-serif;">${voteDiff}</div>
                            <div style="color: #94a3b8; font-size: 0.7rem; text-transform: uppercase;">🟡 Jiný formát</div>
                        </div>
                        <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: 8px; padding: 12px 6px; text-align: center;">
                            <div style="color: #f87171; font-size: 1.4rem; font-weight: bold; font-family: 'Oswald', sans-serif;">${voteNo}</div>
                            <div style="color: #94a3b8; font-size: 0.7rem; text-transform: uppercase;">🔴 Nechci</div>
                        </div>
                    </div>

                    <!-- FUNNEL STATISTIKA -->
                    <div style="background: #111827; border: 1px solid #374151; border-radius: 8px; padding: 10px 14px; display: flex; justify-content: space-between; font-size: 0.75rem; color: #94a3b8;">
                        <span>🗳️ Hlasovalo: <strong style="color: #fff;">${countVoted} / ${players19.length}</strong></span>
                        <span>🟠 Přeskočilo: <strong style="color: #fff;">${countSkipped}</strong></span>
                        <span>⚪ Neotevřelo: <strong style="color: #fff;">${countNotVisited}</strong></span>
                    </div>

                    <!-- JMENNÝ SEZNAM 19 HRÁČŮ -->
                    <div style="display: flex; flex-direction: column; gap: 6px; max-height: 480px; overflow-y: auto;">
                        ${playersRows}
                    </div>
                </div>
            `;
        } catch (e) {
            console.error("Chyba při načítání ankety v SuperAdminu:", e);
            contentArea.innerHTML = '<div class="db-empty-msg" style="color:#f87171;">Chyba načítání výsledků ankety.</div>';
        }
    }

    // --- TAB 3: NÁSTROJE & ZÁCHRANA BODŮ ---
    else if (tab === 'tools') {
        const allUsers = (window.adminUsersCache || []).map(d => {
            const data = typeof d.data === 'function' ? d.data() : d;
            return { id: d.id, ...data };
        });

        const adminOnlyList = allUsers.filter(u => u.isAdmin || u.isSuperAdmin);
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

    const formatujAktivitu = (lastSeen) => {
        if (!lastSeen) return '<span style="color: #6b7280; font-size: 0.75rem; font-family: monospace;">⏳ Nikdy</span>';
        
        let d = null;
        if (typeof lastSeen.toDate === 'function') d = lastSeen.toDate();
        else if (lastSeen.seconds) d = new Date(lastSeen.seconds * 1000);
        else d = new Date(lastSeen);

        if (isNaN(d.getTime())) return '<span style="color: #6b7280; font-size: 0.75rem; font-family: monospace;">⏳ Nikdy</span>';

        const nyni = new Date();
        const rozdilMs = nyni.getTime() - d.getTime();

        // 🟢 Méně než 10 minut = Online (Smaragdová)
        if (rozdilMs < 10 * 60 * 1000) {
            return '<span style="color: #34d399; font-weight: bold; font-size: 0.75rem; font-family: monospace; display: inline-flex; align-items: center; gap: 4px;">🟢 Online</span>';
        }

        const cas = d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
        const dnesPolnoc = new Date(nyni.getFullYear(), nyni.getMonth(), nyni.getDate());
        const vceraPolnoc = new Date(dnesPolnoc);
        vceraPolnoc.setDate(vceraPolnoc.getDate() - 1);

        // 🔵 Dnes = Azurově modrá
        if (d >= dnesPolnoc) {
            return `<span style="color: #38bdf8; font-weight: bold; font-size: 0.75rem; font-family: monospace;">Dnes ${cas}</span>`;
        } 
        // 🟡 Včera = Zlatavě žlutá
        else if (d >= vceraPolnoc) {
            return `<span style="color: #fbbf24; font-size: 0.75rem; font-family: monospace;">Včera ${cas}</span>`;
        } 
        // ⚪ Starší = Běžná šedá
        else {
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

        const aktivitaHtml = formatujAktivitu(data.lastSeen);

        const userRow = document.createElement('div');
        userRow.className = 'leaderboard-row-wrapper';
        userRow.id = `user-row-${uid}`;
        userRow.style.width = '100%';
        
        userRow.innerHTML = `
            <div onclick="const det = this.nextElementSibling; const arr = this.querySelector('.super-arrow-icon'); if(det.style.display==='none'){det.style.display='flex'; arr.innerText='▲';}else{det.style.display='none'; arr.innerText='▼';}" 
                 class="leaderboard-row-trigger" style="background: ${zebraBg}; border: 1px solid ${borderColor}; cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; border-radius: 8px;">
                <div class="leaderboard-row-left" style="display:flex; align-items:center; gap:8px; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:65%;">
                    <strong style="color: ${maZadnouLigu ? '#fbbf24' : '#ffffff'}; font-size: 1rem; font-family: 'Oswald', sans-serif; letter-spacing: 0.3px;">${data.nickname || 'Nový Hráč'}</strong>
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
            <p style="font-size: 0.95rem; color: #9ca3af; line-line-height: 1.5; margin: 0 0 25px 0;">
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

        // ⚡ 1. BLESKOVÝ OPTIMISTICKÝ VÝMAZ Z OBRAZOVKY (0 ms)
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

        // 🚀 2. OSTRÉ SERVEROVÉ SMAZÁNÍ NA POZADÍ
        try {
            const functions = getFunctions(window.app);
            const purgeUserCF = httpsCallable(functions, 'purgeUserAbsoluteCF');
            
            await purgeUserCF({ targetUid: uid });
            window.showToast("🗑️ Účet i veškerá herní data kompletně smazána!");
        } catch (error) {
            console.error("Chyba při exekuci Nuclear Purge:", error);
            window.showToast("❌ Selhalo serverové mazání.", true);
            if (typeof window.renderSuperAdmin === 'function') window.renderSuperAdmin();
        }
    };
};

// 🎮 FUNKCE PRO VYNUCENÉ ULOŽENÍ UNIKÁTNÍ PŘEZDÍVKY HRÁČE (PŘES CLOUD FUNKCI)
window.saveNickname = async () => {
    const user = window.auth.currentUser;
    if (!user) return;

    const nickInput = document.getElementById('new-nickname');
    const nickVal = nickInput ? nickInput.value.trim() : '';

    // 1. Kontrola délky (3 až 15 znaků)
    if (!nickVal || nickVal.length < 3 || nickVal.length > 15) {
        window.showToast("Přezdívka musí mít 3 až 15 znaků! 📏", true);
        return;
    }

    // 2. Kontrola povolených znaků (česká abeceda, číslice, mezera, pomlčka, podtržítko)
    const regexPovoleneZnaky = /^[a-zA-Z0-9áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ _-]+$/;
    if (!regexPovoleneZnaky.test(nickVal)) {
        window.showToast("Přezdívka obsahuje nepovolené znaky! 🚫", true);
        return;
    }

    window.showToast("⏳ Ověřuji unikátnost přezdívky...", false);

    try {
        const functions = getFunctions(window.app);
        const registerNicknameCF = httpsCallable(functions, 'registerNicknameCF');

        const res = await registerNicknameCF({ nickname: nickVal });

        if (res.data?.success) {
            const store = Alpine.store('appState');
            if (store) {
                store.nickname = nickVal;
                const nickLabel = document.getElementById('userMenuNickname');
                if (nickLabel) { nickLabel.innerText = nickVal; }
                store.currentScreen = 'leaguesScreen';
            }

            window.showToast("🎮 Přezdívka uložena, vítej ve hře!");
        }
    } catch (e) {
        console.error("Chyba registrace přezdívky:", e);
        window.showToast(`❌ ${e.message || "Chyba při ukládání přezdívky."}`, true);
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

        zebricek.forEach(p => {
            if (p.uid) mapaPrezdivek[p.uid] = p.nickname;
        });

        let vsichniHraciUids = zebricek.map(p => p.uid).filter(Boolean);
        let isEvaluated = (matchData.vysledek_domaci !== undefined && matchData.vysledek_hoste !== undefined && matchData.apiStatus !== "IN_PLAY" && matchData.apiStatus !== "PAUSED");
        const tipyProZapas = spyData.tipy || [];

        // 🚨 Fallback pojistka pro načtení z dat od bota
        if (vsichniHraciUids.length === 0 && tipyProZapas.length > 0) {
            vsichniHraciUids = tipyProZapas.map(tip => tip.uid || tip.userEmail).filter(Boolean);
        }

        // Seřadíme hráče podle abecedy přezdívek
        vsichniHraciUids.sort((a, b) => {
            const nA = mapaPrezdivek[a] || 'Hráč';
            const nB = mapaPrezdivek[b] || 'Hráč';
            return nA.localeCompare(nB, 'cs');
        });

        let nenatipovaloPocet = 0;
        let rowsHtml = '';
        const currentAuthUid = window.auth.currentUser?.uid;

        const jeBeziciLive = (matchData.apiStatus === "IN_PLAY" || matchData.apiStatus === "PAUSED");
        const prubDom = matchData.vysledek_domaci !== undefined && matchData.vysledek_domaci !== null ? matchData.vysledek_domaci : 0;
        const prubHos = matchData.vysledek_hoste !== undefined && matchData.vysledek_hoste !== null ? matchData.vysledek_hoste : 0;

        vsichniHraciUids.forEach((uid, idx) => {
            const hracNick = mapaPrezdivek[uid] || 'Hráč';
            const pObj = zebricek.find(p => p.uid === uid);
            const pEmail = pObj?.email ? pObj.email.trim().toLowerCase() : '';

            // 🎯 Vícenásobné párování: UID, e-mail z profilu nebo shoda přezdívky
            const t = tipyProZapas.find(tip => 
                (tip.uid && tip.uid === uid) || 
                (tip.userId && tip.userId === uid) ||
                (pEmail && tip.userEmail && tip.userEmail.trim().toLowerCase() === pEmail) ||
                (tip.nickname && hracNick && tip.nickname.trim().toLowerCase() === hracNick.trim().toLowerCase())
            );

            const isMe = uid === currentAuthUid || (pEmail && window.auth.currentUser?.email && pEmail === window.auth.currentUser.email.trim().toLowerCase());
            const zebraClass = idx % 2 === 0 ? 'zebra-odd' : 'zebra-even';
            const meClass = isMe ? 'is-current-user' : '';

            let tipStr = '? : ?';
            let hasTip = false;

            if (t && t.tip_domaci !== undefined && t.tip_domaci !== null && t.tip_domaci !== '') {
                hasTip = true;
                let tDomStr = t.tip_domaci;
                let tHosStr = t.tip_hoste;
                if (matchData.isPlayoff && t.tip_domaci === t.tip_hoste && t.postup) {
                    if (t.postup === 'domaci') tDomStr = '*' + tDomStr;
                    else if (t.postup === 'hoste') tHosStr = tHosStr + '*';
                }
                tipStr = `${tDomStr} : ${tHosStr}`;
            } else {
                nenatipovaloPocet++;
            }

            const badgeInfo = window.urciBarvuATriduBodu(
                hasTip ? t.tip_domaci : '',
                hasTip ? t.tip_hoste : '',
                prubDom,
                prubHos,
                leagueName,
                hasTip ? t.postup : '',
                matchData.postup,
                matchData.isPlayoff,
                matchData.isTopMatch,
                hasTip
            );

            const ptsBadgeHtml = (isEvaluated || jeBeziciLive)
                ? `<div class="match-spy-pts-badge ${badgeInfo.badgeClass}">${badgeInfo.ptsBadgeStr}</div>`
                : `<div class="match-spy-pts-badge badge-pts-zero">⏳ –</div>`;

            rowsHtml += `
                <div class="match-spy-card ${zebraClass} ${meClass}">
                    <span class="match-spy-nick">${window.escapeHTML(hracNick)}</span>
                    <div class="match-spy-boxes">
                        <div class="match-spy-tip-box ${hasTip ? '' : 'no-tip'}">${tipStr}</div>
                        ${ptsBadgeHtml}
                    </div>
                </div>
            `;
        });

        let scorePillHtml = '';
        if (isEvaluated) {
            let resDomStr = matchData.vysledek_domaci;
            let resHosStr = matchData.vysledek_hoste;
            if (matchData.isPlayoff && matchData.vysledek_domaci === matchData.vysledek_hoste && matchData.postup) {
                if (matchData.postup === 'domaci') resDomStr = '*' + resDomStr;
                else if (matchData.postup === 'hoste') resHosStr = resHosStr + '*';
            }
            scorePillHtml = `<div class="match-spy-score-pill">${resDomStr} : ${resHosStr}</div>`;
        } else if (matchData.apiStatus === "IN_PLAY" || matchData.apiStatus === "PAUSED") {
            let prubD = matchData.vysledek_domaci !== undefined ? matchData.vysledek_domaci : 0;
            let prubH = matchData.vysledek_hoste !== undefined ? matchData.vysledek_hoste : 0;
            if (matchData.isPlayoff && prubD === prubH && matchData.postup) {
                if (matchData.postup === 'domaci') prubD = '*' + prubD;
                else if (matchData.postup === 'hoste') prubH = prubH + '*';
            }
            scorePillHtml = `<div class="match-spy-score-pill is-live"><span class="match-spy-live-dot"></span>LIVE ${prubD} : ${prubH}</div>`;
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
        
        const topIconHtml = matchData.isTopMatch ? '🔥 ' : '';

        // 🏟️ KOMPAKTNÍ SPORTOVNÍ SCOREBOARD WIDGET UVNITŘ HLAVIČKY
        const modalTitle = `
            <div class="match-spy-header-container" style="padding-bottom: 2px;">
                <div class="match-spy-teams-title">${topIconHtml}${matchTitle}</div>
                ${scorePillHtml}
                <div style="text-align: center; color: #9ca3af; font-size: 0.74rem; background: #1f2937; border: 1px solid #374151; padding: 3px 10px; border-radius: 6px; margin: 4px auto 2px auto; font-weight: bold; width: fit-content; letter-spacing: 0.3px;">
                    📊 Skupina: <span style="color:#fff;">${pDom}%</span> – <span style="color:#fff;">${pRem}%</span> – <span style="color:#fff;">${pHos}%</span>
                </div>
                <div style="text-align: center; color: ${nenatipovaloPocet > 0 ? '#f87171' : '#34d399'}; font-size: 0.70rem; font-weight: bold; font-family: monospace; text-transform: uppercase; margin-top: 2px;">
                    ${nenatipovaloPocet > 0 ? `⚠️ NENATIPOVALO ${nenatipovaloPocet} HRÁČŮ` : '✅ VŠICHNI HRÁČI NATIPOVALI'}
                </div>
            </div>
        `;

        // 📌 PŘESNĚ SLÍCOVANÉ ZÁHLAVÍ SLOUPCŮ + SEZNAM KARET
        const fullBodyContent = `
            <div class="match-spy-header-bar">
                <span class="match-spy-header-bar-nick">HRÁČ</span>
                <div class="match-spy-header-bar-boxes">
                    <span class="match-spy-header-bar-tip">TIP</span>
                    <span class="match-spy-header-bar-pts">BODY</span>
                </div>
            </div>
            <div class="spy-modal-body" style="flex:1; overflow-y:auto; padding: 0; background:#0b0f19; display: flex; flex-direction: column; width: 100%;">
                <div class="match-spy-list">
                    ${rowsHtml}
                </div>
            </div>
        `;

        window.openGlobalUiModal(modalTitle, fullBodyContent);
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
        const functions = getFunctions(window.app);
        const recalculateLeaderboard = httpsCallable(functions, 'recalculateLeaderboardCF');

        await recalculateLeaderboard({ leagueName: leagueName });

        // 🧹 Okamžitý reset mezipaměti pro Špehovací oko a Historii tipů
        window.tipniToCache = { histories: {}, spy: {} };

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

// 🔒 Pomocná funkce pro zobrazení varovného modálu (chrání Loutkovodiče před smazáním z DOMu)
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

    // 🛡️ Cílíme výhradně na dynamický popup a NIKDY nesmažeme statického #loutkovodic-modal
    const overlays = document.querySelectorAll('.spy-modal-overlay:not(#loutkovodic-modal)');
    const overlay = overlays[overlays.length - 1];

    const btnStay = document.getElementById('dirty-modal-stay');
    const btnLeave = document.getElementById('dirty-modal-leave');

    if (btnStay) {
        btnStay.onclick = () => { if (overlay) overlay.remove(); };
    }
    if (btnLeave) {
        btnLeave.onclick = () => {
            window.isAppFormDirty = false;
            if (overlay) overlay.remove();
            onConfirm();
        };
    }
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

// 🎭 LOUTKOVODIČ INTERCEPTOR (Garantuje zachování elementu v DOMu a čisté zavření)
document.addEventListener('click', (e) => {
    const modal = document.getElementById('loutkovodic-modal');
    if (!modal) return;

    const closeBtn = e.target.closest('#loutkovodic-modal .spy-modal-close');
    const clickedOutside = e.target === modal;

    if (closeBtn || clickedOutside) {
        e.stopPropagation();
        e.preventDefault();
        const store = Alpine.store('appState');
        
        if (window.isAppFormDirty) {
            zobrazVarovnyModal(() => {
                window.isAppFormDirty = false;
                if (store) store.loutkovodicOpen = false;
            });
        } else {
            window.isAppFormDirty = false;
            if (store) store.loutkovodicOpen = false;
        }
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
// 🎭 LOUTKOVODIČ REAKTIVNÍ CONTROLLER (ČISTÁ DATOVÁ FUNKČNOST BEZ HTML)
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

    // 🧠 CHYTRÝ RESOLVER HRÁČE: Hledáme v reaktivním Alpine poli i záložní cache
    const cachedDoc = window.adminUsersCache?.find(docSnap => docSnap.id === uid);
    const cachedData = cachedDoc ? (typeof cachedDoc.data === 'function' ? cachedDoc.data() : cachedDoc) : {};
    const uItem = store.adminUsers?.find(u => u.id === uid) 
               || store.adminUsersCache?.find(u => u.id === uid)
               || cachedData || {};
    
    // 🛡️ OCHRANA PROTI PODVÁDĚNÍ: Běžný Loutkovodič ze soupisky je pro Adminy blokován (povoleno jen přes Nouzového loutkovodiče)
    if (!allowAdmin && (uItem.isAdmin || uItem.isSuperAdmin)) {
        window.showToast("⛔ Loutkovodič je pro účty administrátorů zakázán! (Použij záložku Záchrana bodů)", true);
        return;
    }

    // 🧹 ČISTÝ RESET STAVU PRO BEZCHYBNÉ OPAKOVANÉ OTEVŘENÍ
    window.isAppFormDirty = false;
    if (window.dirtyInputsRegistry) window.dirtyInputsRegistry.clear();

    store.loutkovodicTargetUid = uid;
    store.loutkovodicTargetNickname = uItem.nickname || 'Hráč';
    store.loutkovodicTargetEmail = uItem.email || '';
    store.loutkovodicSelectedLeague = '';
    store.loutkovodicBonusVitez = '';
    store.loutkovodicBonusStrelec = '';
    store.loutkovodicBonusOpen = false;
    store.loutkovodicMatches = [];
    store.loutkovodicMatchesLoaded = false;
    
    // 🚀 BLESKOVÝ REAKTIVNÍ FLIP
    store.loutkovodicOpen = false;
    if (typeof Alpine !== 'undefined' && Alpine.nextTick) {
        Alpine.nextTick(() => {
            store.loutkovodicOpen = true;
        });
    } else {
        store.loutkovodicOpen = true;
    }
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
        
        // 🎯 CHYTRÝ DETEKTOR KOLA PRO LOUTKOVODIČE (Skok na aktuální nebo poslední odehrané kolo)
        if (serazeneZapasy.length > 0) {
            const kolaSeznam = store.unikatniKolaLoutkovodic || [];
            const prveNeukoncene = serazeneZapasy.find(m => m.vysledek_domaci === undefined || m.apiStatus === "IN_PLAY" || m.apiStatus === "PAUSED");
            
            if (prveNeukoncene) {
                const nazevKola = window.prelozFaziTurnaje(prveNeukoncene.stage, prveNeukoncene.kolo, prveNeukoncene.isPlayoff);
                const idx = kolaSeznam.indexOf(nazevKola);
                store.loutkovodicKolaIndex = idx !== -1 ? idx : 0;
            } else {
                store.loutkovodicKolaIndex = Math.max(0, kolaSeznam.length - 1);
            }
        }

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

window.posunKoloLoutkovodic = (smer) => {
    const store = Alpine.store('appState');
    if (!store || !store.unikatniKolaLoutkovodic || store.unikatniKolaLoutkovodic.length === 0) return;
    let novyIndex = store.loutkovodicKolaIndex + smer;
    if (novyIndex >= 0 && novyIndex < store.unikatniKolaLoutkovodic.length) {
        store.loutkovodicKolaIndex = novyIndex;
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

        // 🧹 Okamžitý reset mezipaměti pro Špehovací oko a Historii tipů
        window.tipniToCache = { histories: {}, spy: {} };

        window.showToast("🎭 Data bezpečně uložena za hráče!");
        window.isAppFormDirty = false;
        store.loutkovodicOpen = false;

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
// 🏴󠁧󠁢󠁥󠁮󠁧󠁿 PREMIER LEAGUE 2026/2027 - MATICE KOŠŮ A DERBY RIVALIT
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

    document.querySelectorAll('.spy-modal-overlay').forEach(el => el.remove());

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

// 2. DYNAMICKÝ GENERÁTOR SE 3 PÁKAMI VARIABILITY (PAMĚŤ + PRIORITY SHUFFLE + SEEDING)
window.generujNoveTopZapasy = async () => {
    const store = Alpine.store('appState');
    const activeAdminLeague = store?.selectedAdminLeague;
    const zapasy = store?.adminMatches || [];

    if (!activeAdminLeague || zapasy.length === 0) return;

    document.querySelectorAll('.spy-modal-overlay').forEach(el => el.remove());
    window.showToast("⚡ Generuji nový unikátní návrH TOP zápasů...", false);

    const kolaMapa = {};
    zapasy.forEach(m => {
        const nazevKola = window.prelozFaziTurnaje(m.stage, m.kolo, m.isPlayoff);
        if (!kolaMapa[nazevKola]) kolaMapa[nazevKola] = [];
        kolaMapa[nazevKola].push(m);
    });

    const seznamKol = Object.keys(kolaMapa);
    const totalRounds = seznamKol.length;

    // PÁKA 3: NAČTENÍ MINULÉHO NÁVRHU A VÝBĚR 2-3 BLOKOVANÝCH ZÁPASŮ PRO VYVOTÁNÍ ZMĚNY
    const prevProposalIds = window.vygenerovaneTopMatchIdsCache || [];
    const bannedMatchIds = new Set();
    if (prevProposalIds.length > 0) {
        const shufflePrev = [...prevProposalIds].sort(() => Math.random() - 0.5);
        const banCount = Math.floor(Math.random() * 2) + 2; // Smaže 2 až 3 zápasy z minulého návrhu
        for (let b = 0; b < Math.min(banCount, shufflePrev.length); b++) {
            bannedMatchIds.add(shufflePrev[b]);
        }
    }

    // PÁKA 2: TÝMOVÝ SEED - Generování skrytých náhodných bonusů pro týmy v této konkrétní simulaci
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

        // Přičtení dynamického Seed bonusu pro vyvážené souboje
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

        // PÁKA 1: PRIORITY SHUFFLE - Kola se stejným počtem možností se zamíchají náhodně
        const prioritizedRounds = [...roundData].sort((a, b) => {
            if (a.strictCount !== b.strictCount) {
                return a.strictCount - b.strictCount;
            }
            // Místo pevného řazení podle rIdx přidáme náhodný šum pro stejnou skupinu možností
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
                    // Blokování minulého návrhu (Páka 3) platí v Tiers 1-3
                    if (bannedMatchIds.has(z.id) && tier < 4) continue;

                    const d = String(z.domaci || '').trim();
                    const h = String(z.hoste || '').trim();
                    const kosD = PL_URCI_KOS(d);
                    const kosH = PL_URCI_KOS(h);
                    const dvojiceKlic = [PL_NORM(d), PL_NORM(h)].sort().join(' vs ');

                    const cD = tymCount[d] || 0;
                    const cH = tymCount[h] || 0;

                    // 🛑 ABSOLUTNÍ ČERVENÁ LINIE
                    if ((kosD === 1 && kosH === 3) || (kosD === 3 && kosH === 1)) continue;
                    if (cD >= 4 || cH >= 4) continue;
                    if (odehraneDvojice.has(dvojiceKlic)) continue;

                    // Tier 1: Ideální stav
                    if (tier === 1) {
                        if (kosD !== kosH) continue;
                        if (tymPosledniKolo[d] !== undefined && Math.abs(rIdx - tymPosledniKolo[d]) < 3) continue;
                        if (tymPosledniKolo[h] !== undefined && Math.abs(rIdx - tymPosledniKolo[h]) < 3) continue;
                    }
                    // Tier 2: Mírnější cooldown
                    else if (tier === 2) {
                        if (kosD !== kosH) continue;
                        if (tymPosledniKolo[d] !== undefined && Math.abs(rIdx - tymPosledniKolo[d]) < 2) continue;
                        if (tymPosledniKolo[h] !== undefined && Math.abs(rIdx - tymPosledniKolo[h]) < 2) continue;
                    }
                    // Tier 3: Nouzový mix B2 vs B3
                    else if (tier === 3) {
                        if (kosD === 1 || kosH === 1) continue;
                        if (!((kosD === 2 && kosH === 3) || (kosD === 3 && kosH === 2))) continue;
                        if (tymPosledniKolo[d] !== undefined && Math.abs(rIdx - tymPosledniKolo[d]) < 2) continue;
                        if (tymPosledniKolo[h] !== undefined && Math.abs(rIdx - tymPosledniKolo[h]) < 2) continue;
                    }
                    // Tier 4: Záchranný pás
                    else if (tier === 4) {
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

// =========================================================================
// 📖 OBSLUHA MODÁLNÍHO OKNA - JAK HRÁT? (UŽIVATELSKÝ NÁVOD)
// =========================================================================
window.otevriNavod = () => {
    const navodHtml = `
        <div style="padding: 10px; color: #e5e7eb; font-size: 0.85rem; line-height: 1.5; text-align: left; display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; width: 100%;">

            <div style="border-bottom: 1px solid #374151; padding-bottom: 8px;">
                <strong style="color: #fbbf24; font-size: 0.95rem; font-family: 'Oswald', sans-serif;">⚽ 1. Tipování zápasů & Uzávěrky (Program utkání)</strong>
                <ul style="margin: 4px 0 0 0; padding-left: 18px; color: #9ca3af;">
                    <li><strong style="color: #fff;">Zadávání skóre:</strong> V záložce <strong>⚽ Program utkání</strong> zvol na roletkách předpokládané skóre obou týmů.</li>
                    <li><strong style="color: #fff;">Ukládání tipů:</strong> Tip ulož tlačítkem <strong>ULOŽ</strong> u konkrétního zápasu, nebo vyplň více utkání a v horní liště klepni na tlačítko <strong>🎯 ZAPSAT VŠE</strong>.</li>
                    <li><strong style="color: #fff;">Uzávěrka:</strong> Možnost natipovat nebo změnit tipy se uzamyká přesně v plánovaný čas výkopu zápasu.</li>
                </ul>
            </div>

            <div style="border-bottom: 1px solid #374151; padding-bottom: 8px;">
                <strong style="color: #fbbf24; font-size: 0.95rem; font-family: 'Oswald', sans-serif;">🎁 2. Dlouhodobé bonusové tipy (Před 1. kolem)</strong>
                <ul style="margin: 4px 0 0 0; padding-left: 18px; color: #9ca3af;">
                    <li>V záložce Program utkání rozbal nahoře lištu <strong>🎁 BONUSOVÉ TIPY</strong>.</li>
                    <li>Zadej celkového <strong>vítěze ligy</strong> a <strong>nejlepšího střelce soutěže</strong>. Tyto tipy je nutné uložit před výkopem prvního zápasu sezóny.</li>
                </ul>
            </div>

            <div style="border-bottom: 1px solid #374151; padding-bottom: 8px;">
                <strong style="color: #fbbf24; font-size: 0.95rem; font-family: 'Oswald', sans-serif;">🔴 3. Živé zápasy (LIVE) & Špehovací panel (👁️)</strong>
                <ul style="margin: 4px 0 0 0; padding-left: 18px; color: #9ca3af;">
                    <li><strong style="color: #fff;">Průběžné skóre:</strong> Během zápasů vidíš živé skóre v reálném čase a v záložce <strong>🏆 Pořadí</strong> se zpřístupní <strong>🔴 LIVE pořadí</strong>.</li>
                    <li><strong style="color: #fff;">Špehovací oko (👁️):</strong> U běžících nebo odehraných zápasů klepni na ikonu oka pro detailní přehled tipů všech soupeřů a procentuální rozložení celé komunity.</li>
                </ul>
            </div>

            <div style="border-bottom: 1px solid #374151; padding-bottom: 8px;">
                <strong style="color: #fbbf24; font-size: 0.95rem; font-family: 'Oswald', sans-serif;">⚔️ 4. H2H Duel (Porovnat se mnou)</strong>
                <ul style="margin: 4px 0 0 0; padding-left: 18px; color: #9ca3af;">
                    <li>V tabulce pořadí rozbal kartu kteréhokoliv soupeře a klepni na <strong>⚔️ POROVNAT SE MNOU</strong>.</li>
                    <li>Uvidíš přímé porovnání 18 metrik: formu za posledních 5 zápasů, vzájemná vyhraná kola, shodu tipů i přímé duely s opačným tipem.</li>
                </ul>
            </div>

            <div style="border-bottom: 1px solid #374151; padding-bottom: 8px;">
                <strong style="color: #fbbf24; font-size: 0.95rem; font-family: 'Oswald', sans-serif;">👀 5. Zajímavosti (Ligový Radar)</strong>
                <ul style="margin: 4px 0 0 0; padding-left: 18px; color: #9ca3af;">
                    <li>V záložce Pořadí přepni na podzáložku <strong>👀 Zajímavosti</strong> pro sledování ligových extrémů:</li>
                    <li>💰 <strong style="color: #fff;">Zlatý důl:</strong> Zápas, kde liga brala nejvíce bodů.</li>
                    <li>💀 <strong style="color: #fff;">Totální výbuch:</strong> Zápasy, kde nikdo z celé ligy nezískal ani bod.</li>
                    <li>🐺 <strong style="color: #fff;">Vlci samotáři:</strong> Zápasy, které trefil pouze jeden jediný hráč.</li>
                    <li>🩹 <strong style="color: #fff;">Smolař sezóny:</strong> Hráč, který nejčastěji minul přesný výsledek o jediný gól.</li>
                    <li>🏟️ <strong style="color: #fff;">Štědrost klubů:</strong> Které týmy sypou body (💰 Bankomat) a které pálí tipy (💀 Hrobař).</li>
                </ul>
            </div>

            <div style="border-bottom: 1px solid #374151; padding-bottom: 8px;">
                <strong style="color: #fbbf24; font-size: 0.95rem; font-family: 'Oswald', sans-serif;">🏆 6. TIPNI PREMIER CUP (Pohárová soutěž)</strong>
                <ul style="margin: 4px 0 0 0; padding-left: 18px; color: #9ca3af;">
                    <li><strong style="color: #34d399;">Netipují se žádné zápasy navíc!</strong> Do poháru se automaticky propisují body z tvých běžných ligových tipů Premier League.</li>
                    <li>• <strong>1.–9. kolo:</strong> Kvalifikace (tabulka po 9. kole určí nasazení Hadím draftem).</li>
                    <li>• <strong>10.–19. kolo:</strong> Základní skupiny (4 skupiny po 5 hráčích).</li>
                    <li>• <strong>21.–32. kolo:</strong> Schodová pyramida Play-off (1. a 2. Předkolo ➔ Osmifinále ➔ Čtvrtfinále ➔ Semifinále ➔ Grand Finále).</li>
                </ul>
            </div>

            <div>
                <strong style="color: #fbbf24; font-size: 0.95rem; font-family: 'Oswald', sans-serif;">📲 7. Instalace na plochu mobilu (PWA)</strong>
                <ul style="margin: 4px 0 0 0; padding-left: 18px; color: #9ca3af;">
                    <li>Otevři boční menu (☰) a klepni na <strong>📲 Stáhnout jako aplikaci</strong> (nebo <em>Instalace pro iPhone</em> na iOS) pro spouštění tipovačky přímo z plochy telefonu na celou obrazovku.</li>
                </ul>
            </div>

        </div>
    `;
    window.openGlobalUiModal('JAK HRÁT? (NÁVOD)', navodHtml);
};

// 📱 NÁVOD NA INSTALACI PRO IPHONE (iOS)
window.otevriNavodIphone = () => {
    const navodIphoneHtml = `
        <div style="padding: 10px; color: #e5e7eb; font-size: 0.88rem; line-height: 1.5; text-align: left; display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; width: 100%;">
            
            <div style="background: rgba(2, 132, 199, 0.15); border: 1px solid #38bdf8; padding: 10px; border-radius: 8px; color: #38bdf8; font-size: 0.8rem; line-height: 1.4;">
                🍏 <strong>Upozornění pro iOS:</strong> Apple neumožňuje automatickou instalaci jedním tlačítkem. Instalaci provedeš v prohlížeči <strong>Safari</strong> během 5 sekund podle návodu níže.
            </div>

            <div style="border-bottom: 1px solid #374151; padding-bottom: 8px;">
                <strong style="color: #fbbf24; font-size: 0.95rem; font-family: 'Oswald', sans-serif;">1. Otevři web v Safari</strong>
                <p style="margin: 4px 0 0 0; color: #9ca3af;">Instalace funguje výhradně v prohlížeči <strong>Safari</strong> (v Chrome nebo Opeře na iOS možnost uložení na plochu chybí).</p>
            </div>

            <div style="border-bottom: 1px solid #374151; padding-bottom: 8px;">
                <strong style="color: #fbbf24; font-size: 0.95rem; font-family: 'Oswald', sans-serif;">2. Klepni na ikonu Sdílení ⎋</strong>
                <p style="margin: 4px 0 0 0; color: #9ca3af;">Dole uprostřed v liště Safari klikni na tlačítko <strong>Sdílet</strong> (čtvereček se šipkou směřující nahoru).</p>
            </div>

            <div style="border-bottom: 1px solid #374151; padding-bottom: 8px;">
                <strong style="color: #fbbf24; font-size: 0.95rem; font-family: 'Oswald', sans-serif;">3. Vyber „Přidat na plochu“ ➕</strong>
                <p style="margin: 4px 0 0 0; color: #9ca3af;">V nabídce posuň kousek dolů a klepni na položku <strong>Přidat na plochu</strong> (<em>Add to Home Screen</em>).</p>
            </div>

            <div>
                <strong style="color: #fbbf24; font-size: 0.95rem; font-family: 'Oswald', sans-serif;">4. Potvrď tlačítkem „Přidat“</strong>
                <p style="margin: 4px 0 0 0; color: #9ca3af;">Vpravo nahoře klepni na <strong>Přidat</strong>. Na plochu iPhonu se ti uloží ikona pro spouštění bez lišt prohlížeče!</p>
            </div>

        </div>
    `;
    window.openGlobalUiModal('INSTALACE PRO IPHONE (iOS)', navodIphoneHtml);
};

// =========================================================================
// ⚔️ H2H ENGINE: VÝPOČETNÍ MOZEK POROVNÁNÍ 18 METRIK (FÁZE 1)
// =========================================================================
window.vypocitejH2HData = (souperUid, souperTipyData) => {
    const store = Alpine.store('appState');
    const myUid = window.auth?.currentUser?.uid;
    const leagueName = store?.selectedLeague || '';
    const rozpisData = store?.rozpisData || {};
    const zapasyMapa = rozpisData.zapasyMapa || {};
    const leaderboardData = store?.leaderboardData || {};
    const zebricek = leaderboardData.zebricek || [];

    // Najdeme statistiky v žebříčku
    const mojeStats = zebricek.find(p => p.uid === myUid) || {};
    const souperStats = zebricek.find(p => p.uid === souperUid) || {};

    const mojeTipy = store?.mojeTipy || {};
    const souperTipy = souperTipyData?.mapaTipu || {};

    // Zápasy seřazené chronologicky
    const zapasy = Object.keys(zapasyMapa).map(id => ({ matchId: id, ...zapasyMapa[id] }));
    zapasy.sort((a, b) => {
        const dA = a.datum?.toDate ? a.datum.toDate() : new Date(a.datum || 0);
        const dB = b.datum?.toDate ? b.datum.toDate() : new Date(b.datum || 0);
        return dA - dB;
    });

    const vyhodnoceneZapasy = zapasy.filter(z => z.vysledek_domaci !== undefined && z.vysledek_hoste !== undefined && z.apiStatus !== 'IN_PLAY' && z.apiStatus !== 'PAUSED');

    // 1. FORMA (Posledních 5 vyhodnocených zápasů)
    const poslesnich5 = vyhodnoceneZapasy.slice(-5);
    let mojeFormaBody = 0;
    let souperFormaBody = 0;
    poslesnich5.forEach(z => {
        const mTip = mojeTipy[z.matchId];
        const sTip = souperTipy[z.matchId];
        if (mTip) mojeFormaBody += window.vypocitejBodyZapasu(mTip.tip_domaci, mTip.tip_hoste, z.vysledek_domaci, z.vysledek_hoste, leagueName, mTip.postup, z.postup, z.isPlayoff, z.isTopMatch);
        else {
            const pravidla = window.PRAVIDLA_LIG?.[leagueName] || window.PRAVIDLA_LIG?.["DEFAULT"];
            mojeFormaBody += pravidla?.penaltyNenatipovano || 0;
        }
        if (sTip) souperFormaBody += window.vypocitejBodyZapasu(sTip.tip_domaci, sTip.tip_hoste, z.vysledek_domaci, z.vysledek_hoste, leagueName, sTip.postup, z.postup, z.isPlayoff, z.isTopMatch);
        else {
            const pravidla = window.PRAVIDLA_LIG?.[leagueName] || window.PRAVIDLA_LIG?.["DEFAULT"];
            souperFormaBody += pravidla?.penaltyNenatipovano || 0;
        }
    });

    // 2. VZÁJEMNÉ SKÓRE PO KOLECH
    const kolaMapa = {};
    vyhodnoceneZapasy.forEach(z => {
        const k = window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff) || '1. Kolo';
        if (!kolaMapa[k]) kolaMapa[k] = [];
        kolaMapa[k].push(z);
    });

    let mojeVyhranaKola = 0;
    let souperVyhranaKola = 0;
    let remizovaKola = 0;

    Object.keys(kolaMapa).forEach(koloKey => {
        let mPts = 0;
        let sPts = 0;
        kolaMapa[koloKey].forEach(z => {
            const mTip = mojeTipy[z.matchId];
            const sTip = souperTipy[z.matchId];
            if (mTip) mPts += window.vypocitejBodyZapasu(mTip.tip_domaci, mTip.tip_hoste, z.vysledek_domaci, z.vysledek_hoste, leagueName, mTip.postup, z.postup, z.isPlayoff, z.isTopMatch);
            else { const prav = window.PRAVIDLA_LIG?.[leagueName] || window.PRAVIDLA_LIG?.["DEFAULT"]; mPts += prav?.penaltyNenatipovano || 0; }
            
            if (sTip) sPts += window.vypocitejBodyZapasu(sTip.tip_domaci, sTip.tip_hoste, z.vysledek_domaci, z.vysledek_hoste, leagueName, sTip.postup, z.postup, z.isPlayoff, z.isTopMatch);
            else { const prav = window.PRAVIDLA_LIG?.[leagueName] || window.PRAVIDLA_LIG?.["DEFAULT"]; sPts += prav?.penaltyNenatipovano || 0; }
        });

        if (mPts > sPts) mojeVyhranaKola++;
        else if (sPts > mPts) souperVyhranaKola++;
        else remizovaKola++;
    });

    // 3. SHODNÉ VS OPAČNÉ TIPY (ŠPIONÁŽ)
    const zrcadloTipy = [];  // 100% shodné skóre
    const spojenciTipy = []; // Stejná tendence, jiné skóre
    const opacneTipy = [];   // Přímé duely (opačná tendence)

    zapasy.forEach(z => {
        const mTip = mojeTipy[z.matchId];
        const sTip = souperTipy[z.matchId];
        if (!mTip || !sTip) return;

        const mD = parseInt(mTip.tip_domaci);
        const mH = parseInt(mTip.tip_hoste);
        const sD = parseInt(sTip.tip_domaci);
        const sH = parseInt(sTip.tip_hoste);
        if (isNaN(mD) || isNaN(mH) || isNaN(sD) || isNaN(sH)) return;

        const itemDetail = {
            matchId: z.matchId,
            title: `${z.domaci} vs. ${z.hoste}`,
            realResult: (z.vysledek_domaci !== undefined && z.vysledek_hoste !== undefined) ? `${z.vysledek_domaci}:${z.vysledek_hoste}` : 'Čeká',
            mojeTipStr: `${mD}:${mH}${mTip.postup ? ' (' + mTip.postup + ')' : ''}`,
            souperTipStr: `${sD}:${sH}${sTip.postup ? ' (' + sTip.postup + ')' : ''}`
        };

        const meSameScore = (mD === sD && mH === sH && (!z.isPlayoff || mTip.postup === sTip.postup));
        const mTend = (mD > mH) ? 1 : (mD < mH ? 2 : 0);
        const sTend = (sD > sH) ? 1 : (sD < sH ? 2 : 0);

        if (meSameScore) {
            zrcadloTipy.push(itemDetail);
        } else if (mTend === sTend) {
            spojenciTipy.push(itemDetail);
        } else {
            opacneTipy.push(itemDetail);
        }
    });

    // 4. PRŮMĚR GÓLŮ V TIPU
    let mojeGolySoucet = 0; let mojeGolyPocet = 0;
    Object.values(mojeTipy).forEach(t => {
        const d = parseInt(t.tip_domaci); const h = parseInt(t.tip_hoste);
        if (!isNaN(d) && !isNaN(h)) { mojeGolySoucet += (d + h); mojeGolyPocet++; }
    });
    const mojePrumerGolu = mojeGolyPocet > 0 ? (mojeGolySoucet / mojeGolyPocet).toFixed(2) : '0.00';

    let souperGolySoucet = 0; let souperGolyPocet = 0;
    Object.values(souperTipy).forEach(t => {
        const d = parseInt(t.tip_domaci); const h = parseInt(t.tip_hoste);
        if (!isNaN(d) && !isNaN(h)) { souperGolySoucet += (d + h); souperGolyPocet++; }
    });
    const souperPrumerGolu = souperGolyPocet > 0 ? (souperGolySoucet / souperGolyPocet).toFixed(2) : '0.00';

    // 5. PRŮMĚR BODŮ NA ZÁPAS
    const mojePocetVyhodnocenych = (mojeStats.natipovaneVyhodnocene || 0) + (mojeStats.nenatipovaneVyhodnocene || 0);
    const mojePrumerBodu = mojePocetVyhodnocenych > 0 ? (mojeStats.celkemBodu / mojePocetVyhodnocenych).toFixed(2) : '0.00';

    const souperPocetVyhodnocenych = (souperStats.natipovaneVyhodnocene || 0) + (souperStats.nenatipovaneVyhodnocene || 0);
    const souperPrumerBodu = souperPocetVyhodnocenych > 0 ? (souperStats.celkemBodu / souperPocetVyhodnocenych).toFixed(2) : '0.00';

    const isLeagueStarted = Alpine.store('appState')?.isLeagueStarted || vyhodnoceneZapasy.length > 0 || zapasy.some(z => {
        const startMs = Date.parse(z.datum);
        return (!isNaN(startMs) && startMs <= Date.now()) || z.vysledek_domaci !== undefined || z.apiStatus === "IN_PLAY" || z.apiStatus === "PAUSED" || z.apiStatus === "FINISHED";
    });

    return {
        mojeNickname: mojeStats.nickname || 'Ty',
        souperNickname: souperStats.nickname || 'Soupeř',
        isLeagueStarted: isLeagueStarted,
        // 🥇 1. Hlavní souboj
        celkemBodu: { ja: mojeStats.celkemBodu || 0, on: souperStats.celkemBodu || 0 },
        forma: { ja: mojeFormaBody, on: souperFormaBody },
        efektivita: { ja: Number(mojeStats.efektivitaProcento || 0).toFixed(1), on: Number(souperStats.efektivitaProcento || 0).toFixed(1) },
        prumerBodu: { ja: mojePrumerBodu, on: souperPrumerBodu },
        // 🥊 2. Vzájemné zápasy
        vzajemnaKola: { ja: mojeVyhranaKola, on: souperVyhranaKola, remizy: remizovaKola },
        hracKola: { ja: mojeStats.vyhranaKolaCount || 0, on: souperStats.vyhranaKolaCount || 0 },
        maxBoduVKole: { ja: mojeStats.nejviceBoduVKole || 0, on: souperStats.nejviceBoduVKole || 0 },
        perfektniKola: { ja: mojeStats.perfektniKolaCount || 0, on: souperStats.perfektniKolaCount || 0 },
        // 🎯 3. Preciznost a střelba
        presneVysledky: { ja: mojeStats.presneVysledkyCount || 0, on: souperStats.presneVysledkyCount || 0 },
        presneTopMatches: { ja: mojeStats.presneTopMatchesCount || 0, on: souperStats.presneTopMatchesCount || 0 },
        spravneTendence: { ja: mojeStats.spravneTendenceCount || 0, on: souperStats.spravneTendenceCount || 0 },
        nenatipovane: { ja: mojeStats.nenatipovaneVyhodnocene || 0, on: souperStats.nenatipovaneVyhodnocene || 0 },
        // 🕵️‍♂️ 4. Přímý duel a špionáž
        opacneTipy: { pocet: opacneTipy.length, seznam: opacneTipy },
        spojenciTipy: { pocet: spojenciTipy.length, seznam: spojenciTipy },
        zrcadloTipy: { pocet: zrcadloTipy.length, seznam: zrcadloTipy },
        // 🎁 5. Dlouhodobé tipy
        vitez: { ja: mojeStats.vitezMs || '–', on: souperStats.vitezMs || '–' },
        strelec: { ja: mojeStats.nejStrelec || '–', on: souperStats.nejStrelec || '–' },
        // 🎨 6. Fun & styl
        prumerGolu: { ja: mojePrumerGolu, on: souperPrumerGolu }
    };
};

// =========================================================================
// ⚔️ H2H ENGINE: SPÁRKOVÁNÍ MODÁLU A VYKRESLOVAČ 18 METRIK (FÁZE 3)
// =========================================================================
window.showH2HModal = async (souperUid) => {
    const store = Alpine.store('appState');
    const leagueName = store?.selectedLeague;
    if (!souperUid || !leagueName) return;

    window.tipniToCache = window.tipniToCache || { histories: {}, spy: {} };
    let souperTipyData;

    if (window.tipniToCache.histories[souperUid]) {
        souperTipyData = window.tipniToCache.histories[souperUid];
    } else {
        window.showToast("⏳ Stahuji data soupeře pro souboj...", false);
        try {
            const r2Base = CONFIG.R2_BASE_URL;
            const sezonaId = store?.activeSeason || window.SEZONA_ID || CONFIG.DEFAULT_SEASON;
            const ligaKlic = String(leagueName || '').replace(/ /g, "_");
            const resHistory = await fetch(`${r2Base}/sezony/${sezonaId}/${ligaKlic}/historie_hrace_${souperUid}.json?t=${Date.now()}`);
            if (!resHistory.ok) {
                alert("Soupeř zatím nemá žádné uzavřené tipy k porovnání.");
                return;
            }
            souperTipyData = await resHistory.json();
            window.tipniToCache.histories[souperUid] = souperTipyData;
        } catch (e) {
            console.error(e);
            window.showToast("❌ Selhalo stažení dat soupeře.", true);
            return;
        }
    }

    const data = window.vypocitejH2HData(souperUid, souperTipyData);
    window.renderH2HModalContent(data);
};

window.renderH2HModalContent = (data) => {
    const store = Alpine.store('appState');
    const leagueName = store?.selectedLeague || '';
    const pravidla = (window.PRAVIDLA_LIG || PRAVIDLA_LIG)?.[leagueName] || (window.PRAVIDLA_LIG || PRAVIDLA_LIG)?.["DEFAULT"];
    const showVitez = (pravidla?.bonusVitez || 0) > 0;
    const showStrelec = (pravidla?.bonusStrelec || 0) > 0;

    const getWinnerClass = (valJa, valOn, reverseIsBetter = false) => {
        const numJa = parseFloat(valJa);
        const numOn = parseFloat(valOn);
        if (isNaN(numJa) || isNaN(numOn) || numJa === numOn) return { ja: 'is-tie', on: 'is-tie', crownJa: '', crownOn: '' };
        const jaWins = reverseIsBetter ? numJa < numOn : numJa > numOn;
        return {
            ja: jaWins ? 'is-winner' : '',
            on: jaWins ? '' : 'is-winner is-op-side',
            crownJa: jaWins ? ' 👑' : '',
            crownOn: jaWins ? '' : ' 👑'
        };
    };

    const cBody = getWinnerClass(data.celkemBodu.ja, data.celkemBodu.on);
    const cForma = getWinnerClass(data.forma.ja, data.forma.on);
    const cEfekt = getWinnerClass(data.efektivita.ja, data.efektivita.on);
    const cPrumB = getWinnerClass(data.prumerBodu.ja, data.prumerBodu.on);

    const cVzaj = getWinnerClass(data.vzajemnaKola.ja, data.vzajemnaKola.on);
    const cHracK = getWinnerClass(data.hracKola.ja, data.hracKola.on);
    const cMaxK = getWinnerClass(data.maxBoduVKole.ja, data.maxBoduVKole.on);
    const cPerfK = getWinnerClass(data.perfektniKola.ja, data.perfektniKola.on);

    const cPresne = getWinnerClass(data.presneVysledky.ja, data.presneVysledky.on);
    const cPresneTop = getWinnerClass(data.presneTopMatches.ja, data.presneTopMatches.on);
    const cTend = getWinnerClass(data.spravneTendence.ja, data.spravneTendence.on);
    const cNenat = getWinnerClass(data.nenatipovane.ja, data.nenatipovane.on, true);

    const cGoly = getWinnerClass(data.prumerGolu.ja, data.prumerGolu.on);

    const generateSpyAccordionList = (items) => {
        if (!items || items.length === 0) return '<div class="leaderboard-spy-empty">Žádné zápasy v této kategorii</div>';
        return items.map(item => `
            <div class="h2h-spy-card">
                <div class="h2h-spy-card-header">
                    <span>${item.title}</span>
                    <span style="color: #fbbf24;">Konečný výsledek: ${item.realResult}</span>
                </div>
                <div class="h2h-spy-card-tips">
                    <span class="h2h-spy-my-tip">Ty: ${item.mojeTipStr}</span>
                    <span class="h2h-spy-op-tip">${data.souperNickname}: ${item.souperTipStr}</span>
                </div>
            </div>
        `).join('');
    };

    const vitezRowHtml = showVitez ? `
        <div class="h2h-grid-row">
            <span class="h2h-cell-val" style="font-size:0.8rem; color:#fff;">${data.vitez.ja}</span>
            <span class="h2h-cell-metric">🏆 Celkový vítěz</span>
            <span class="h2h-cell-val" style="font-size:0.8rem; color:#fff;">${data.vitez.on}</span>
        </div>
    ` : '';

    const strelecRowHtml = showStrelec ? `
        <div class="h2h-grid-row">
            <span class="h2h-cell-val" style="font-size:0.8rem; color:#fff;">${data.strelec.ja}</span>
            <span class="h2h-cell-metric">🥇 Král střelců</span>
            <span class="h2h-cell-val" style="font-size:0.8rem; color:#fff;">${data.strelec.on}</span>
        </div>
    ` : '';

    const fullModalHtml = `
        <div class="h2h-arena-wrapper">
            <div class="h2h-sticky-header">
                <div class="h2h-header-card is-my">
                    <span class="h2h-header-nick">${data.mojeNickname}</span>
                    <span class="h2h-header-score">${data.celkemBodu.ja} b.</span>
                </div>
                <div class="h2h-vs-badge">
                    <div class="h2h-vs-circle">VS</div>
                    <span class="h2h-vs-round">H2H DUEL</span>
                </div>
                <div class="h2h-header-card is-op">
                    <span class="h2h-header-nick">${data.souperNickname}</span>
                    <span class="h2h-header-score">${data.celkemBodu.on} b.</span>
                </div>
            </div>

            <div class="spy-modal-body" style="padding: 8px 12px; display: flex; flex-direction: column; gap: 4px;">
                
                <!-- HLAVNÍ SOUBOJ -->
                <div class="h2h-grid-row">
                    <span class="h2h-cell-val ${cBody.ja}">${data.celkemBodu.ja} b.${cBody.crownJa}</span>
                    <span class="h2h-cell-metric">🏆 Celkové body</span>
                    <span class="h2h-cell-val ${cBody.on}">${data.celkemBodu.on} b.${cBody.crownOn}</span>
                </div>
                <div class="h2h-grid-row">
                    <span class="h2h-cell-val ${cForma.ja}">${data.forma.ja} b.${cForma.crownJa}</span>
                    <span class="h2h-cell-metric">🔥 Forma (5 zápasů)</span>
                    <span class="h2h-cell-val ${cForma.on}">${data.forma.on} b.${cForma.crownOn}</span>
                </div>
                <div class="h2h-grid-row">
                    <span class="h2h-cell-val ${cEfekt.ja}">${data.efektivita.ja} %${cEfekt.crownJa}</span>
                    <span class="h2h-cell-metric">📊 Úspěšnost</span>
                    <span class="h2h-cell-val ${cEfekt.on}">${data.efektivita.on} %${cEfekt.crownOn}</span>
                </div>
                <div class="h2h-grid-row">
                    <span class="h2h-cell-val ${cPrumB.ja}">${data.prumerBodu.ja} b.${cPrumB.crownJa}</span>
                    <span class="h2h-cell-metric">📈 Průměr / Zápas</span>
                    <span class="h2h-cell-val ${cPrumB.on}">${data.prumerBodu.on} b.${cPrumB.crownOn}</span>
                </div>

                <!-- VZÁJEMNÉ SROVNÁNÍ KOL -->
                <div class="h2h-grid-row">
                    <span class="h2h-cell-val ${cVzaj.ja}">${data.vzajemnaKola.ja}${cVzaj.crownJa}</span>
                    <span class="h2h-cell-metric">🥊 Vyhraná kola<br><span style="color:#fbbf24; font-size:0.65rem;">(${data.vzajemnaKola.remizy}× remíza)</span></span>
                    <span class="h2h-cell-val ${cVzaj.on}">${data.vzajemnaKola.on}${cVzaj.crownOn}</span>
                </div>
                <div class="h2h-grid-row">
                    <span class="h2h-cell-val ${cHracK.ja}">${data.hracKola.ja}×${cHracK.crownJa}</span>
                    <span class="h2h-cell-metric">👑 Hráč kola</span>
                    <span class="h2h-cell-val ${cHracK.on}">${data.hracKola.on}×${cHracK.crownOn}</span>
                </div>
                <div class="h2h-grid-row">
                    <span class="h2h-cell-val ${cMaxK.ja}">${data.maxBoduVKole.ja} b.${cMaxK.crownJa}</span>
                    <span class="h2h-cell-metric">⚡ Max bodů v kole</span>
                    <span class="h2h-cell-val ${cMaxK.on}">${data.maxBoduVKole.on} b.${cMaxK.crownOn}</span>
                </div>
                <div class="h2h-grid-row">
                    <span class="h2h-cell-val ${cPerfK.ja}">${data.perfektniKola.ja}×${cPerfK.crownJa}</span>
                    <span class="h2h-cell-metric">🏆 Perfektní kola</span>
                    <span class="h2h-cell-val ${cPerfK.on}">${data.perfektniKola.on}×${cPerfK.crownOn}</span>
                </div>

                <!-- PRECIZNOST A STŘELBA -->
                <div class="h2h-grid-row">
                    <span class="h2h-cell-val ${cPresne.ja}">${data.presneVysledky.ja}×${cPresne.crownJa}</span>
                    <span class="h2h-cell-metric">🎯 Přesné výsledky</span>
                    <span class="h2h-cell-val ${cPresne.on}">${data.presneVysledky.on}×${cPresne.crownOn}</span>
                </div>
                <div class="h2h-grid-row">
                    <span class="h2h-cell-val ${cPresneTop.ja}">${data.presneTopMatches.ja}×${cPresneTop.crownJa}</span>
                    <span class="h2h-cell-metric">🔥 Přesné TOP zápasy</span>
                    <span class="h2h-cell-val ${cPresneTop.on}">${data.presneTopMatches.on}×${cPresneTop.crownOn}</span>
                </div>
                <div class="h2h-grid-row">
                    <span class="h2h-cell-val ${cTend.ja}">${data.spravneTendence.ja}×${cTend.crownJa}</span>
                    <span class="h2h-cell-metric">⚽ Trefené tendence</span>
                    <span class="h2h-cell-val ${cTend.on}">${data.spravneTendence.on}×${cTend.crownOn}</span>
                </div>
                <div class="h2h-grid-row">
                    <span class="h2h-cell-val ${cNenat.ja}">${data.nenatipovane.ja}×${cNenat.crownJa}</span>
                    <span class="h2h-cell-metric">❌ Nenatipované</span>
                    <span class="h2h-cell-val ${cNenat.on}">${data.nenatipovane.on}×${cNenat.crownOn}</span>
                </div>

                <!-- PŘÍMÝ DUEL & ŠPIONÁŽ (HARMONIKA) -->
                <div class="h2h-accordion-wrapper">
                    <div class="h2h-accordion-trigger" onclick="const b = this.nextElementSibling; const isH = b.style.display==='none'; b.style.display = isH ? 'flex' : 'none'; this.querySelector('.acc-arr').innerText = isH ? '▲' : '▼';">
                        <span class="h2h-cell-val" style="color:#f87171;">${data.opacneTipy.pocet}×</span>
                        <span class="h2h-cell-metric" style="color:#f87171;">⚔️ Přímé duely (Opačné) <span class="acc-arr">▼</span></span>
                        <span class="h2h-cell-val" style="color:#f87171;">${data.opacneTipy.pocet}×</span>
                    </div>
                    <div class="h2h-accordion-body" style="display: none;">
                        ${generateSpyAccordionList(data.opacneTipy.seznam)}
                    </div>
                </div>

                <div class="h2h-accordion-wrapper">
                    <div class="h2h-accordion-trigger" onclick="const b = this.nextElementSibling; const isH = b.style.display==='none'; b.style.display = isH ? 'flex' : 'none'; this.querySelector('.acc-arr').innerText = isH ? '▲' : '▼';">
                        <span class="h2h-cell-val" style="color:#38bdf8;">${data.spojenciTipy.pocet}×</span>
                        <span class="h2h-cell-metric" style="color:#38bdf8;">🤝 Spojenci (Stejná tend.) <span class="acc-arr">▼</span></span>
                        <span class="h2h-cell-val" style="color:#38bdf8;">${data.spojenciTipy.pocet}×</span>
                    </div>
                    <div class="h2h-accordion-body" style="display: none;">
                        ${generateSpyAccordionList(data.spojenciTipy.seznam)}
                    </div>
                </div>

                <div class="h2h-accordion-wrapper">
                    <div class="h2h-accordion-trigger" onclick="const b = this.nextElementSibling; const isH = b.style.display==='none'; b.style.display = isH ? 'flex' : 'none'; this.querySelector('.acc-arr').innerText = isH ? '▲' : '▼';">
                        <span class="h2h-cell-val" style="color:#fbbf24;">${data.zrcadloTipy.pocet}×</span>
                        <span class="h2h-cell-metric" style="color:#fbbf24;">🪞 Zrcadlo (Shodný tip) <span class="acc-arr">▼</span></span>
                        <span class="h2h-cell-val" style="color:#fbbf24;">${data.zrcadloTipy.pocet}×</span>
                    </div>
                    <div class="h2h-accordion-body" style="display: none;">
                        ${generateSpyAccordionList(data.zrcadloTipy.seznam)}
                    </div>
                </div>

                <!-- DLOUHODOBÉ TIPY (PODMÍNĚNĚ PODLE SOUTĚŽE) -->
                ${vitezRowHtml}
                ${strelecRowHtml}

                <!-- FUN & STYL TIPOVÁNÍ -->
                <div class="h2h-grid-row">
                    <span class="h2h-cell-val" style="color:#38bdf8; font-size: ${data.isLeagueStarted ? '0.9rem' : '0.75rem'};">${data.isLeagueStarted ? (cGoly.ja > cGoly.on ? data.prumerGolu.ja + ' 🔥' : data.prumerGolu.ja) : '🔒 SKRYTO DO STARTU'}</span>
                    <span class="h2h-cell-metric">⚽ Průměr gólů / tip</span>
                    <span class="h2h-cell-val" style="color:#38bdf8; font-size: ${data.isLeagueStarted ? '0.9rem' : '0.75rem'};">${data.isLeagueStarted ? (cGoly.on > cGoly.ja ? data.prumerGolu.on + ' 🔥' : data.prumerGolu.on) : '🔒 SKRYTO DO STARTU'}</span>
                </div>

            </div>
        </div>
    `;

    window.openGlobalUiModal(`⚔️ H2H DUEL: ${data.mojeNickname} vs. ${data.souperNickname}`, fullModalHtml);
};

// =========================================================================
// 🏆 POHÁROVÝ ENGINE: TIPNI CHANCE CUP (ČISTÝ VÝPOČET Z REÁLNÉHO ŽEBŘÍČKU)
// =========================================================================

// 🚀 SPOUŠTĚČ POHÁRU Z MENU
window.openSpecificCup = async (leagueName) => {
    const store = Alpine.store('appState');
    if (store) {
        store.isMenuOpen = false;
        store.selectedLeague = leagueName;
        store.cupActiveTab = 'groups';
    }

    if (typeof window.selectLeague === 'function') {
        await window.selectLeague(leagueName, 'cupScreen');
    } else {
        window.goToScreen('cupScreen');
        window.renderCupScreen(leagueName);
    }
};

// 🐍 HADÍ ALGORITMUS PRO ROZDĚLENÍ HRÁČŮ DO SKUPIN (A, B, C, D)
window.generateSnakeDraft = (sortedPlayers) => {
    const groups = { A: [], B: [], C: [], D: [] };
    const groupKeys = ['A', 'B', 'C', 'D'];

    if (!Array.isArray(sortedPlayers) || sortedPlayers.length === 0) return groups;

    sortedPlayers.forEach((player, index) => {
        const round = Math.floor(index / 4);
        const positionInRound = index % 4;
        const groupIdx = (round % 2 === 0) ? positionInRound : (3 - positionInRound);
        const targetGroupKey = groupKeys[groupIdx];

        groups[targetGroupKey].push({
            ...player,
            originalRank: index + 1
        });
    });

    return groups;
};

// 🌳 SIMULÁTOR KOMPLETNÍHO K.O. PAVOUKA AŽ DO GRAND FINÁLE (NEJNOVĚJŠÍ KOLO NAHOŘE)
window.generateSimulatedPlayoff = (leagueName, groups) => {
    const isPL = leagueName === 'Premier League';

    const simDuel = (p1, p2, title, legCount = 2, isFinal = false) => {
        const pl1 = p1 || { uid: 'bot1', nick: 'Čeká', seed: '-' };
        const pl2 = p2 || { uid: 'bot2', nick: 'Čeká', seed: '-' };

        const score1_1 = Math.floor(Math.random() * 8) + 5;
        const score1_2 = legCount === 2 ? Math.floor(Math.random() * 8) + 4 : 0;
        let total1 = legCount === 2 ? score1_1 + score1_2 : score1_1;

        let score2_1 = Math.floor(Math.random() * 8) + 5;
        let score2_2 = legCount === 2 ? Math.floor(Math.random() * 8) + 4 : 0;
        let total2 = legCount === 2 ? score2_1 + score2_2 : score2_1;

        if (total1 === total2) { total1 += 1; } // Rozhodnutí remízy

        const p1Wins = total1 > total2;
        const winner = p1Wins ? pl1 : pl2;

        return {
            title,
            statusText: isFinal ? '🏆 FINÁLE (1 ZÁPAS)' : '✓ DOKONČENO',
            winnerUid: winner.uid,
            winner: winner,
            p1: { ...pl1, leg1: score1_1, leg2: legCount === 2 ? score1_2 : null, totalPts: total1 },
            p2: { ...pl2, leg1: score2_1, leg2: legCount === 2 ? score2_2 : null, totalPts: total2 }
        };
    };

    if (isPL) {
        // 🏴󠁧󠁢󠁥󠁮󠁧󠁿 PREMIER CUP: 6 PATER SCHODOVÉ PYRAMIDY
        const gA = groups.A || [];
        const gB = groups.B || [];
        const gC = groups.C || [];
        const gD = groups.D || [];

        // 1. Předkolo (4. vs 5. místa ze skupin)
        const d1_1 = simDuel(gA[3], gB[4], '1. Předkolo • Duel 1 (A4 vs B5)');
        const d1_2 = simDuel(gB[3], gA[4], '1. Předkolo • Duel 2 (B4 vs A5)');
        const d1_3 = simDuel(gC[3], gD[4], '1. Předkolo • Duel 3 (C4 vs D5)');
        const d1_4 = simDuel(gD[3], gC[4], '1. Předkolo • Duel 4 (D4 vs C5)');

        // 2. Předkolo (3. místa vs vítězové 1. předkola)
        const d2_1 = simDuel(gC[2], d1_1.winner, '2. Předkolo • Duel 1 (C3 vs W1)');
        const d2_2 = simDuel(gD[2], d1_2.winner, '2. Předkolo • Duel 2 (D3 vs W2)');
        const d2_3 = simDuel(gA[2], d1_3.winner, '2. Předkolo • Duel 3 (A3 vs W3)');
        const d2_4 = simDuel(gB[2], d1_4.winner, '2. Předkolo • Duel 4 (B3 vs W4)');

        // Osmifinále (2. místa vs vítězové 2. předkola)
        const dOF_1 = simDuel(gA[1], d2_1.winner, 'Osmifinále • Duel 1 (A2 vs W1)');
        const dOF_2 = simDuel(gB[1], d2_2.winner, 'Osmifinále • Duel 2 (B2 vs W2)');
        const dOF_3 = simDuel(gC[1], d2_3.winner, 'Osmifinále • Duel 3 (C2 vs W3)');
        const dOF_4 = simDuel(gD[1], d2_4.winner, 'Osmifinále • Duel 4 (D2 vs W4)');

        // Čtvrtfinále (1. místa / vítězové skupin vs vítězové osmifinále)
        const dQF_1 = simDuel(gA[0], dOF_1.winner, 'Čtvrtfinále • Duel 1 (A1 vs W1)');
        const dQF_2 = simDuel(gB[0], dOF_2.winner, 'Čtvrtfinále • Duel 2 (B1 vs W2)');
        const dQF_3 = simDuel(gC[0], dOF_3.winner, 'Čtvrtfinále • Duel 3 (C1 vs W3)');
        const dQF_4 = simDuel(gD[0], dOF_4.winner, 'Čtvrtfinále • Duel 4 (D1 vs W4)');

        // Semifinále (TOP 4)
        const dSF_1 = simDuel(dQF_1.winner, dQF_2.winner, 'Semifinále • Duel 1');
        const dSF_2 = simDuel(dQF_3.winner, dQF_4.winner, 'Semifinále • Duel 2');

        // Grand Finále (1 rozhodující zápas)
        const dFinal = simDuel(dSF_1.winner, dSF_2.winner, 'Grand Finále', 1, true);

        return [
            { name: '🏆 GRAND FINÁLE (32. KOLO)', info: 'Finálový duel • 1 zápas (ALL-IN)', duels: [dFinal] },
            { name: '🔥 SEMIFINÁLE (29. & 30. KOLO)', info: '2 duely na součet 2 kol', duels: [dSF_1, dSF_2] },
            { name: '👑 ČTVRTFINÁLE (27. & 28. KOLO)', info: '4 duely • Nástup vítězů skupin', duels: [dQF_1, dQF_2, dQF_3, dQF_4] },
            { name: '🏆 OSMIFINÁLE (25. & 26. KOLO)', info: '4 duely • Nástup 2. míst', duels: [dOF_1, dOF_2, dOF_3, dOF_4] },
            { name: '⚔️ 2. PŘEDKOLO (23. & 24. KOLO)', info: '4 duely • Nástup 3. míst', duels: [d2_1, d2_2, d2_3, d2_4] },
            { name: '🥊 1. PŘEDKOLO (21. & 22. KOLO)', info: '4 duely • 4. vs. 5. místa ze skupin', duels: [d1_1, d1_2, d1_3, d1_4] }
        ];
    } else {
        // 🇨🇿 CHANCE CUP: 26 HRÁČŮ
        const allPlayers = [...(groups.A || []), ...(groups.B || []), ...(groups.C || []), ...(groups.D || [])];
        allPlayers.sort((a, b) => (b.pts || 0) - (a.pts || 0) || a.seed - b.seed);

        const top6 = allPlayers.slice(0, 6);
        const predkoloPl = allPlayers.slice(6, 26);

        const pkDuels = [];
        for (let i = 0; i < 10; i++) {
            pkDuels.push(simDuel(predkoloPl[i], predkoloPl[19 - i], `Předkolo • Duel ${i + 1}`));
        }

        const pkWinners = pkDuels.map(d => d.winner);
        const ofPlayers = [...top6, ...pkWinners];
        const ofDuels = [];
        for (let i = 0; i < 8; i++) {
            ofDuels.push(simDuel(ofPlayers[i], ofPlayers[15 - i], `Osmifinále • Duel ${i + 1}`));
        }

        const ofWinners = ofDuels.map(d => d.winner);
        const qfDuels = [];
        for (let i = 0; i < 4; i++) {
            qfDuels.push(simDuel(ofWinners[i], ofWinners[7 - i], `Čtvrtfinále • Duel ${i + 1}`));
        }

        const qfWinners = qfDuels.map(d => d.winner);
        const sf1 = simDuel(qfWinners[0], qfWinners[1], 'Semifinále • Duel 1');
        const sf2 = simDuel(qfWinners[2], qfWinners[3], 'Semifinále • Duel 2');

        const finalDuel = simDuel(sf1.winner, sf2.winner, 'Grand Finále', 1, true);

        return [
            { name: '👑 GRAND FINÁLE (27. KOLO)', info: 'Finálový duel • 1 zápas', duels: [finalDuel] },
            { name: '🔥 SEMIFINÁLE (25. & 26. KOLO)', info: '2 duely na součet 2 kol', duels: [sf1, sf2] },
            { name: '⚔️ ČTVRTFINÁLE (23. & 24. KOLO)', info: '4 duely na součet 2 kol', duels: qfDuels },
            { name: '🏆 OSMIFINÁLE (21. & 22. KOLO)', info: '8 duelů • Nástup TOP 6', duels: ofDuels },
            { name: '🥊 PŘEDKOLO (19. & 20. KOLO)', info: '10 duelů na součet 2 kol', duels: pkDuels }
        ];
    }
};

// 🎨 VYKRESLOVAČ 3 PODZÁLOŽEK POHÁRU (SKUPINY / K.O. PAVOUK / PRAVIDLA)
window.renderCupScreen = async (overrideLeague) => {
    const container = document.getElementById('cupScreenContent');
    const titleEl = document.getElementById('cupMainTitle');
    if (!container) return;

    const store = Alpine.store('appState');
    const myUid = window.auth?.currentUser?.uid || store?.userUid;
    const leagueName = overrideLeague || store?.selectedLeague || 'Chance Liga';
    const activeTab = store?.cupActiveTab || 'groups';
    
    const isPL = leagueName === 'Premier League';
    const cupTitle = isPL ? 'TIPNI PREMIER CUP' : 'TIPNI CHANCE CUP';

    // 🎯 Automatický záznam prostudované záložky v Premier Cupu
    if (isPL && typeof window.trackPremierCupTab === 'function') {
        window.trackPremierCupTab(activeTab);
    }

    if (titleEl) {
        titleEl.innerHTML = `
            <svg class="micro-tile-cup-svg" viewBox="0 0 24 24" style="width: 22px; height: 22px;">
                <defs>
                    <linearGradient id="silverGradCupHeader" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#ffffff"/>
                        <stop offset="40%" stop-color="#cbd5e1"/>
                        <stop offset="70%" stop-color="#94a3b8"/>
                        <stop offset="100%" stop-color="#475569"/>
                    </linearGradient>
                </defs>
                <path fill="url(#silverGradCupHeader)" d="M20.25 3H3.75C3.34 3 3 3.34 3 3.75V6c0 2.89 1.96 5.34 4.67 5.9.75 1.66 2.2 2.92 3.95 3.32V18H8.5c-.28 0-.5.22-.5.5v2c0 .28.22.5.5.5h7c.28 0 .5-.22.5-.5v-2c0-.28-.22-.5-.5-.5h-3.12v-2.78c1.75-.4 3.2-1.66 3.95-3.32 2.71-.56 4.67-3.01 4.67-5.9V3.75c0-.41-.34-.75-.75-.75zM5 6V5h2.13v3.87C5.9 8.27 5 6.99 5 6zm14 0c0 .99-.9 2.27-2.13 2.87V5H19v1z"/>
            </svg>
            <span>${cupTitle}</span>
        `;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 📋 PODZÁLOŽKA 1: DETAILNÍ A OFICIÁLNÍ PRAVIDLA POHÁRU
    // ─────────────────────────────────────────────────────────────────────
    if (activeTab === 'rules') {
        if (isPL) {
            container.innerHTML = `
                <div class="cup-wrapper">
                    <div class="cup-rules-card" style="display: flex; flex-direction: column; gap: 14px;">
                        <div style="background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 8px; padding: 12px;">
                            <h4 style="color: #38bdf8; margin: 0 0 6px 0; font-size: 0.9rem; display: flex; align-items: center; gap: 6px;">
                                <span>💡</span> JAK POHÁR FUNGUJE V PRAXI
                            </h4>
                            <p style="font-size: 0.82rem; color: #cbd5e1; line-height: 1.5; margin: 0;">
                                <strong>Netipují se žádné zápasy navíc!</strong> Do poháru se automaticky propisují body z tvých běžných ligových tipů Premier League. Tipuješ přesně tak, jak jsi zvyklý, a systém tvé body paralelně převádí do pohárových skupin a vyřazovacích duelů.
                            </p>
                        </div>

                        <div class="cup-rules-section">
                            <span class="cup-rules-title" style="color: #fbbf24;">1. Harmonogram & Schodová pyramida (1.–32. kolo)</span>
                            <p class="cup-rules-text">
                                • <strong>1.–9. kolo:</strong> Kvalifikace (Ligová tabulka po 9. kole určí nasazení Hadím draftem 1–20).<br>
                                • <strong>10.–19. kolo:</strong> Základní skupiny na 10 kol (4 skupiny po 5 hráčích).<br>
                                • <strong>20. kolo:</strong> ⏸️ Pohárová pauza po skupinách.<br>
                                • <strong>21. & 22. kolo:</strong> 🥊 1. Předkolo (4. vs. 5. místa).<br>
                                • <strong>23. & 24. kolo:</strong> ⚔️ 2. Předkolo (Nástup 3. míst).<br>
                                • <strong>25. & 26. kolo:</strong> 🏆 Osmifinále (Nástup 2. míst).<br>
                                • <strong>27. & 28. kolo:</strong> 👑 Čtvrtfinále (Nástup vítězů skupin).<br>
                                • <strong>29. & 30. kolo:</strong> 🔥 Semifinále (TOP 4 hráči).<br>
                                • <strong>31. kolo:</strong> ⏸️ Předfinálová pauza.<br>
                                • <strong>32. kolo:</strong> 🏆 <strong>Grand Finále</strong> na 1 rozhodující zápas (ALL-IN).
                            </p>
                        </div>

                        <div class="cup-rules-section">
                            <span class="cup-rules-title" style="color: #38bdf8;">2. Rovnost bodů v základních skupinách (10.–19. kolo)</span>
                            <p class="cup-rules-text">
                                Pokud mají dva nebo více hráčů po 19. kole stejný počet bodů, rozhoduje:<br>
                                1. Vyšší počet bodů získaných v základní skupině (10.–19. kolo).<br>
                                2. Vyšší celkový počet bodů v hlavní ligové tabulce Premier League po 19. kole.<br>
                                3. Vyšší počet <strong>přesných výsledků</strong> v hlavní lize po 19. kole.<br>
                                4. Vyšší počet <strong>přesných TOP zápasů</strong> v hlavní lize po 19. kole.<br>
                                5. Vyšší počet <strong>správných tendencí (1, X, 2)</strong> v hlavní lize po 19. kole.<br>
                                6. Vyšší počet <strong>gólů útěchy</strong> v hlavní lize po 19. kole.<br>
                                7. Lepší <strong>nasazení (Seed 1–20)</strong> z tabulky po 9. kole.
                            </p>
                        </div>

                        <div class="cup-rules-section">
                            <span class="cup-rules-title" style="color: #f97316;">3. Rovnost bodů v Play-off dvouzápasech (21.–30. kolo)</span>
                            <p class="cup-rules-text">
                                Pokud vyřazovací duel po sečtení obou kol skončí remízou, o postupu rozhoduje:<br>
                                1. Vyšší součet <strong>přesných výsledků</strong> ze 2 kol daného duelu.<br>
                                2. Vyšší součet <strong>přesných TOP zápasů</strong> ze 2 kol daného duelu.<br>
                                3. Vyšší součet <strong>správných tendencí (1, X, 2)</strong> ze 2 kol daného duelu.<br>
                                4. Vyšší součet <strong>gólů útěchy</strong> ze 2 kol daného duelu.<br>
                                5. Lepší <strong>Pohárový seed (1–20)</strong> po ukončení základních skupin.
                            </p>
                        </div>

                        <div class="cup-rules-section">
                            <span class="cup-rules-title" style="color: #f43f5e;">4. Rovnost bodů v Grand Finále (32. kolo – 1 zápas)</span>
                            <p class="cup-rules-text">
                                Pokud finálová bitva skončí nerozhodně, Pohár získává hráč s:<br>
                                1. Vyšším počtem <strong>přesných výsledků</strong> ve 32. kole.<br>
                                2. Trefeným <strong>přesným výsledkem finálového TOP zápasu</strong> 32. kola.<br>
                                3. Vyšším počtem <strong>správných tendencí (1, X, 2)</strong> ve 32. kole.<br>
                                4. Vyšším počtem <strong>gólů útěchy</strong> ve 32. kole.<br>
                                5. Lepším <strong>Pohárovým seedem (1–20)</strong> ze základních skupin.
                            </p>
                        </div>

                        <div class="cup-rules-section">
                            <span class="cup-rules-title" style="color: #c084fc;">5. Pravidlo pro odložené ligové zápasy</span>
                            <p class="cup-rules-text">
                                • Pokud se odložený ligový zápas dohraje <strong>do oficiálního výkopu následujícího pohárového kola</strong>, body se do Poháru normálně započítají.<br>
                                • Pokud je zápas odložen na pozdější termín, dané pohárové kolo se vyhodnotí bez něj (<strong>neuplatňuje se penalizace -1 b.</strong>).
                            </p>
                        </div>
                    </div>
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="cup-wrapper">
                    <div class="cup-rules-card" style="display: flex; flex-direction: column; gap: 14px;">
                        <div style="background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 8px; padding: 12px;">
                            <h4 style="color: #38bdf8; margin: 0 0 6px 0; font-size: 0.9rem; display: flex; align-items: center; gap: 6px;">
                                <span>💡</span> JAK POHÁR FUNGUJE V PRAXI
                            </h4>
                            <p style="font-size: 0.82rem; color: #cbd5e1; line-height: 1.5; margin: 0;">
                                <strong>Netipují se žádné zápasy navíc!</strong> Do poháru se automaticky propisují body z tvých běžných ligových tipů Chance Ligy. Tipuješ přesně tak, jak jsi zvyklý, a systém tvé body paralelně převádí do pohárových skupin a vyřazovacích duelů.
                            </p>
                        </div>

                        <div class="cup-rules-section">
                            <span class="cup-rules-title" style="color: #fbbf24;">1. Harmonogram & Formát turnaje (27 kol)</span>
                            <p class="cup-rules-text">
                                • <strong>1.–11. kolo:</strong> Kvalifikace (Ligová tabulka po 11. kole určí nasazení Hadím draftem 1–26).<br>
                                • <strong>12.–18. kolo:</strong> Základní skupiny na 7 kol (4 skupiny: A, B, C, D).<br>
                                • <strong>19.–26. kolo:</strong> Jarní Play-off na <strong>2 zápasy (součet bodů)</strong>.<br>
                                • <strong>27. kolo:</strong> 🏆 <strong>Grand Finále</strong> na 1 jediný finálový zápas.
                            </p>
                        </div>

                        <div class="cup-rules-section">
                            <span class="cup-rules-title" style="color: #34d399;">2. Přímý postup do TOP 6 (Volný los v Předkole)</span>
                            <p class="cup-rules-text">
                                Prvních <strong>6 nejlepších hráčů</strong> po odehrání základních skupin postupuje přímo do Osmifinále:<br>
                                • <strong>4 vítězové</strong> základních skupin A, B, C, D.<br>
                                • <strong>2 nejlepší hráči</strong> ze souboje 2. míst napříč všemi skupinami.<br>
                                • <em>Zbylých 20 hráčů hraje v 19. & 20. kole jarní Předkolo na odvety.</em>
                            </p>
                        </div>

                        <div class="cup-rules-section">
                            <span class="cup-rules-title" style="color: #38bdf8;">3. Rovnost bodů ve Skupinách a v tabulce 2. míst (12.–18. kolo)</span>
                            <p class="cup-rules-text">
                                Pokud mají dva nebo více hráčů po 18. kole stejný počet bodů, rozhoduje:<br>
                                1. Vyšší počet bodů získaných v základní skupině (12.–18. kolo).<br>
                                2. Vyšší celkový počet bodů v hlavní ligové tabulce Chance Ligy po 18. kole.<br>
                                3. Vyšší počet <strong>přesných výsledků</strong> v hlavní lize po 18. kole.<br>
                                4. Vyšší počet <strong>přesných TOP zápasů</strong> v hlavní lize po 18. kole.<br>
                                5. Vyšší počet <strong>správných tendencí (1, X, 2)</strong> v hlavní lize po 18. kole.<br>
                                6. Lepší <strong>nasazení (Seed 1–26)</strong> z tabulky po 11. kole.
                            </p>
                        </div>

                        <div class="cup-rules-section">
                            <span class="cup-rules-title" style="color: #f97316;">4. Rovnost bodů v Play-off dvouzápasech (19.–26. kolo)</span>
                            <p class="cup-rules-text">
                                Pokud souboj po sečtení obou kol skončí remízou, postupuje hráč s:<br>
                                1. Vyšším součtem <strong>přesných výsledků</strong> ze 2 kol daného duelu.<br>
                                2. Vyšším součtem <strong>přesných TOP zápasů</strong> ze 2 kol daného duelu.<br>
                                3. Vyšším součtem <strong>správných tendencí (1, X, 2)</strong> ze 2 kol daného duelu.<br>
                                4. Lepším <strong>Pohárovým seedem (1–26)</strong> ze základních skupin.
                            </p>
                        </div>

                        <div class="cup-rules-section">
                            <span class="cup-rules-title" style="color: #f43f5e;">5. Rovnost bodů v Grand Finále (27. kolo)</span>
                            <p class="cup-rules-text">
                                Finále se hraje na 1 kolo. Při remíze Pohár vyhrává hráč s:<br>
                                1. Vyšším počtem <strong>přesných výsledků</strong> ve 27. kole.<br>
                                2. Trefeným <strong>přesným výsledkem finálového TOP zápasu</strong> 27. kola.<br>
                                3. Vyšším počtem <strong>správných tendencí (1, X, 2)</strong> ve 27. kole.<br>
                                4. Lepším <strong>Pohárovým seedem (1–26)</strong> ze základních skupin po 18. kole.
                            </p>
                        </div>

                        <div class="cup-rules-section">
                            <span class="cup-rules-title" style="color: #c084fc;">6. Pravidlo pro odložené ligové zápasy</span>
                            <p class="cup-rules-text">
                                • Pokud se odložený ligový zápas dohraje <strong>do oficiálního výkopu následujícího pohárového kola</strong>, body se do Poháru započítají.<br>
                                • Pokud je zápas odložen na později, kolo se vyhodnotí bez něj (<strong>neuplatňuje se penalizace -1 b.</strong>).
                            </p>
                        </div>
                    </div>
                </div>
            `;
        }
        return;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🧠 DETEKCE STAVU: SIMULACE NEBO REÁLNÝ BOT (ŽIVÝ ZDROJ PRAVDY)
    // ─────────────────────────────────────────────────────────────────────
    const simMode = store?.cupSimMode || null;
    const serverCupData = store?.cupData?.[leagueName] || window.tipniCupData?.[leagueName];

    const isLocked = simMode === 'GROUPS_LOCKED' || simMode === 'PLAYOFF' || (serverCupData && (serverCupData.status === 'GROUPS_LOCKED' || serverCupData.status === 'PLAYOFF'));
    const isPlayoff = simMode === 'PLAYOFF' || (serverCupData && serverCupData.status === 'PLAYOFF');

    let rawLeaderboard = store?.leaderboardData?.zebricek || store?.leaderboardData?.zebricekLive || [];
    if (rawLeaderboard.length === 0) {
        container.innerHTML = `
            <div class="cup-wrapper" style="text-align: center; padding: 40px 10px;">
                <div style="font-size: 2rem; margin-bottom: 10px;">⏳</div>
                <div style="color: #94a3b8; font-size: 0.9rem;">Načítám tabulku pro ${cupTitle}...</div>
            </div>
        `;
        return;
    }

    const sortedLeaderboard = [...rawLeaderboard].sort((a, b) => Number(b.celkemBodu || 0) - Number(a.celkemBodu || 0));
    const baseDraft = window.generateSnakeDraft(sortedLeaderboard);

    let groups = { A: [], B: [], C: [], D: [] };
    let secondPlacesRank = [];

    // ─────────────────────────────────────────────────────────────────────
    // 👥 PODZÁLOŽKA: ZÁKLADNÍ SKUPINY
    // ─────────────────────────────────────────────────────────────────────
    if (isLocked) {
        ['A', 'B', 'C', 'D'].forEach(k => {
            groups[k] = baseDraft[k].map((p) => {
                const realServerPts = serverCupData?.groups?.[k]?.find(sp => sp.uid === p.uid)?.pts;
                const displayPts = (realServerPts !== undefined && realServerPts > 0) ? realServerPts : (p.celkemBodu || 0);

                return {
                    uid: p.uid,
                    nick: p.nickname || p.nick || 'Hráč',
                    seed: p.originalRank,
                    pts: displayPts,
                    originalRank: p.originalRank
                };
            });
            groups[k].sort((a, b) => b.pts - a.pts || a.seed - b.seed);
        });

        if (!isPL) {
            const secondPlaces = ['A', 'B', 'C', 'D'].map(k => ({
                ...groups[k][1],
                group: k
            }));
            secondPlaces.sort((a, b) => b.pts - a.pts || a.seed - b.seed);

            secondPlacesRank = secondPlaces.map((sp, idx) => ({
                ...sp,
                rank: idx + 1,
                qualifiedToTop6: idx < 2
            }));
        }
    } else {
        ['A', 'B', 'C', 'D'].forEach(k => {
            groups[k] = baseDraft[k].map(p => ({
                uid: p.uid,
                nick: p.nickname || p.nick || 'Hráč',
                seed: p.originalRank,
                pts: p.celkemBodu !== undefined ? p.celkemBodu : 0,
                originalRank: p.originalRank
            }));
            groups[k].sort((a, b) => a.originalRank - b.originalRank);
        });

        if (!isPL) {
            const secondPlaces = ['A', 'B', 'C', 'D'].map(k => ({
                ...groups[k][1],
                group: k
            }));
            secondPlaces.sort((a, b) => b.pts - a.pts || a.seed - b.seed);

            secondPlacesRank = secondPlaces.map((sp, idx) => ({
                ...sp,
                rank: idx + 1,
                qualifiedToTop6: idx < 2
            }));
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🌳 PODZÁLOŽKA 2: K.O. PAVOUK
    // ─────────────────────────────────────────────────────────────────────
    if (activeTab === 'bracket') {
        if (!isPlayoff) {
            if (isPL) {
                container.innerHTML = `
                    <div class="cup-wrapper">
                        <div class="cup-preview-badge">
                            <span>🌳</span>
                            <span>SCHODOVÁ PYRAMIDA PLAY-OFF (Start od 21. kola)</span>
                        </div>
                        <div class="cup-bracket-tree">
                            <div class="cup-stage-box">
                                <div class="cup-stage-header">
                                    <span>🥊 1. PŘEDKOLO (21. & 22. KOLO)</span>
                                    <span>4. vs. 5. místa ze skupin</span>
                                </div>
                                <div class="cup-match-slot"><span>4 duely (8 hráčů) na 2 kola</span></div>
                            </div>
                            <div class="cup-stage-box">
                                <div class="cup-stage-header" style="color: #38bdf8;">
                                    <span>⚔️ 2. PŘEDKOLO (23. & 24. KOLO)</span>
                                    <span>Nástup 3. míst</span>
                                </div>
                                <div class="cup-match-slot"><span>4 duely (8 hráčů) na 2 kola</span></div>
                            </div>
                            <div class="cup-stage-box">
                                <div class="cup-stage-header" style="color: #34d399;">
                                    <span>🏆 OSMIFINÁLE (25. & 26. KOLO)</span>
                                    <span>Nástup 2. míst</span>
                                </div>
                                <div class="cup-match-slot"><span>4 duely (8 hráčů) na 2 kola</span></div>
                            </div>
                            <div class="cup-stage-box">
                                <div class="cup-stage-header" style="color: #fbbf24;">
                                    <span>👑 ČTVRTFINÁLE (27. & 28. KOLO)</span>
                                    <span>Nástup vítězů skupin (TOP 8)</span>
                                </div>
                                <div class="cup-match-slot"><span>4 duely (8 hráčů) na 2 kola</span></div>
                            </div>
                            <div class="cup-stage-box" style="border-color: rgba(251, 191, 36, 0.3); background: rgba(251, 191, 36, 0.03);">
                                <div class="cup-stage-header" style="color: #fbbf24;">
                                    <span>🏆 GRAND FINÁLE (32. KOLO)</span>
                                    <span style="color: #fbbf24; font-weight: 800;">1 ZÁPAS (ALL-IN)</span>
                                </div>
                                <div class="cup-match-slot" style="justify-content: center; color: #fbbf24; font-weight: bold;">
                                    🥇 Finálová bitva o Pohár ve 32. kole!
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                container.innerHTML = `
                    <div class="cup-wrapper">
                        <div class="cup-preview-badge">
                            <span>🌳</span>
                            <span>JARNÍ VYŘAZOVACÍ PAVOUK (Start od 19. kola)</span>
                        </div>
                        <div class="cup-bracket-tree">
                            <div class="cup-stage-box">
                                <div class="cup-stage-header">
                                    <span>🥊 PŘEDKOLO (19. & 20. KOLO – ODVETY)</span>
                                    <span>10 duelů (20 hráčů)</span>
                                </div>
                                <div class="cup-match-slot"><span>10 duelů na součet 19. + 20. kola</span></div>
                            </div>
                            <div class="cup-stage-box">
                                <div class="cup-stage-header" style="color: #34d399;">
                                    <span>🏆 OSMIFINÁLE (21. & 22. KOLO – ODVETY)</span>
                                    <span style="color: #34d399; font-size: 0.75rem; font-weight: bold;">8 duelů • Nástup TOP 6</span>
                                </div>
                                <div class="cup-match-slot"><span>8 duelů na součet 21. + 22. kola</span></div>
                            </div>
                            <div class="cup-stage-box" style="border-color: rgba(251, 191, 36, 0.3); background: rgba(251, 191, 36, 0.03);">
                                <div class="cup-stage-header" style="color: #fbbf24;">
                                    <span>👑 GRAND FINÁLE (27. KOLO)</span>
                                    <span style="color: #fbbf24; font-weight: 800;">1 ZÁPAS (ALL-IN)</span>
                                </div>
                                <div class="cup-match-slot" style="justify-content: center; color: #fbbf24; font-weight: bold;">
                                    🥇 Finálová bitva o Pohár ve 27. kole!
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }
            return;
        }

        // Vykreslení Play-off duelů
        const renderDuelCardHtml = (duel, isUpcoming = false) => {
            const isMeInDuel = Boolean(myUid && (duel.p1?.uid === myUid || duel.p2?.uid === myUid));
            const p1Wins = duel.winnerUid && duel.winnerUid === duel.p1?.uid;
            const p2Wins = duel.winnerUid && duel.winnerUid === duel.p2?.uid;
            const opponentUid = duel.p1?.uid === myUid ? duel.p2?.uid : duel.p1?.uid;

            return `
                <div class="cup-bracket-match-card ${isMeInDuel ? 'is-my-match' : ''}">
                    <div class="cup-duel-header">
                        <span>${duel.title || 'Vyřazovací duel'}</span>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span>${duel.statusText || ''}</span>
                            ${isMeInDuel && opponentUid ? `
                                <button class="action-btn" style="height: 22px; padding: 0 6px; font-size: 0.65rem; background: #2563eb; border: 1px solid #60a5fa; border-radius: 4px; margin: 0; font-family: 'Oswald', sans-serif; cursor: pointer;" onclick="if(typeof window.showH2HModal === 'function') window.showH2HModal('${opponentUid}');">
                                    ⚔️ H2H
                                </button>
                            ` : ''}
                        </div>
                    </div>

                    <div class="cup-duel-row ${p1Wins ? 'is-winner' : ''}">
                        <div class="cup-duel-player">
                            <span style="color: #64748b; font-size: 0.75rem;">#${duel.p1?.seed || '-'}</span>
                            <strong>${duel.p1?.nick || 'Čeká'}</strong>
                            ${p1Wins ? ' 👑' : ''}
                        </div>
                        <div class="cup-duel-scores">
                            ${!isUpcoming ? `<span class="cup-duel-legs">(${duel.p1?.leg1 ?? '-'} + ${duel.p1?.leg2 ?? '-'})</span>` : `<span class="cup-duel-legs">(– + –)</span>`}
                            <span class="cup-duel-total ${p1Wins ? 'is-winning' : ''}">${duel.p1?.totalPts ?? 0} b.</span>
                        </div>
                    </div>

                    <div class="cup-duel-row ${p2Wins ? 'is-winner' : ''}">
                        <div class="cup-duel-player">
                            <span style="color: #64748b; font-size: 0.75rem;">#${duel.p2?.seed || '-'}</span>
                            <strong>${duel.p2?.nick || 'Čeká'}</strong>
                            ${p2Wins ? ' 👑' : ''}
                        </div>
                        <div class="cup-duel-scores">
                            ${!isUpcoming ? `<span class="cup-duel-legs">(${duel.p2?.leg1 ?? '-'} + ${duel.p2?.leg2 ?? '-'})</span>` : `<span class="cup-duel-legs">(– + –)</span>`}
                            <span class="cup-duel-total ${p2Wins ? 'is-winning' : ''}">${duel.p2?.totalPts ?? 0} b.</span>
                        </div>
                    </div>
                </div>
            `;
        };

        let playoffStages = serverCupData?.playoff?.rounds;
        if (!playoffStages || playoffStages.length === 0 || simMode === 'PLAYOFF') {
            playoffStages = window.generateSimulatedPlayoff(leagueName, groups);
        }
        container.innerHTML = `
            <div class="cup-wrapper">
                <div class="cup-preview-badge" style="border-color: #f97316; color: #fb923c;">
                    <span>🌳</span>
                    <span>ŽIVÝ STAV PLAY-OFF: ${cupTitle}</span>
                </div>
                <div class="cup-bracket-scroll-container">
                    ${playoffStages.map(stage => `
                        <div class="cup-stage-box">
                            <div class="cup-stage-header">
                                <span>${stage.name}</span>
                                <span style="color: #94a3b8; font-size: 0.75rem;">${stage.info || ''}</span>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px;">
                                ${(stage.duels || []).map(d => renderDuelCardHtml(d, false)).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        return;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 👥 VYKRESLENÍ SKUPIN
    // ─────────────────────────────────────────────────────────────────────
    const renderGroupHtml = (groupName, groupTitleClass, players) => {
        if (!players || players.length === 0) return '';
        return `
            <div class="cup-group-card">
                <div class="cup-group-header">
                    <span class="${groupTitleClass}">SKUPINA ${groupName}</span>
                    <span style="color: #64748b; font-size: 0.75rem;">${players.length} hráčů</span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    ${players.map((p, idx) => {
                        const isMe = Boolean(myUid && p.uid && p.uid === myUid);
                        const playerNick = p.nickname || p.nick || 'Anonym';
                        const playerPts = p.pts !== undefined ? p.pts : (p.celkemBodu || 0);
                        const displayRank = isLocked ? `#${idx + 1}` : `#${p.originalRank}`;

                        let rankModifier = '';
                        if (isPL) {
                            if (idx === 0) rankModifier = 'is-top6';
                            else if (idx === 1) rankModifier = 'is-second';
                            else if (idx === 2) rankModifier = 'is-third';
                            else if (idx >= 3) rankModifier = 'is-predkolo';
                        } else {
                            if (idx === 0) rankModifier = 'is-top6';
                            else if (idx === 1) rankModifier = 'is-second';
                        }

                        return `
                            <div class="cup-player-row ${rankModifier} ${isMe ? 'is-me' : ''}">
                                <span class="cup-player-rank">${displayRank}</span>
                                <span class="cup-player-nick">${playerNick}</span>
                                <span class="cup-player-pts">${playerPts} b.</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    };

    let secondPlacesHtml = '';
    if (!isPL && secondPlacesRank.length > 0) {
        secondPlacesHtml = `
            <div class="cup-stage-box" style="margin-top: 15px; border-color: rgba(56, 189, 248, 0.3); background: #0b132b;">
                <div class="cup-stage-header" style="color: #38bdf8; display: flex; justify-content: space-between; align-items: center;">
                    <span>⚔️ SOUBOJ 2. MÍST (BOJ O VOLNÝ LOS V TOP 6)</span>
                    <span style="font-size: 0.72rem; color: #94a3b8; text-transform: none;">Skupiny 12.–18. kolo</span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 5px;">
                    ${secondPlacesRank.map((sp, idx) => {
                        const isTop2 = idx < 2;
                        const isMe = Boolean(myUid && sp.uid && sp.uid === myUid);
                        const rankModifier = isTop2 ? 'is-top6' : 'is-predkolo';
                        const badgeStyle = isTop2 
                            ? 'background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid #10b981;' 
                            : 'background: rgba(234, 88, 12, 0.15); color: #fb923c; border: 1px solid #f97316;';
                        const badgeText = isTop2 ? '🏆 TOP 6' : '🥊 PŘEDKOLO';

                        return `
                            <div class="cup-player-row ${rankModifier} ${isMe ? 'is-me' : ''}" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span class="cup-player-rank">${idx + 1}.</span>
                                    <strong style="color: #fff; font-size: 0.9rem;">${sp.nick}</strong>
                                    <span style="color: #64748b; font-size: 0.75rem;">(Sk. ${sp.group})</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <span class="cup-player-pts">${sp.pts || 0} b.</span>
                                    <span style="${badgeStyle} padding: 2px 8px; border-radius: 4px; font-size: 0.68rem; font-weight: bold;">${badgeText}</span>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    const badgeIcon = isLocked ? '🔒' : '🔮';
    const lockText = isPL ? '(10.–19. KOLO)' : '(12.–18. KOLO)';
    const qualText = isPL ? '(1.–9. KOLO)' : '(1.–11. KOLO)';
    const badgeTitle = isLocked 
        ? `ZÁKLADNÍ SKUPINY: ${cupTitle} ${lockText}` 
        : `ŽIVÝ NÁHLED KVALIFIKACE: ${cupTitle} ${qualText}`;

    container.innerHTML = `
        <div class="cup-wrapper">
            <div class="cup-preview-badge" style="${isLocked ? 'border-color: #10b981; color: #34d399;' : ''}">
                <span>${badgeIcon}</span>
                <span>${badgeTitle}</span>
            </div>

            <!-- MŘÍŽKA 4 SKUPIN -->
            <div class="cup-groups-grid">
                ${renderGroupHtml('A', 'cup-group-title-A', groups.A)}
                ${renderGroupHtml('B', 'cup-group-title-B', groups.B)}
                ${renderGroupHtml('C', 'cup-group-title-C', groups.C)}
                ${renderGroupHtml('D', 'cup-group-title-D', groups.D)}
            </div>

            <!-- MINI-TABULKA 2. MÍST (POUZE CHANCE LIGA) -->
            ${secondPlacesHtml}
        </div>
    `;
};

// =========================================================================
// 🧪 ADMIN SIMULÁTORY POHÁRU (100% IN-MEMORY PROHLÍŽEČ)
// =========================================================================

// 1. Zámek skupin
window.adminSimulateCupLock = (leagueName) => {
    const store = Alpine.store('appState');
    if (store) {
        store.cupSimMode = 'GROUPS_LOCKED';
    }
    const isPL = (leagueName || store?.selectedAdminLeague) === 'Premier League';
    window.showToast(`🔒 Simulace aktivní: Skupiny zamčeny po ${isPL ? '9' : '11'}. kole!`);
};

// 2. Start Play-off
window.adminSimulateCupPlayoff = (leagueName) => {
    const store = Alpine.store('appState');
    if (store) {
        store.cupSimMode = 'PLAYOFF';
    }
    const isPL = (leagueName || store?.selectedAdminLeague) === 'Premier League';
    window.showToast(`🌳 Simulace aktivní: K.O. Pavouk po ${isPL ? '19' : '18'}. kole vygenerován!`);
};

// 3. Reset do živého náhledu
window.adminResetCupState = () => {
    const store = Alpine.store('appState');
    if (store) {
        store.cupSimMode = null;
    }
    window.showToast("🔄 Simulace vypnuta: Návrat do živého zrcadla ligy.");
};