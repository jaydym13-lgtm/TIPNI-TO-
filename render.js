// =========================================================================
// 🎨 TIPNI TO! - VYKRESLOVÁNÍ DAT, TIPŮ A FILTROVANÉHO ŽEBŘÍČKU (render.js)
// =========================================================================

import { doc, collection, onSnapshot, query, where, getDocs, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp, deleteField, writeBatch } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js";
import { CONFIG } from "./config.js";
import "./excelExport.js";

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
    
    const targetPx = 170; // 🎯 Reálná cílová šířka textu v kartě na mobilu
    
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

// 🎨 DYNAMICKÉ ZMENŠENÍ PÍSMA PŘEZDÍVKY V HLAVIČCE MENU (CANVAS L1 RAM)
window.vypocitejPismoNicku = (nickname) => {
    const text = String(nickname || '').trim().toUpperCase();
    if (!text || !canvasContext) return '1.15rem';
    
    const cacheKey = `nick_${text}`;
    if (fontPismoCache[cacheKey]) return fontPismoCache[cacheKey];

    canvasContext.font = "bold 18.4px 'Oswald', sans-serif";
    const sirkaPx = canvasContext.measureText(text).width;
    const targetPx = 185; // Dostupný prostor po odečtení tlačítka ⚙️ a paddingu

    if (sirkaPx <= targetPx) {
        fontPismoCache[cacheKey] = '1.15rem';
        return '1.15rem';
    }

    const ratio = targetPx / sirkaPx;
    const finalRem = Math.max(0.78, ratio * 1.15);
    const result = `${finalRem.toFixed(2)}rem`;
    fontPismoCache[cacheKey] = result;
    return result;
};

// 📊 KONTROLNÍ STRÁŽCE SPODNÍ LIŠTY (Zobrazuje pouze u budoucích zápasů s kurzy v Programu utkání)
window.canShowExtraStrip = (match) => {
    if (!match || !match.odds) return false;
    const store = typeof Alpine !== 'undefined' ? Alpine.store('appState') : null;
    if (store && store.matchViewMode === 'results') return false;
    if (match.vysledek_domaci !== undefined && match.vysledek_domaci !== null) return false;
    if (match.apiStatus === 'IN_PLAY' || match.apiStatus === 'PAUSED' || match.apiStatus === 'POSTPONED') return false;

    if (match.datumObj) {
        const d = match.datumObj instanceof Date ? match.datumObj : new Date(match.datumObj);
        if (d <= new Date()) return false;
    } else if (match.datum) {
        const d = (match.datum.toDate && typeof match.datum.toDate === 'function')
            ? match.datum.toDate()
            : (match.datum.seconds ? new Date(match.datum.seconds * 1000) : new Date(match.datum));
        if (d <= new Date()) return false;
    }

    return true;
};

// 1. UŽIVATEL: ZOBRAZENÍ ZÁPASŮ (Bleskový průchod bez duplicitní reaktivní zátěže)
window.renderMatches = (leagueName) => {
    if (!leagueName || typeof leagueName !== 'string' || leagueName.trim() === '' || leagueName === 'null' || leagueName === 'undefined') {
        return;
    }
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
        if (zZapas.apiStatus === 'POSTPONED') {
            window.showToast("⏳ Tento zápas je odložen! Vyčkej na vypsání nového termínu.", true);
            return;
        }
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

    if (ubehloMili < 10000) {
        const zbyvaVterin = Math.ceil((10000 - ubehloMili) / 1000);
        window.showToast(`⏱️ Zpomal! Tip na tento zápas můžeš upravit až za ${zbyvaVterin} s.`, true);
        return;
    }

    const domaciSkore = document.getElementById(`tip-domaci-${matchId}`).value;
    const hosteSkore = document.getElementById(`tip-hoste-${matchId}`).value;

    if (domaciSkore === "" || hosteSkore === "") {
        window.showToast("⚠️ Musíš nejprve zvolit číselné skóre obou týmů!", true);
        return;
    }

    const store = Alpine.store('appState');
    const dVal = parseInt(domaciSkore);
    const hVal = parseInt(hosteSkore);
    const isExtraliga = (leagueName === "Tipsport Extraliga");
    const vyzadujePostup = (zZapas?.isPlayoff && leagueName !== "Liga mistrů") || isExtraliga;

    let postupVal = store?.rozvrtaneTipy?.[`${matchId}_postup`] || store?.mojeTipy?.[matchId]?.postup || '';
    const hiddenInput = document.getElementById(`playoff-user-val-${matchId}`);
    if (hiddenInput && hiddenInput.value) postupVal = hiddenInput.value;

    if (dVal === hVal && vyzadujePostup) {
        if (!postupVal) {
            window.showToast(isExtraliga ? "🏒 Při remíze musíš vybrat vítěze po prodloužení / nájezdech!" : "🏆 V play-off musíš při remíze zvolit postupujícího!", true);
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
        
        // 🔥 SERVEROVÝ POHON JEDNOHO TIPU PŘES CENTRÁLNÍ CLOUD FUNKCI:
        const saveUserTipsCF = httpsCallable(window.functions, 'saveUserTipsCF');

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

            const inputKanadske = document.getElementById('bonus-kanadske');

            if (inputVitez) inputVitez.value = mojeBonusy.vitez || '';
            if (inputStrelec) inputStrelec.value = mojeBonusy.strelec || '';
            if (inputKanadske) inputKanadske.value = mojeBonusy.kanadske || '';
            if (btnBonus) btnBonus.innerText = (mojeBonusy.vitez || mojeBonusy.strelec || mojeBonusy.kanadske) ? 'ULOŽENO ✔' : 'ULOŽIT DLOUHODOBÉ TIPY';
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

    const vitezValue = (store?.mojeBonusy?.vitez || '').trim();
    const strelecValue = (store?.mojeBonusy?.strelec || '').trim();
    const kanadskeValue = (store?.mojeBonusy?.kanadske || '').trim();
    const btnBonus = document.getElementById('btn-save-bonus');

    const maTipNaViteze = (leagueName !== "Chance Liga");
    const maTipNaKanadske = (leagueName === "Tipsport Extraliga");

    if ((maTipNaViteze && !vitezValue) || !strelecValue || (maTipNaKanadske && !kanadskeValue)) {
        window.showToast("⚠️ Musíš vyplnit všechna požadovaná pole!", true);
        return;
    }

    if (btnBonus) btnBonus.innerText = 'UKLÁDÁM...';

    try {
        const saveBonusTipsCF = httpsCallable(window.functions, 'saveBonusTipsCF');

        await saveBonusTipsCF({
            leagueName: leagueName,
            vitez: vitezValue,
            strelec: strelecValue,
            kanadske: kanadskeValue,
            sezonaId: window.SEZONA_ID
        });

        window.showToast(`🎁 Dlouhodobé tipy pro ${leagueName} úspěšně uloženy!`);
        window.loadBonusTips(leagueName);
    } catch (e) {
        console.error(e);
        if (btnBonus) btnBonus.innerText = 'ULOŽIT';
    }
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

    // 2. SPECIFICKÁ PRAVIDLA PRO PREMIER LEAGUE, MS VE FOTBALE & LIGU MISTRŮ
    if (league === "Premier League" || league === "MS ve fotbale" || league === "Liga mistrů") {
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

// REKAPITULACE PRAVIDEL
window.renderScoring = () => {
    const container = document.getElementById('scoringCardsContainer');
    if (!container) return;
    const store = Alpine.store('appState');
    const leagueName = store?.selectedLeague || '';
    const activeTab = store?.scoringActiveTab || 'rules';

    // ─────────────────────────────────────────────────────────────────────
    // 🎖️ PODZÁLOŽKA 2: VITRÍNA OCENĚNÍ A TROFEJÍ (O CO HRAJEME)
    // ─────────────────────────────────────────────────────────────────────
    if (activeTab === 'prizes') {
        const renderTrophyItem = (tierClass, icon, title, desc) => `
            <div class="trophy-card ${tierClass}">
                <div class="trophy-card-header">
                    <div class="trophy-icon-box">${icon}</div>
                    <div class="trophy-header-info">
                        <div class="trophy-title">${title}</div>
                        <div class="trophy-desc">${desc}</div>
                    </div>
                </div>
            </div>
        `;

        let showcaseHtml = '';

        if (leagueName === "Liga mistrů") {
            showcaseHtml = `
                ${renderTrophyItem('is-gold', '🏆', '1. MÍSTO • ŠAMPION LIGY MISTRŮ', 'Hráč s nejvyšším celkovým počtem bodů na konci soutěže')}
                ${renderTrophyItem('is-silver', '🥈', '2. MÍSTO • VICEMISTR LIGY MISTRŮ', 'Hráč na 2. místě celkového ligového pořadí')}
                ${renderTrophyItem('is-bronze', '🥉', '3. MÍSTO • BRONZOVÝ MEDAILISTA', 'Hráč na 3. místě celkového ligového pořadí')}
                ${renderTrophyItem('is-sniper', '🎯', 'POHÁR SNIPERA', 'Hráč s nejvyšším počtem trefených přesných výsledků')}
            `;
        } else if (leagueName === "Chance Liga" || leagueName === "Premier League") {
            showcaseHtml = `
                ${renderTrophyItem('is-gold', '🏆', `1. MÍSTO • ŠAMPION ${leagueName.toUpperCase()}`, 'Hráč s nejvyšším celkovým počtem bodů na konci sezóny')}
                ${renderTrophyItem('is-silver', '🥈', `2. MÍSTO • VICEMISTR ${leagueName.toUpperCase()}`, 'Hráč na 2. místě celkového ligového pořadí')}
                ${renderTrophyItem('is-bronze', '🥉', `3. MÍSTO • BRONZOVÝ MEDAILISTA`, 'Hráč na 3. místě celkového ligového pořadí')}
                ${renderTrophyItem('is-sniper', '🎯', 'POHÁR SNIPERA', 'Hráč s nejvyšším počtem trefených přesných výsledků za celou sezónu')}
                ${renderTrophyItem('is-fire', '🔥', 'LOVEC TOP ZÁPASŮ', 'Hráč s nejvyšším počtem přesně trefených TOP zápasů za celou sezónu')}
                ${renderTrophyItem('is-crown', '👑', 'POHÁR HRÁČ KOLA', 'Hráč s největším počtem získaných víkendových prvenství')}
                ${renderTrophyItem('is-record', '⚡', 'POHÁR REKORDÉRA', 'Hráč s nejvyšším bodovým náletem v jednom odehraném kole')}
            `;
        } else if (leagueName === "Tipsport Extraliga") {
            showcaseHtml = `
                <div class="trophy-pending-notice">
                    <div style="font-size: 1.8rem; margin-bottom: 6px;">🏒</div>
                    <div style="font-family: 'Oswald', sans-serif; font-size: 1.05rem; font-weight: bold; color: #fbbf24; text-transform: uppercase;">Kategorie trofejí pro Extraligu</div>
                    <div style="font-size: 0.82rem; color: #9ca3af; margin-top: 4px; line-height: 1.4;">
                        Oficiální přehled ocenění a pohárů pro sezónu 2026/2027 bude doplněn později. 
                    </div>
                </div>
            `;
        } else {
            showcaseHtml = `
                ${renderTrophyItem('is-gold', '🏆', '1. MÍSTO • ŠAMPION TURNAJE', 'Hráč s nejvyšším počtem bodů na konci turnaje')}
                ${renderTrophyItem('is-silver', '🥈', '2. MÍSTO • VICEMISTR', 'Hráč na 2. místě celkového pořadí')}
                ${renderTrophyItem('is-bronze', '🥉', '3. MÍSTO • 3. POZICE', 'Hráč na 3. místě celkového pořadí')}
            `;
        }

        container.innerHTML = `
            <div class="trophy-showcase-wrapper">
                <div class="trophy-showcase-intro">
                    <span>🎖️</span>
                    <span>GRAVÍROVANÉ POHÁRY & CENY • SEZÓNA 2026/2027</span>
                </div>
                ${showcaseHtml}
            </div>
        `;
        return;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 📋 PODZÁLOŽKA 1: BODOVACÍ ŘÁD (PRAVIDLA BODOVÁNÍ)
    // ─────────────────────────────────────────────────────────────────────
    if (leagueName === "Liga mistrů") {
        container.innerHTML = `
            <div class="scoring-card font-white card-border-gold">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🎯 PŘESNÝ VÝSLEDEK</div>
                    <div class="scoring-card-desc">Trefíš přesné skóre zápasu</div>
                </div>
                <div class="match-points-badge badge-pts-gold">+6 b.</div>
            </div>
            <div class="scoring-card font-white card-border-cyan">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-cyan">⚽ CHYTRÁ TENDENCE</div>
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
                    2. Vyšší počet <strong>trefených tendencí</strong> (⚽)<br>
                    3. Méně <strong>nenatipovaných zápasů</strong> (❌)<br>
                    4. Vyšší <strong>efektivita / úspěšnost</strong> (%)<br>
                    5. <strong>Dělené místo</strong>
                </div>
            </div>
        `;
    } else if (leagueName === "Premier League") {
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
                    <div class="scoring-card-title text-cyan">⚽ CHYTRÁ TENDENCE</div>
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
                    <div class="scoring-card-title text-cyan">⚽ CHYTRÁ TENDENCE</div>
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
    } else if (leagueName === "Tipsport Extraliga") {
        container.innerHTML = `
            <div class="scoring-card font-white card-border-gold">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🏆 VÍTĚZ ZÁKLADNÍ ČÁSTI</div>
                    <div class="scoring-card-desc">Vítěz základní části ELH (tip před 1. kolem)</div>
                </div>
                <div class="match-points-badge badge-pts-gold">+10 b.</div>
            </div>
            <div class="scoring-card font-white card-border-gold">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🥇 KRÁL STŘELCŮ</div>
                    <div class="scoring-card-desc">Nejlepší střelec základní části (tip před 1. kolem)</div>
                </div>
                <div class="match-points-badge badge-pts-gold">+8 b.</div>
            </div>
            <div class="scoring-card font-white card-border-gold">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🍁 KANADSKÉ BODOVÁNÍ</div>
                    <div class="scoring-card-desc">Vítěz produktivity základní části (tip před 1. kolem)</div>
                </div>
                <div class="match-points-badge badge-pts-gold">+8 b.</div>
            </div>
            <div class="scoring-card font-white card-border-orange">
                <div class="scoring-card-info">
                    <div class="scoring-card-title" style="color: #f97316;">🔥 TOP ZÁPAS KOLA</div>
                    <div class="scoring-card-desc">Přesný výsledek je za 10 b. (s trefeným vítězem do rozhodnnutí 11 b.). Ostatní kladné body se násobí 2×.</div>
                </div>
                <div class="match-points-badge badge-pts-orange">až 11 b.</div>
            </div>
            <div class="scoring-card font-white card-border-purple">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-purple">⚡ BONUS ZA CELÉ KOLO</div>
                    <div class="scoring-card-desc">Uhodnutá tendence (1, X, 2) všech zápasů v kole</div>
                </div>
                <div class="match-points-badge badge-pts-purple">+5 b.</div>
            </div>
            <div class="scoring-card font-white card-border-gold">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🎯 PŘESNÝ VÝSLEDEK</div>
                    <div class="scoring-card-desc">Přesné skóre (bez remízy) po základní hrací době</div>
                </div>
                <div class="match-points-badge badge-pts-gold">+5 b.</div>
            </div>
            <div class="scoring-card font-white card-border-gold">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🎯 PŘESNÁ REMÍZA A VÍTĚZ</div>
                    <div class="scoring-card-desc">Přesné skóre po základní hrací době a trefený vítěz v prodloužení či nájezdech</div>
                </div>
                <div class="match-points-badge badge-pts-gold" style="color: #a3e635; text-shadow: 0 0 8px rgba(163, 230, 53, 0.4);">+7 b.</div>
            </div>
            <div class="scoring-card font-white card-border-gold">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🎯 PŘESNÁ REMÍZA</div>
                    <div class="scoring-card-desc">Přesné skóre po základní hrací době bez trefeného vítěze v prodloužení či nájezdech</div>
                </div>
                <div class="match-points-badge badge-pts-gold">+6 b.</div>
            </div>
            <div class="scoring-card font-white card-border-cyan">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-cyan">🤝 NEPŘESNÁ REMÍZA A VÍTĚZ</div>
                    <div class="scoring-card-desc">Nepřesná remíza a trefený vítěz v prodloužení či nájezdech</div>
                </div>
                <div class="match-points-badge badge-pts-cyan" style="color: #a3e635; text-shadow: 0 0 8px rgba(163, 230, 53, 0.4);">+4 b.</div>
            </div>
            <div class="scoring-card font-white card-border-cyan">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-cyan">🤝 NEPŘESNÁ REMÍZA</div>
                    <div class="scoring-card-desc">Nepřesná remíza bez trefeného vítěze v prodloužení či nájezdech</div>
                </div>
                <div class="match-points-badge badge-pts-cyan">+3 b.</div>
            </div>
            <div class="scoring-card font-white card-border-green">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-green">🏒 ZÁKLADNÍ TENDENCE</div>
                    <div class="scoring-card-desc">Čistý vítěz zápasu v základní hrací době</div>
                </div>
                <div class="match-points-badge badge-pts-green">+2 b.</div>
            </div>
            <div class="scoring-card font-white card-border-red">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-danger">❌ ŠPATNÝ TIP</div>
                    <div class="scoring-card-desc">Netrefený vítěz ani remíza</div>
                </div>
                <div class="match-points-badge badge-pts-negative">-1 b.</div>
            </div>
            <div class="scoring-card font-white card-border-red">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-danger">⚠️ NENATIPOVANÝ ZÁPAS</div>
                    <div class="scoring-card-desc">Zápas odstartoval bez uloženého tipu</div>
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
    } else {
        container.innerHTML = `
            <div class="scoring-card font-white card-border-gold">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🏆 ŠAMPION</div>
                    <div class="scoring-card-desc">Uhodnutý celkový vítěz turnaje (před 1.辨kolem)</div>
                </div>
                <div class="match-points-badge badge-pts-gold">+10 b.</div>
            </div>
            <div class="scoring-card font-white card-border-gold">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-gold">🥇 STŘELEC</div>
                    <div class="scoring-card-desc">Uhodnutý celkový nejlepší střelec (před 1.辨kolem)</div>
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
    if (d === '') selD.style.color = '#ef4444';
    else if (savedD !== '' && parseInt(d) === parseInt(savedD)) selD.style.color = '#ffffff';
    else selD.style.color = '#facc15';

    if (h === '') selH.style.color = '#ef4444';
    else if (savedH !== '' && parseInt(h) === parseInt(savedH)) selH.style.color = '#ffffff';
    else selH.style.color = '#facc15';

    const vyzadujeOt = isPlayoff || store?.selectedLeague === "Tipsport Extraliga";
    if (!vyzadujeOt) return;

    const box = document.getElementById(`playoff-user-box-${matchId}`);
    if (box) {
        if (d !== "" && h !== "" && parseInt(d) === parseInt(h)) {
            box.style.display = 'flex';
        } else {
            box.style.display = 'none';
            const valInput = document.getElementById(`playoff-user-val-${matchId}`);
            if (valInput) valInput.value = '';
            const bDom = document.getElementById(`playoff-user-dom-${matchId}`);
            const bHos = document.getElementById(`playoff-user-hos-${matchId}`);
            if (bDom) bDom.style.background = '#111827';
            if (bHos) bHos.style.background = '#111827';
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

    if (ubehloMili < 10000) {
        const zbyvaVterin = Math.ceil((10000 - ubehloMili) / 1000);
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
            let postupVal = (hiddenInput && hiddenInput.value) ? hiddenInput.value : (store?.rozvrtaneTipy?.[`${matchId}_postup`] || store?.mojeTipy?.[matchId]?.postup || '');

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
        const saveUserTipsCF = httpsCallable(window.functions, 'saveUserTipsCF');

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
        const registerNicknameCF = httpsCallable(window.functions, 'registerNicknameCF');

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
    // 2. Kontrola dlouhodobých bonusů v Loutkovodiči
    else if (id === 'proxy-vitez') {
        prvekJeSkutecneDirty = (val.trim() !== (store?.loutkovodicInitialBonusVitez || ''));
    } else if (id === 'proxy-strelec') {
        prvekJeSkutecneDirty = (val.trim() !== (store?.loutkovodicInitialBonusStrelec || ''));
    } else if (id === 'proxy-kanadske') {
        prvekJeSkutecneDirty = (val.trim() !== (store?.loutkovodicInitialBonusKanadske || ''));
    }
    // 3. Kontrola standardních uživatelských tipů na zápasy
    else if (id.startsWith('tip-domaci-') || id.startsWith('tip-hoste-')) {
        const matchId = id.replace('tip-domaci-', '').replace('tip-hoste-', '');
        const savedMatch = store?.mojeTipy?.[matchId];
        const savedValue = id.includes('domaci') ? (savedMatch ? String(savedMatch.tip_domaci) : '') : (savedMatch ? String(savedMatch.tip_hoste) : '');
        prvekJeSkutecneDirty = (val !== savedValue);
    }
    // 4. Kontrola tipů v Loutkovodiči
    else if (id.startsWith('proxy-tip-domaci-') || id.startsWith('proxy-tip-hoste-')) {
        const matchId = id.replace('proxy-tip-domaci-', '').replace('proxy-tip-hoste-', '');
        const lMatch = store?.loutkovodicMatches?.find(m => m.id === matchId);
        const savedValue = id.includes('domaci') ? (lMatch?.saved_domaci || '') : (lMatch?.saved_hoste || '');
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
window.zobrazVarovnyModal = zobrazVarovnyModal;

// 📱 Sledujeme hardwarové/systémové gesto nebo tlačítko zpět zespodu mobilu
window.addEventListener('popstate', (event) => {
    const store = Alpine.store('appState');
    if (!store) return;

    // 1. Zavření otevřeného menu nebo vyskakovacích oken
    if (store.isMenuOpen) {
        store.isMenuOpen = false;
    }
    if (store.reorderModalOpen) {
        store.reorderModalOpen = false;
    }
    if (store.premierCupSurveyOpen) {
        store.premierCupSurveyOpen = false;
    }
    document.querySelectorAll('.spy-modal-overlay:not(#loutkovodic-modal):not(#reorder-leagues-modal)').forEach(el => el.remove());

    const targetState = event.state;
    const targetScreen = targetState?.screen || 'leaguesScreen';
    const targetMode = targetState?.mode;
    const targetLeague = targetState?.league;

    if (window.isAppFormDirty) {
        window.history.pushState({ screen: store.currentScreen, mode: store.matchViewMode, league: store.selectedLeague }, "");
        zobrazVarovnyModal(() => {
            window.isAppFormDirty = false;
            if (targetLeague && targetLeague !== store.selectedLeague && typeof window.selectLeague === 'function') {
                window.selectLeague(targetLeague, targetScreen);
            } else {
                if (targetMode && targetScreen === 'matchesScreen') {
                    store.matchViewMode = targetMode;
                }
                window.goToScreen(targetScreen, false);
            }
        });
        return;
    }

    if (targetLeague && targetLeague !== store.selectedLeague && typeof window.selectLeague === 'function') {
        window.selectLeague(targetLeague, targetScreen);
    } else {
        if (targetMode && targetScreen === 'matchesScreen') {
            store.matchViewMode = targetMode;
        }
        window.goToScreen(targetScreen, false);
    }
});

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

// 🔔 NÁVOD: NASTAVENÍ NOTIFIKACÍ NA POZADÍ A BATERIE V TELEFONU
window.otevriNavodNotifikaci = () => {
    const navodNotifikaciHtml = `
        <div class="notif-guide-wrapper">
            <div class="notif-guide-alert">
                💡 <strong>Proč notifikace nepřijdou?</strong> Mobilní systémy (zejména Xiaomi, Samsung a Apple) aplikace po zavření agresivně uspávají. Níže najdeš postup, jak povolit doručování na pozadí.
            </div>

            <div class="notif-guide-section">
                <span class="notif-guide-heading">🤖 Android (Xiaomi, Redmi, POCO / MIUI & HyperOS)</span>
                <ul class="notif-guide-list">
                    <li>Na ploše telefonu <strong>podrž prst na ikoně TIPNI TO!</strong> a zvol <strong>O aplikaci</strong> (nebo ikonu ℹ️).</li>
                    <li>V sekci <strong>Napájení / Spořič baterie</strong> přepni volbu na <strong>Žádné omezení</strong>.</li>
                    <li>Vypni přepínač <strong>Pozastavit aktivitu aplikace, pokud se nepoužívá</strong>.</li>
                </ul>
            </div>

            <div class="notif-guide-section">
                <span class="notif-guide-heading">📱 Android (Samsung / One UI & ostatní)</span>
                <ul class="notif-guide-list">
                    <li>V systémovém <strong>Nastavení ➔ Aplikace ➔ TIPNI TO!</strong> otevři sekci <strong>Baterie</strong>.</li>
                    <li>Zvol možnost <strong>Nespoutáno</strong> (nebo <strong>Neoptimalizováno / Bez omezení</strong>).</li>
                    <li>V sekci <strong>Oznámení</strong> zkontroluj, že máš povoleno <strong>Zobrazovat oznámení</strong>.</li>
                </ul>
            </div>

            <div class="notif-guide-section">
                <span class="notif-guide-heading">🍏 iPhone (iOS 16.4+)</span>
                <ul class="notif-guide-list">
                    <li>Aplikaci je nutné mít <strong>přidanou na ploše</strong> přes Safari (Sdílet ➔ Přidat na plochu). V běžném okně Safari push na pozadí neběží.</li>
                    <li>V systémovém <strong>Nastavení ➔ Oznámení ➔ TIPNI TO!</strong> zapni <strong>Povolit oznámení</strong> a <strong>Okamžité doručení</strong>.</li>
                    <li>Aplikaci nevypínej násilným „odmáznutím“ prstem nahoru z přehledu spuštěných oken – systém iOS tím pozastaví push procesy až do dalšího otevření.</li>
                </ul>
            </div>
        </div>
    `;
    window.openGlobalUiModal('DORUČOVÁNÍ NOTIFIKACÍ', navodNotifikaciHtml);
};
