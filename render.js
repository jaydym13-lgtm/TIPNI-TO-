// =========================================================================
// 🎨 TIPNI TO! - VYKRESLOVÁNÍ DAT, TIPŮ A FILTROVANÉHO ŽEBŘÍČKU (render.js)
// =========================================================================

import { doc, collection, onSnapshot, query, where, getDocs, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp, deleteField } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js";

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

window.autoSmrskniTentoJedenRadek = (row) => {
    if (!row) return;
    const teamsEl = row.querySelector('.match-teams');
    const infoEl = row.querySelector('.match-info');
    if (!teamsEl || !infoEl) return;
    
    teamsEl.style.fontSize = '0.95rem';
    const dostupnaSirkaBloku = infoEl.clientWidth - 4;
    
    if (dostupnaSirkaBloku > 0) {
        let currentSize = 0.95;
        while (teamsEl.scrollWidth > dostupnaSirkaBloku && currentSize > 0.70) {
            currentSize -= 0.02;
            teamsEl.style.fontSize = `${currentSize}rem`;
        }
    }
};

const autoSmrskniPismoTymu = (containerSelector) => {
    requestAnimationFrame(() => {
        const container = document.querySelector(containerSelector);
        if (!container) return;
        container.querySelectorAll('.tip-row').forEach(row => {
            window.autoSmrskniTentoJedenRadek(row);
        });
    });
};

// 1. UŽIVATEL: ZOBRAZENÍ ZÁPASŮ (SOUSTŘEDĚNO DO JEDNOHO SOUBORU STAV/ROZPIS PRO MINIMÁLNÍ READS)
window.renderMatches = async (leagueName) => {
    // 🛡️ ANTI-400 ŠTÍT: Pokud liga ještě není v Alpine kompletně připravená, utneme dotaz dřív, než stihne spadnout Firestore
    if (!leagueName || typeof leagueName !== 'string' || leagueName.trim() === '' || leagueName === 'null' || leagueName === 'undefined') {
        return;
    }

    const container = document.querySelector('#matchesScreen .zebra-container');
    if (!container) return;

    // 🔐 EVENT-DRIVEN GATE: Pokud claims ještě nedorazily, tichým způsobem počkáme na signál z auth.js

    if (window.currentMatchesUnsubscribe) {
        window.currentMatchesUnsubscribe();
        window.currentMatchesUnsubscribe = null;
    }

    container.innerHTML = '<div class="db-empty-msg">Načítám zápasy ze stadionu...</div>';
    const user = window.auth.currentUser;

    try {
        // 🔥 POSLUCHÁME POUZE JEDEN CENTRÁLNÍ DOKUMENT (Úspora kvóty na 1 Read!)
        window.currentMatchesUnsubscribe = onSnapshot(doc(window.db, 'ligy', leagueName, 'stav', 'rozpis'), async (docSnap) => {
            
            if (Alpine.store('appState')?.currentScreen !== 'matchesScreen' || Alpine.store('appState')?.selectedLeague !== leagueName) {
                if (window.currentMatchesUnsubscribe) {
                    window.currentMatchesUnsubscribe();
                    window.currentMatchesUnsubscribe = null;
                }
                return;
            }

            try {
                const myTips = {};
                if (user) {
                    const q = query(collection(window.db, 'ligy', leagueName, 'tipy'), where('userId', '==', user.uid));
                    const myTipsSnapshot = await getDocs(q);
                    myTipsSnapshot.forEach(doc => {
                        myTips[doc.data().matchId] = doc.data();
                    });
                }

                container.innerHTML = '';

                if (!docSnap.exists()) {
                    container.innerHTML = `<div class="db-empty-msg">Pro soutěž "${leagueName}" zatím nejsou vypsané zápasy.</div>`;
                    return;
                }

                const zapasyMapa = docSnap.data().zapasyMapa || {};
                let klientskeZapasy = Object.keys(zapasyMapa).map(id => ({ id, ...zapasyMapa[id] }));
                
                klientskeZapasy.sort((a, b) => {
                    const dA = a.datum?.toDate ? a.datum.toDate() : new Date(a.datum);
                    const dB = b.datum?.toDate ? b.datum.toDate() : new Date(b.datum);
                    return dA - dB;
                });

                let sumaBoduOdehranych = 0;

                const activeWrapper = document.createElement('div');
                activeWrapper.style.width = '100%';
                activeWrapper.style.display = 'flex';
                activeWrapper.style.flexDirection = 'column';
                activeWrapper.style.gap = '8px';

                const jeOtevreno = localStorage.getItem('tipni_odehrane_open') === 'true';
                const evaluatedCollapseBox = document.createElement('div');
                evaluatedCollapseBox.className = 'bonus-collapse-box evaluated-collapse-box';
                evaluatedCollapseBox.style.marginTop = '5px';
                evaluatedCollapseBox.style.marginBottom = '6px';
                evaluatedCollapseBox.style.width = '100%';
                evaluatedCollapseBox.innerHTML = `
                    <button class="bonus-collapse-trigger" onclick="const c = this.nextElementSibling; const isHidden = c.style.display === 'none'; c.style.display = isHidden ? 'flex' : 'none'; this.querySelector('.arrow').innerText = isHidden ? '▲' : '▼'; localStorage.setItem('tipni_odehrane_open', isHidden);" style="color: #9ca3af; border-color: #374151; min-height: 48px;">
                        <span>✅ ODEHRANÉ ZÁPASY</span>
                        <span id="evaluated-total-badge" style="background: #111827; color: #34d399; border: 1px solid #059669; padding: 5px 12px; border-radius: 6px; font-size: 0.85rem; font-weight: bold; font-family: 'Oswald', sans-serif; white-space: nowrap; margin-left: auto; margin-right: 12px; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;">0 b.</span>
                        <span class="arrow">${jeOtevreno ? '▲' : '▼'}</span>
                    </button>
                    <div class="bonus-collapse-content" style="display: ${jeOtevreno ? 'flex' : 'none'}; padding: 10px 8px; flex-direction: column; gap: 8px;"></div>
                `;
                const evaluatedWrapper = evaluatedCollapseBox.querySelector('.bonus-collapse-content');

                klientskeZapasy.forEach(match => {
                    const jeDomaciNull = !match.domaci || match.domaci === 'null' || String(match.domaci).trim() === '' || String(match.domaci).trim().toLowerCase() === 'neznámý';
                    const jeHosteNull = !match.hoste || match.hoste === 'null' || String(match.hoste).trim() === '' || String(match.hoste).trim().toLowerCase() === 'neznámý';

                    if (jeDomaciNull && jeHosteNull) return;
                    if (jeDomaciNull) match.domaci = 'Neznámý';
                    if (jeHosteNull) match.hoste = 'Neznámý';

                    const matchId = match.id;
                    const existingTip = myTips[matchId];

                    let mujTipHtml = existingTip 
                        ? `<span class="user-tip-value valid-tip">${existingTip.tip_domaci} : ${existingTip.tip_hoste}${match.isPlayoff && existingTip.tip_domaci === existingTip.tip_hoste && existingTip.postup ? '*' : ''}</span>`
                        : `<span class="user-tip-value no-tip">? : ?</span>`;

                    let vybranyDomaci = existingTip ? existingTip.tip_domaci : '';
                    let vybranyHoste = existingTip ? existingTip.tip_hoste : '';

                    let datumObj = match.datum?.toDate ? match.datum.toDate() : new Date(match.datum);
                    let datumText = datumObj.toLocaleDateString('cs-CZ', {
                        day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit'
                    });

                    let isEvaluated = (match.vysledek_domaci !== undefined && match.vysledek_hoste !== undefined && match.apiStatus !== "IN_PLAY" && match.apiStatus !== "PAUSED");
                    let rightSideGroupHtml = '';
                    let evaluatedClass = '';
                    let playoffUserRowHtml = '';

                    const jeLive = match.apiStatus === "IN_PLAY" || match.apiStatus === "PAUSED";
                    const uzZacalo = datumObj <= new Date();

                    if (isEvaluated) {
                        evaluatedClass = 'match-is-evaluated';
                        let ziskaneBody = 0;
                        
                        if (existingTip) {
                            ziskaneBody = window.vypocitejBodyZapasu(
                                existingTip.tip_domaci, existingTip.tip_hoste,
                                match.vysledek_domaci, match.vysledek_hoste,
                                leagueName, existingTip.postup, match.postup, match.isPlayoff
                            );
                        } else {
                            if (leagueName === "MS ve fotbale") {
                                ziskaneBody = -1;
                            }
                        }

                        sumaBoduOdehranych += ziskaneBody;

                        let pointsBadgeClass = ziskaneBody > 0 ? 'badge-pts-positive' : (ziskaneBody < 0 ? 'badge-pts-negative' : 'badge-pts-zero');
                        let realPostupPoznamka = (match.isPlayoff && match.vysledek_domaci === match.vysledek_hoste && match.postup) ? ` (${match.postup === 'domaci' ? 'DOM' : 'HOS'})` : '';

                        rightSideGroupHtml = `
                            <div class="user-tip-box admin-result-box">
                                <div class="user-tip-label result-label-color">Výsledek <span style="color:#10b981; font-weight:bold;">✔</span></div>
                                <span class="user-tip-value result-value-color">${match.vysledek_domaci} : ${match.vysledek_hoste}${realPostupPoznamka}</span>
                            </div>
                            <div class="match-points-badge ${pointsBadgeClass}">${ziskaneBody >= 0 ? '+' : ''}${ziskaneBody} b.</div>
                        `;
                    } else if (jeLive) {
                        let prubezneDomaci = match.vysledek_domaci !== undefined && match.vysledek_domaci !== null ? match.vysledek_domaci : 0;
                        let prubezneHoste = match.vysledek_hoste !== undefined && match.vysledek_hoste !== null ? match.vysledek_hoste : 0;
                        let realPostupPoznamka = (match.isPlayoff && prubezneDomaci === prubezneHoste && match.postup) ? ` (${match.postup === 'domaci' ? 'DOM' : 'HOS'})` : '';

                        rightSideGroupHtml = `
                            <div class="user-tip-box admin-result-box" style="border-color: #ef4444; background: rgba(239, 68, 68, 0.05);">
                                <div class="user-tip-label" style="color: #ef4444; font-weight: bold; animation: pulse 1.5s infinite;">🔴 LIVE</div>
                                <span class="user-tip-value" style="color: #ffffff;">${prubezneDomaci} : ${prubezneHoste}${realPostupPoznamka}</span>
                            </div>
                            <div class="match-points-badge" style="background: #ef4444; color: #fff; border-color: #f87171; font-size: 0.68rem;">LIVE</div>
                        `;
                    } else {
                        let isTie = (vybranyDomaci !== '' && vybranyHoste !== '' && parseInt(vybranyDomaci) === parseInt(vybranyHoste));
                        let showPlayoff = (match.isPlayoff && isTie);
                        let savedPostup = existingTip ? existingTip.postup : '';

                        playoffUserRowHtml = `
                            <div id="playoff-user-box-${matchId}" style="grid-column: span 3; display: ${showPlayoff ? 'flex' : 'none'}; gap: 8px; margin-top: 8px; width: 100%;">
                                <button id="playoff-user-dom-${matchId}" style="flex:1; height:34px; border-radius:6px; font-weight:bold; font-size:0.8rem; cursor:pointer; border:1px solid #4b5563; background:${savedPostup === 'domaci' ? '#059669' : '#111827'}; color:${savedPostup === 'domaci' ? '#fff' : '#9ca3af'};" onclick="window.selectPlayoffUser('${matchId}', 'domaci')">👉 ${match.domaci}</button>
                                <button id="playoff-user-hos-${matchId}" style="flex:1; height:34px; border-radius:6px; font-weight:bold; font-size:0.8rem; cursor:pointer; border:1px solid #4b5563; background:${savedPostup === 'hoste' ? '#059669' : '#111827'}; color:${savedPostup === 'hoste' ? '#fff' : '#9ca3af'};" onclick="window.selectPlayoffUser('${matchId}', 'hoste')">${match.hoste} 👈</button>
                                <input type="hidden" id="playoff-user-val-${matchId}" value="${savedPostup || ''}">
                            </div>
                        `;

                        rightSideGroupHtml = `
                            <div class="action-inputs">
                                <select id="tip-domaci-${matchId}" class="select-score" onchange="window.handleUserScoreChange('${matchId}', ${match.isPlayoff || false})">
                                    ${generujMožnosti(vybranyDomaci)}
                                </select>
                                <span class="select-divider">:</span>
                                <select id="tip-hoste-${matchId}" class="select-score" onchange="window.handleUserScoreChange('${matchId}', ${match.isPlayoff || false})">
                                    ${generujMožnosti(vybranyHoste)}
                                </select>
                            </div>
                            <button class="btn-tip" @click="window.saveTip('${matchId}', '${leagueName}')">
                                ${existingTip ? 'ZMĚŇ' : 'ULOŽ'}
                            </button>
                        `;
                    }

                    let spyEyeHtml = uzZacalo 
                        ? `<span onclick="window.showSpyModal('${matchId}', '${match.domaci} – ${match.hoste}')" class="match-metadata-eye">👁️</span>`
                        : `<span class="match-metadata-lock" title="Tipy ostatních se odemknou automaticky v minutu startu utkání">🔒</span>`;

                    const matchRow = document.createElement('div');
                    matchRow.className = `zebra-block tip-row ${existingTip ? 'has-tip' : ''} ${evaluatedClass}`;
                    matchRow.setAttribute('x-init', 'window.autoSmrskniTentoJedenRadek($el)');
                    matchRow.innerHTML = `
                            <div class="match-info">
                                <span class="match-date">📅 ${datumText} ${match.isPlayoff ? '<span style="color:#fbbf24; font-size:0.7rem; font-weight:bold; margin-left:4px; margin-right:4px;">🏆 PLAY-OFF</span>' : ''}${spyEyeHtml}</span>
                                <div class="match-teams">${match.domaci} – ${match.hoste}</div>
                            </div>
                            
                            <div style="display: flex; align-items: center; justify-content: space-between; width: 190px; flex-shrink: 0; box-sizing: border-box; margin: 0; padding: 0;">
                                <div class="user-tip-box">
                                    <div class="user-tip-label">Můj tip ${existingTip ? '<span style="color:#10b981; font-weight:bold;">✔</span>' : ''}</div>
                                    ${mujTipHtml}
                                </div>
                                ${rightSideGroupHtml}
                            </div>
                            ${playoffUserRowHtml}
                        `;

                    if (isEvaluated) evaluatedWrapper.appendChild(matchRow);
                    else activeWrapper.appendChild(matchRow);
                });

                const totalBadge = evaluatedCollapseBox.querySelector('#evaluated-total-badge');
                if (totalBadge) {
                    totalBadge.innerText = `CELKEM: ${sumaBoduOdehranych >= 0 ? '+' : ''}${sumaBoduOdehranych} b.`;
                    if (sumaBoduOdehranych < 0) {
                        totalBadge.style.backgroundColor = '#991b1b';
                        totalBadge.style.color = '#f87171';
                        totalBadge.style.borderColor = '#dc2626';
                    } else if (sumaBoduOdehranych === 0) {
                        totalBadge.style.backgroundColor = '#374151';
                        totalBadge.style.color = '#9ca3af';
                        totalBadge.style.borderColor = '#4b5563';
                    }
                }

                if (evaluatedWrapper.children.length > 0) container.appendChild(evaluatedCollapseBox);
                container.appendChild(activeWrapper);
                autoSmrskniPismoTymu('#matchesScreen');

            } catch (innerError) {
                console.error("Chyba real-time renderingu zápasů:", innerError);
            }
        }, (error) => {
            console.error("Kritická chyba streamu zápasů:", error);
            container.innerHTML = `<div class="err-box">❌ Selhalo spojení se stadionem. Pravděpodobně ještě nemáš přiřazenou licenci od admina.</div>`;
        });

    } catch (error) {
        console.error("Chyba spuštění streamu zápasů:", error);
    }
};

// Globální registr pro ukládání časových razítek (cooldownů)
window.globalniTipoveCooldowny = window.globalniTipoveCooldowny || {};

// UKLÁDÁNÍ JEDNOHO TIPU UŽIVATELE (S 15VTEŘINOVÝM ANTI-SPAM ZÁMKEM)
window.saveTip = async (matchId, leagueName) => {
    const user = window.auth.currentUser;
    if (!user) return;

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
        await setDoc(doc(window.db, 'ligy', leagueName, 'tipy', `${user.uid}_${matchId}`), {
            userId: user.uid,
            userEmail: user.email,
            matchId: matchId,
            tip_domaci: dVal,
            tip_hoste: hVal,
            postup: postupVal,
            vytvoreno: serverTimestamp()
        });

        window.globalniTipoveCooldowny[matchId] = Date.now();
        window.showToast("⚽ Tip bezpečně uložen!");
        window.renderMatches(leagueName);
        
    } catch (error) {
        console.error("Chyba zápisu tipu:", error);
        window.showToast("❌ Server odmítl zápis (App Check ochrana).", true);
        if (kliknuteTlacitko) {
            kliknuteTlacitko.disabled = false;
            kliknuteTlacitko.style.opacity = "1";
            kliknuteTlacitko.innerText = puvodniText;
        }
    }
};

// NAČÍTÁNÍ DLOUHODOBÝCH BONUSŮ
window.loadBonusTips = async (leagueName) => {
    const user = window.auth.currentUser;
    if (!user) return;

    const inputVitez = document.getElementById('bonus-vitez');
    const inputStrelec = document.getElementById('bonus-strelec');
    const btnBonus = document.getElementById('btn-save-bonus');

    if (!inputVitez || !inputStrelec || !btnBonus) return;

    inputVitez.value = '';
    inputStrelec.value = '';
    inputVitez.disabled = false;
    inputStrelec.disabled = false;
    btnBonus.style.display = 'block';
    btnBonus.innerText = 'ULOŽIT';

    try {
        const docSnap = await getDoc(doc(window.db, 'ligy', leagueName, 'bonusy', user.uid));
        if (docSnap.exists()) {
            const data = docSnap.data();
            inputVitez.value = data.vitez || '';
            inputStrelec.value = data.strelec || '';
            btnBonus.innerText = 'ULOŽENO ✔';
        }
    } catch (e) {
        console.error(e);
    }
};

// UKLÁDÁNÍ DLOUHODOBÝCH BONUSŮ
window.saveBonusTips = async () => {
    const user = window.auth.currentUser;
    const leagueName = Alpine.store('appState')?.selectedLeague;
    if (!user || !leagueName) return;

    const vitezValue = document.getElementById('bonus-vitez').value;
    const strelecValue = document.getElementById('bonus-strelec').value;
    const btnBonus = document.getElementById('btn-save-bonus');

    if (!vitezValue.trim() || !strelecValue.trim()) {
        window.showToast("⚠️ Musíš vyplnit obě pole!", true);
        return;
    }

    if (btnBonus) btnBonus.innerText = 'UKLÁDÁM...';

    try {
        await setDoc(doc(window.db, 'ligy', leagueName, 'bonusy', user.uid), {
            userId: user.uid,
            userEmail: user.email,
            vitez: vitezValue.trim(),
            strelec: strelecValue.trim(),
            vytvoreno: serverTimestamp()
        });

        window.showToast("🎁 Bonusy na šampionát uloženy!");
        window.loadBonusTips(leagueName);
    } catch (e) {
        console.error(e);
        if (btnBonus) btnBonus.innerText = 'ULOŽIT';
    }
};

// 2. KROK: REAKTIVNÍ CENTRALIZOVANÝ ŽEBŘÍČEK (POSLOUCHÁ ODLEHČENÝ DOKUMENT STAV/LEADERBOARD)
window.renderLeaderboard = async () => {
    const store = Alpine.store('appState');
    const leagueName = store ? store.selectedLeague : null;
    const container = document.querySelector('#leaderboardScreen .zebra-container');
    if (!container) return;

    // 🔐 EVENT-DRIVEN GATE: Pokud ještě nemáme ověřené claims, podepíšeme se k odběru signálu a ukončíme exekuci

    if (!leagueName) {
        container.innerHTML = '<div class="db-empty-msg">⚠️ Žebříček je izolovaný. Nejprve běž Domů a klikni na konkrétní ligu!</div>';
        return;
    }

    window.leaderboardActiveTab = window.leaderboardActiveTab || 'total';
    const tab = window.leaderboardActiveTab;

    const btnStyleTotal = tab === 'total' ? 'background: #059669; color: white; border-color: #10b981;' : 'background: #1f2937; color: #9ca3af; border-color: #374151;';
    const btnStyleLive = tab === 'live' ? 'background: #ef4444; color: white; border-color: #ef4444;' : 'background: #1f2937; color: #9ca3af; border-color: #374151;';

    container.innerHTML = `
        <div class="leaderboard-tabs-wrapper">
            <button class="nav-btn-leaderboard" style="${btnStyleTotal}" onclick="window.leaderboardActiveTab='total'; window.renderLeaderboard();">
                🏆 Celková tabulka
            </button>
            <button class="nav-btn-leaderboard class-live-btn-tab" style="${btnStyleLive};" onclick="window.leaderboardActiveTab='live'; window.renderLeaderboard();">
                🔴 LIVE!
            </button>
        </div>
        <div class="leaderboard-content-area">
            <div class="db-empty-msg">Načítám živá data z tribuny... ⏳</div>
        </div>
    `;

    const contentArea = container.querySelector('.leaderboard-content-area');

    if (window.lastLeaderboardLeague !== leagueName && window.currentLeaderboardUnsubscribe) {
        window.currentLeaderboardUnsubscribe();
        window.currentLeaderboardUnsubscribe = null;
    }
    window.lastLeaderboardLeague = leagueName;

    if (window.currentLeaderboardUnsubscribe) {
        if (window.lastLeaderboardSnapshotData) {
            window.vykresliDataZebříčku(window.lastLeaderboardSnapshotData, contentArea, tab, leagueName);
        }
        return;
    }

    // 🔥 ŽIVÝ STREAM: Sledujeme odlehčený vygenerovaný soubor od bota
    window.currentLeaderboardUnsubscribe = onSnapshot(doc(window.db, 'ligy', leagueName, 'stav', 'leaderboard'), docSnap => {
            if (Alpine.store('appState')?.currentScreen !== 'leaderboardScreen') {
                if (window.currentLeaderboardUnsubscribe) {
                    window.currentLeaderboardUnsubscribe();
                    window.currentLeaderboardUnsubscribe = null;
                }
                return;
            }

            if (!docSnap.exists()) {
                contentArea.innerHTML = `<div class="db-empty-msg" style="color:#fbbf24;">Žebříček se na pozadí připravuje... ⚙️</div>`;
                const liveBtn = document.querySelector('.class-live-btn-tab');
                if (liveBtn) liveBtn.style.display = 'none';
                return;
            }

            window.lastLeaderboardSnapshotData = docSnap.data();
            window.vykresliDataZebříčku(window.lastLeaderboardSnapshotData, contentArea, window.leaderboardActiveTab, leagueName);
        }, error => {
            console.error("Chyba real-time synchronizace žebříčku:", error);
            contentArea.innerHTML = '<div class="err-box">❌ Selhalo spojení se serverem.</div>';
        });
};

// 🎨 INTERAKTIVNÍ MANAŽER VYKRESLOVÁNÍ DAT (BEZ ZBYTEČNÉ MATRICOVÉ ZÁTĚŽE TELEFONU)
window.vykresliDataZebříčku = (centralDoc, contentArea, tab, leagueName) => {
    const zebricek = centralDoc.zebricek || [];

    const liveBtn = document.querySelector('.class-live-btn-tab');
    if (liveBtn) {
        liveBtn.style.display = Alpine.store('appState')?.isLive ? 'flex' : 'none';
    }

    contentArea.innerHTML = '';

    if (tab === 'total') {
        const rekordyCollapseBox = document.createElement('div');
        rekordyCollapseBox.className = 'bonus-collapse-box-fixed';
        rekordyCollapseBox.innerHTML = `
            <button class="bonus-collapse-trigger-fixed">
                <span>👑 REKORDY TURNAJE (TOP STATISTIKY)</span>
                <span class="arrow-fixed">▼</span>
            </button>
            <div class="bonus-collapse-content-fixed">
                <div class="rekord-box-gold">
                    <div class="rekord-box-label-gold">🎯 Nejvíc přesných výsledků</div>
                    <div class="rekord-box-value">${centralDoc.textKraliPresnosti || '–'}</div>
                </div>
                <div class="rekord-box-cyan">
                    <div class="rekord-box-label-cyan">⚡ Nejlepší herní kolo</div>
                    <div class="rekord-box-value">${centralDoc.textRekordmaniKola || '–'}</div>
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
    }

    zebricek.forEach((stats, index) => {
        const row = document.createElement('div');
        row.className = 'leaderboard-row-wrapper';

        let pozice = index === 0 ? '🥇' : (index === 1 ? '🥈' : (index === 2 ? '🥉' : `${index + 1}.`));

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

        row.innerHTML = `
            <div onclick="const det = this.nextElementSibling; const arr = this.querySelector('.leaderboard-arrow-icon'); if(det.style.display==='none' || !det.style.display){det.style.display='block'; arr.innerText='▲';}else{det.style.display='none'; arr.innerText='▼';}" class="leaderboard-row-trigger">
                <div class="leaderboard-row-left">
                    <span class="leaderboard-row-position">${pozice}</span>
                    <span class="leaderboard-row-nickname">${stats.nickname}</span>
                </div>
                <div class="leaderboard-row-right">
                    <div style="color: ${stats.celkemBodu < 0 ? '#f87171' : '#34d399'};" class="leaderboard-row-points">
                        ${stats.celkemBodu} b.
                    </div>
                    <span class="leaderboard-arrow-icon">▼</span>
                </div>
            </div>
            
            <div class="leaderboard-row-dropdown" style="display: none;">
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
                        <div class="leaderboard-stat-value-cyan">${stats.nejviceBoduVKole} b.</div>
                    </div>
                </div>
                ${bonusRowsHtml}
                <button onclick="window.showPlayerTipsModal('${stats.uid}', '${stats.nickname.replace(/'/g, "\\'")}', '${leagueName}')" class="leaderboard-spy-btn">
                    👁️ PROHLÉDNOUT TIPY HRÁČE
                </button>
            </div>
        `;
        contentArea.appendChild(row);
    });
};

// 👁️ BEZPEČNÝ SPY MODAL PRO HISTORII TIPŮ (STAŽENO ON-DEMAND Z DEDIKOVANÉHO SOUBORU OD BOTA)
window.showPlayerTipsModal = async (playerUid, nickname, leagueName) => {
    window.showToast("⏳ Stahuji historii tipů...", false);

    try {
        const docSnap = await getDoc(doc(window.db, 'ligy', leagueName, 'stav', `historie_${playerUid}`));
        const rozpisSnap = await getDoc(doc(window.db, 'ligy', leagueName, 'stav', 'rozpis'));

        if (!docSnap.exists() || !rozpisSnap.exists()) {
            alert("Hráč zatím nemá žádné uzavřené tipy k zobrazení.");
            return;
        }

        const hracovyTipy = docSnap.data().mapaTipu || {};
        const zapasyMapa = rozpisSnap.data().zapasyMapa || {};

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
            
            // 🚫 FILTR BUDOUCNOSTI: Chceme vidět výhradně a pouze zápasy, které už reálně skončily!
            if (!isEvaluated) return;

            let resStr = `${zap.vysledek_domaci} : ${zap.vysledek_hoste}`;

            let exactClass = '';
            let ptsStr = '-';
            let ptsColor = '#9ca3af';
            let tipStr = '? : ?';

            // Pokud hráč zápas natipoval, spočítáme body standardně
            if (t) {
                let pPozn = (zap.isPlayoff && t.tip_domaci === t.tip_hoste && t.postup) ? '*' : '';
                tipStr = `${t.tip_domaci} : ${t.tip_hoste}${pPozn}`;
                if (isEvaluated) {
                    const pts = window.vypocitejBodyZapasu(t.tip_domaci, t.tip_hoste, zap.vysledek_domaci, zap.vysledek_hoste, leagueName, t.postup, zap.postup, zap.isPlayoff);
                    ptsStr = `(${pts >= 0 ? '+' : ''}${pts} b.)`;
                    ptsColor = pts < 0 ? '#f87171' : (pts > 0 ? '#34d399' : '#9ca3af');
                    if (pts === 6) exactClass = 'exact-tip';
                }
            } else if (isEvaluated) {
                // 🚨 Pokud zápas NEBUDE natipovaný a už skončil, vlepíme mu penalizaci
                let pts = (leagueName === "MS ve fotbale") ? -1 : 0;
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

        const overlay = document.createElement('div');
        overlay.className = 'spy-modal-overlay';
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        overlay.innerHTML = `
            <div class="spy-modal-box" style="max-width:380px;">
                <div class="spy-modal-header">
                    <h3>📋 Tipy hráče: ${nickname}</h3>
                    <button class="spy-modal-close" onclick="this.closest('.spy-modal-overlay').remove()">✕</button>
                </div>
                <div class="spy-modal-body">
                    ${listHtml}
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

    } catch (e) {
        console.error(e);
    }
};

// ADMIN SELEKTOR LIGY
window.selectAdminLeague = (leagueName) => {
    const store = Alpine.store('appState');
    if (store) {
        store.selectedAdminLeague = leagueName;
        window.renderAdminMatches();
    }
};

// ⚙️ CENTRALIZOVANÝ ADMIN PANEL: ŽIVÉ TABOVÉ PŘEKLIKÁVÁNÍ (ZÁPASY / UŽIVATELÉ)
window.renderAdminMatches = async () => {
    const container = document.getElementById('adminMatchesContainer');
    if (!container) return;

    const store = Alpine.store('appState');
    if (!store || !store.isAdmin) {
        window.goToScreen('leaguesScreen');
        return;
    }

    // ⚽ Zápasy jsou nyní první a výchozí záložka podle tvého přání
    window.adminActiveTab = window.adminActiveTab || 'matches';
    const tab = window.adminActiveTab;
    
    // Propojíme vybranou záložku do Alpine Store, aby na ni index.html viděl reaktivně
    if (store) store.adminActiveTab = tab;

    const btnStyleMatches = tab === 'matches' ? 'background: #2563eb; color: white; border-color: #60a5fa;' : 'background: #1f2937; color: #9ca3af; border-color: #374151;';
    const btnStyleUsers = tab === 'users' ? 'background: #059669; color: white; border-color: #10b981;' : 'background: #1f2937; color: #9ca3af; border-color: #374151;';

    container.innerHTML = `
        <div class="leaderboard-tabs-wrapper" style="margin-bottom: 15px; width: 100%; box-sizing: border-box;">
            <button class="nav-btn-leaderboard" style="${btnStyleMatches}" onclick="window.adminActiveTab='matches'; window.renderAdminMatches();">⚽ Zápasy</button>
            <button class="nav-btn-leaderboard" style="${btnStyleUsers}" onclick="window.adminActiveTab='users'; window.renderAdminMatches();">👥 Uživatelé</button>
        </div>
        <div id="adminTabContentArea" style="width:100%;"></div>
    `;

    const contentArea = document.getElementById('adminTabContentArea');
    if (!contentArea) return;

    // --- TAB 1: SPRÁVA ZÁPASŮ ---
    if (tab === 'matches') {
        const activeAdminLeague = store.selectedAdminLeague;
        if (!activeAdminLeague) {
            contentArea.innerHTML = `
                <h2 class="font-white" style="text-align:center; font-family:'Oswald', sans-serif; margin-top:10px; margin-bottom:20px; font-size: 1.1rem;">Vyber soutěž k administraci zápasů:</h2>
                <div class="katalog-list-wrapper">
                    <button class="action-btn katalog-item-btn btn-blue-league" onclick="window.selectAdminLeague('MS v hokeji')"><div class="katalog-item-title"><div class="kat-code-part">🏒</div><div class="kat-name-part">MS V HOKEJI</div></div><span class="katalog-item-arrow">➔</span></button>
                    <button class="action-btn katalog-item-btn btn-green-league" onclick="window.selectAdminLeague('MS ve fotbale')"><div class="katalog-item-title"><div class="kat-code-part">⚽</div><div class="kat-name-part">MS VE FOTBALE 2026</div></div><span class="katalog-item-arrow">➔</span></button>
                    <button class="action-btn katalog-item-btn btn-red-league" onclick="window.selectAdminLeague('Tipsport Extraliga')"><div class="katalog-item-title"><div class="kat-code-part">🏒</div><div class="kat-name-part">TIPSPORT EXTRALIGA</div></div><span class="katalog-item-arrow">➔</span></button>
                    <button class="action-btn katalog-item-btn btn-green-league" onclick="window.selectAdminLeague('Chance Liga')"><div class="katalog-item-title"><div class="kat-code-part">⚽</div><div class="kat-name-part">CHANCE LIGA</div></div><span class="katalog-item-arrow">➔</span></button>
                </div>
            `;
            return;
        }

        contentArea.innerHTML = '<div class="db-empty-msg">Načítám ligu ze stadionu...</div>';
        try {
            const lDoc = await getDoc(doc(window.db, 'ligy', activeAdminLeague));
            const lData = lDoc.exists() ? lDoc.data() : { vitez: '', strelec: '' };
            const inputId = activeAdminLeague.replace(/ /g, '_');

            let backBtnHtml = `<div style="display: flex; gap: 10px; margin-bottom: 20px;"><button class="nav-btn" onclick="window.selectAdminLeague(null)" style="background:#4b5563; width:auto; padding:6px 14px; text-transform:uppercase; margin:0;">⬅ Výběr ligy</button></div>`;
            let headerTitleHtml = `<h2 class="font-white" style="text-align:left; font-family:'Oswald', sans-serif; margin-bottom:15px; font-size:1.2rem;">⚙️ SPRÁVA ZÁPASŮ: ${activeAdminLeague.toUpperCase()}</h2>`;
            let roletkaZapasHtml = `<div class="bonus-collapse-box"><button class="bonus-collapse-trigger" onclick="const c = this.nextElementSibling; c.style.display = c.style.display === 'none' ? 'block' : 'none';"><span>➕ Přidání nového zápasu</span><span>▼</span></button><div class="bonus-collapse-content" style="display: none;"><div style="margin-bottom: 8px;"><label class="bonus-input-label">Domácí tým:</label><input type="text" id="admin-new-domaci" placeholder="Např. Itálie" class="bonus-text-input"></div><div style="margin-bottom: 8px;"><label class="bonus-input-label">Hostující tým:</label><input type="text" id="admin-new-hoste" placeholder="Např. Slovensko" class="bonus-text-input"></div><div style="margin-bottom: 12px;"><label class="bonus-input-label">Datum a čas zápasu:</label><input type="datetime-local" id="admin-new-datum" class="bonus-text-input" style="color-scheme: dark;"></div><div style="margin-bottom: 15px; display: flex; align-items: center; gap: 10px; padding: 5px 0;"><input type="checkbox" id="admin-new-isPlayoff" style="width: 20px; height: 20px; margin: 0; cursor: pointer; box-shadow: none; accent-color: #10b981;"><label for="admin-new-isPlayoff" style="color: #ffffff; font-size: 0.9rem; font-weight: bold; cursor: pointer; user-select: none;">🏆 Zápas PLAY-OFF</label></div><button class="action-btn btn-tip" onclick="window.adminCreateMatch('${activeAdminLeague}')" style="margin: 0 auto; display: block; width: auto; padding: 6px 14px;">VLOŽIT ZÁPAS</button></div></div>`;
            let roletkaGlobalHtml = `<div class="bonus-collapse-box" style="margin-bottom: 25px;"><button class="bonus-collapse-trigger" onclick="const c = this.nextElementSibling; c.style.display = c.style.display === 'none' ? 'block' : 'none';" style="color: #fbbf24; border-color: #fbbf24;"><span>🏆 Globální vyhodnocení turnaje</span><span>▼</span></button><div class="bonus-collapse-content" style="display: none;"><div class="bonus-grid-inputs"><div><label class="bonus-input-label">Celkový vítěz:</label><input type="text" id="admin-liga-vitez-${inputId}" value="${lData.vitez || ''}" placeholder="Reálný mistr" class="bonus-text-input"></div><div><label class="bonus-input-label">Nejlepší střelec:</label><input type="text" id="admin-liga-strelec-${inputId}" value="${lData.strelec || ''}" placeholder="Nejlepší střelec" class="bonus-text-input"></div></div><button id="btn-admin-save-global" class="action-btn btn-tip" onclick="window.saveLeagueGlobalResults('${activeAdminLeague}')" style="margin: 5px auto 0 auto; display: block; width: auto; padding: 6px 14px;">ZAPSAT</button></div></div>`;

            const snapshot = await getDocs(collection(window.db, 'ligy', activeAdminLeague, 'zapasy'));
            if (snapshot.empty) {
                contentArea.innerHTML = backBtnHtml + headerTitleHtml + roletkaZapasHtml + roletkaGlobalHtml + '<h3 style="color:#fff; font-size:1rem; margin-bottom:10px; text-align:left; font-family:\'Oswald\', sans-serif;">⚽ AKTUÁLNÍ ZÁPASY</h3><div class="db-empty-msg">V této soutěži zatím nejsou vytvořené žádné zápasy.</div>';
                return;
            }

            let zZapasy = [];
            snapshot.forEach(docSnap => { zZapasy.push({ id: docSnap.id, ...docSnap.data() }); });
            zZapasy.sort((a, b) => (a.datum?.toDate ? a.datum.toDate() : 0) - (b.datum?.toDate ? b.datum.toDate() : 0));

            let activeMatchesHtml = ''; let evaluatedMatchesHtml = '';
            zZapasy.forEach(match => {
                // 🧠 SENIORNÍ KONTROLA: Slovo "Neznámý" z databáze bereme jako prázdnou hodnotu i v Admin panelu
                const jeDomaciNull = !match.domaci || match.domaci === 'null' || String(match.domaci).trim() === '' || String(match.domaci).trim().toLowerCase() === 'neznámý';
                const jeHosteNull = !match.hoste || match.hoste === 'null' || String(match.hoste).trim() === '' || String(match.hoste).trim().toLowerCase() === 'neznámý';
                
                // Dokud není znám aspoň jeden reálný soupeř, zápas neschováváme, ale úplně ho ignorujeme
                if (jeDomaciNull && jeHosteNull) return;
                if (jeDomaciNull) match.domaci = 'Neznámý'; if (jeHosteNull) match.hoste = 'Neznámý';

                const matchId = match.id;
                const resDomaci = match.vysledek_domaci !== undefined ? match.vysledek_domaci : '';
                const resHoste = match.vysledek_hoste !== undefined ? match.vysledek_hoste : '';
                const isSaved = match.vysledek_domaci !== undefined;

                let datumText = 'Již brzy'; let inputDatumIso = '';
                if (match.datum && typeof match.datum.toDate === 'function') {
                    const dObj = match.datum.toDate();
                    datumText = dObj.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
                    const tzOffset = dObj.getTimezoneOffset() * 60000;
                    inputDatumIso = (new Date(dObj - tzOffset)).toISOString().slice(0, 16);
                }

                let realResultHtml = isSaved ? `<span class="user-tip-value result-value-color">${match.vysledek_domaci} : ${match.vysledek_hoste}${match.isPlayoff && match.vysledek_domaci === match.vysledek_hoste && match.postup ? '*' : ''}</span>` : `<span class="user-tip-value no-tip">? : ?</span>`;
                let showAdminPlayoff = (match.isPlayoff && resDomaci !== '' && resHoste !== '' && parseInt(resDomaci) === parseInt(resHoste));
                let adminSavedPostup = match.postup || '';

                let playoffAdminRowHtml = `<div id="playoff-admin-box-${matchId}" style="grid-column: span 3; display: ${showAdminPlayoff ? 'flex' : 'none'}; gap: 8px; margin-top: 8px; width: 100%;"><button id="playoff-admin-dom-${matchId}" style="flex:1; height:34px; border-radius:6px; font-weight:bold; font-size:0.8rem; cursor:pointer; border:1px solid #4b5563; background:${adminSavedPostup === 'domaci' ? '#1e3a8a' : '#111827'}; color:${adminSavedPostup === 'domaci' ? '#fff' : '#9ca3af'};" onclick="window.selectPlayoffAdmin('${matchId}', 'domaci')">🏆 POSTUPUJE: ${match.domaci}</button><button id="playoff-admin-hos-${matchId}" style="flex:1; height:34px; border-radius:6px; font-weight:bold; font-size:0.8rem; cursor:pointer; border:1px solid #4b5563; background:${adminSavedPostup === 'hoste' ? '#1e3a8a' : '#111827'}; color:${adminSavedPostup === 'hoste' ? '#fff' : '#9ca3af'};" onclick="window.selectPlayoffAdmin('${matchId}', 'hoste')">🏆 POSTUPUJE: ${match.hoste}</button><input type="hidden" id="playoff-admin-val-${matchId}" value="${adminSavedPostup || ''}"></div>`;
                let advancedAdminRowHtml = `<div id="manage-admin-box-${matchId}" style="grid-column: span 3; display: none; background: #0f172a; padding: 12px; border-radius: 8px; border: 1px solid #374151; margin-top: 4px; width: 100%; box-sizing: border-box;"><div style="display: flex; flex-direction: column; gap: 10px;"><div style="display: flex; flex-direction: column; gap: 4px;"><label class="bonus-input-label" style="text-align: left;">Upravit datum a čas zápasu:</label><div style="display: flex; gap: 6px; align-items: center;"><input type="datetime-local" id="admin-edit-datum-${matchId}" value="${inputDatumIso}" class="bonus-text-input" style="color-scheme: dark; height: 36px; padding: 4px 8px; margin: 0; flex: 1;"><button class="btn-tip" style="height: 36px; width: auto; padding: 0 12px; background: #2563eb; font-size: 0.75rem;" onclick="window.updateMatchDate('${matchId}')">ULOŽIT ČAS</button></div></div><div style="border-top: 1px dashed #374151; padding-top: 8px; display: flex; justify-content: space-between; align-items: center;"><span style="color: #ef4444; font-size: 0.75rem; font-weight: bold;">⚠️ Nezvratná akce:</span><button class="btn-tip" style="height: 34px; width: auto; padding: 0 12px; background: #dc2626; font-size: 0.75rem;" onclick="window.deleteMatch('${matchId}')">🗑️ SMAZAT ZÁPAS</button></div></div></div>`;

                let matchHtml = `<div class="zebra-block tip-row"><div class="match-info"><span class="match-date" style="cursor: pointer; user-select: none; display: inline-flex; align-items: center; gap: 4px;" onclick="const el = document.getElementById('manage-admin-box-${matchId}'); el.style.display = el.style.display === 'none' ? 'block' : 'none';">📅 ${datumText} <span style="color: #38bdf8; font-size: 0.85rem;">⚙️</span> ${match.isPlayoff ? '<span style="color:#fbbf24; font-size:0.7rem; font-weight:bold;">🏆 PLAY-OFF</span>' : ''}</span><div class="match-teams">${match.domaci} – ${match.hoste}</div></div><div style="display: flex; align-items: center; justify-content: space-between; width: 190px; flex-shrink: 0; box-sizing: border-box; margin: 0; padding: 0;"><div class="user-tip-box admin-result-box"><div class="user-tip-label result-label-color">Výsledek ${isSaved ? '<span style="color:#34d399; font-weight:bold;">✔</span>' : ''}</div>${realResultHtml}</div><div class="action-inputs"><select id="admin-res-domaci-${matchId}" class="select-score" onchange="window.handleAdminScoreChange('${matchId}', ${match.isPlayoff || false})">${generujMožnostiAdmin(resDomaci)}</select><span class="select-divider">:</span><select id="admin-res-hoste-${matchId}" class="select-score" onchange="window.handleAdminScoreChange('${matchId}', ${match.isPlayoff || false})">${generujMožnostiAdmin(resHoste)}</select></div><button class="btn-tip" onclick="window.saveRealResult('${matchId}')">${isSaved ? 'ZMĚŇ' : 'ULOŽ'}</button></div>${playoffAdminRowHtml}${advancedAdminRowHtml}</div>`;
                if (isSaved) evaluatedMatchesHtml += matchHtml; else activeMatchesHtml += matchHtml;
            });

            if (evaluatedMatchesHtml) contentArea.innerHTML += `<div class="bonus-collapse-box" style="margin-top: 5px; margin-bottom: 20px;"><button class="bonus-collapse-trigger" onclick="const c = this.nextElementSibling; const isHidden = c.style.display === 'none'; c.style.display = isHidden ? 'block' : 'none'; this.querySelector('.arrow').innerText = isHidden ? '▲' : '▼';" style="color: #9ca3af; border-color: #374151;"><span>✅ ODEHRANÉ ZÁPASY</span><span class="arrow">▼</span></button><div class="bonus-collapse-content" style="display: none; padding: 10px 0; border: none; background: transparent; display: flex; flex-direction: column; gap: 8px;">${evaluatedMatchesHtml}</div></div>`;
            let activeGroupHtml = '<h3 style="color:#fff; font-size:1rem; margin-bottom:10px; text-align:left; font-family:\'Oswald\', sans-serif;">⚽ AKTUÁLNÍ ZÁPASY</h3>';
            if (!activeMatchesHtml) activeGroupHtml += '<div class="db-empty-msg">Žádné aktivní zápasy k vyhodnocení.</div>'; else activeGroupHtml += `<div style="display:flex; flex-direction:column; gap:8px;">${activeMatchesHtml}</div>`;
            contentArea.innerHTML += activeGroupHtml;
            autoSmrskniPismoTymu('#adminMatchesContainer');
        } catch (e) { console.error(e); contentArea.innerHTML = '<div class="err-box">❌ Selhal import dat.</div>'; }
    }

    // --- TAB 2: MODERNI ACCORDION SOUPISKA HRÁČŮ ---
    else if (tab === 'users') {
        contentArea.innerHTML = '<div class="db-empty-msg">Načítám soupisku dravých tipérů... ⏳</div>';
        try {
            const snapshot = await getDocs(collection(window.db, 'users'));
            contentArea.innerHTML = `
                <div style="margin-bottom: 12px; padding: 2px 0;"><p style="color: #9ca3af; font-size: 0.82rem; margin: 0; line-height: 1.4; text-align: left;">Správa přístupů do jednotlivých tipovaček. Kliknutím na jméno hráče rozbalíš jeho roletu se soutěžemi. Změny se ukládají ihned.</p></div>
                <div id="adminUsersRoletyWrapper" style="display: flex; flex-direction: column; gap: 8px; width: 100%;"></div>
            `;
            const wrapper = document.getElementById('adminUsersRoletyWrapper');
            let counter = 0;

            snapshot.forEach((uDoc) => {
                const data = uDoc.data();
                const uid = uDoc.id;
                if (uid === 'tfLmfp1twLbcFsxWrgNkZ7iQRC22') return; // Ochrana Super Admina

                counter++;
                const leagues = data.leagues || [];
                const zebraBg = counter % 2 === 0 ? '#1f2937' : '#111827';

                const userRow = document.createElement('div');
                userRow.className = 'leaderboard-row-wrapper';
                userRow.style.width = '100%';
                userRow.innerHTML = `
                    <div onclick="const det = this.nextElementSibling; const arr = this.querySelector('.admin-arrow-icon'); if(det.style.display==='none'){det.style.display='flex'; arr.innerText='▲';}else{det.style.display='none'; arr.innerText='▼';}" 
                         class="leaderboard-row-trigger" style="background: ${zebraBg}; border-color: #374151; cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; border-radius: 8px;">
                        <div class="leaderboard-row-left"><span class="leaderboard-row-nickname" style="color: #ffffff; font-weight: bold; font-family: 'Oswald', sans-serif; letter-spacing:0.3px;">${data.nickname || 'Nový Hráč'}</span></div>
                        <div class="leaderboard-row-right" style="display: flex; align-items: center; gap: 4px;">
                            <span style="font-size: 0.72rem; color: #9ca3af; margin-right: 4px;">(${leagues.length} akt.)</span>
                            <span class="admin-arrow-icon" style="color: #9ca3af; font-size: 0.78rem;">▼</span>
                        </div>
                    </div>
                    <div class="leaderboard-row-dropdown" style="display: none; background: #0f172a; border: 1px solid #374151; border-top: none; padding: 12px 15px; border-radius: 0 0 8px 8px; margin-top: -4px; flex-direction: column; gap: 10px; text-align: left;">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; font-size: 0.85rem; color: #e5e7eb;"><input type="checkbox" ${leagues.includes('MS v hokeji') ? 'checked' : ''} onchange="window.toggleUserLeague('${uid}', 'MS v hokeji', this.checked)" style="width: 16px; height: 16px; cursor: pointer; accent-color: #10b981; margin: 0;"> 🏒 MS V HOKEJI</label>
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; font-size: 0.85rem; color: #e5e7eb;"><input type="checkbox" ${leagues.includes('MS ve fotbale') ? 'checked' : ''} onchange="window.toggleUserLeague('${uid}', 'MS ve fotbale', this.checked)" style="width: 16px; height: 16px; cursor: pointer; accent-color: #10b981; margin: 0;"> ⚽ MS VE FOTBALE</label>
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; font-size: 0.85rem; color: #e5e7eb;"><input type="checkbox" ${leagues.includes('Tipsport Extraliga') ? 'checked' : ''} onchange="window.toggleUserLeague('${uid}', 'Tipsport Extraliga', this.checked)" style="width: 16px; height: 16px; cursor: pointer; accent-color: #10b981; margin: 0;"> 🏒 TIPSPORT EXTRALIGA</label>
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; font-size: 0.85rem; color: #e5e7eb;"><input type="checkbox" ${leagues.includes('Chance Liga') ? 'checked' : ''} onchange="window.toggleUserLeague('${uid}', 'Chance Liga', this.checked)" style="width: 16px; height: 16px; cursor: pointer; accent-color: #10b981; margin: 0;"> ⚽ CHANCE LIGA</label>
                    </div>
                `;
                wrapper.appendChild(userRow);
            });
            if (counter === 0) wrapper.innerHTML = '<div class="db-empty-msg">Na soupisce nejsou žádní hráči.</div>';
        } catch (e) {
            console.error(e);
            contentArea.innerHTML = '<div class="err-box">❌ Selhal import soupisky.</div>';
        }
    }
};

// ADMIN: ÚPRAVA DATUMU ZÁPASU
window.updateMatchDate = async (matchId) => {
    const activeAdminLeague = Alpine.store('appState')?.selectedAdminLeague;
    const newVal = document.getElementById(`admin-edit-datum-${matchId}`).value;
    if (!newVal || !activeAdminLeague) {
        alert("Musíš vybrat platné datum a čas! 📅");
        return;
    }
    try {
        await updateDoc(doc(window.db, 'ligy', activeAdminLeague, 'zapasy', matchId), {
            datum: Timestamp.fromDate(new Date(newVal))
        });
        window.showToast("📅 Čas zápasu úspěšně upraven!");
        window.renderAdminMatches();
    } catch (e) {
        alert("Chyba úpravy data: " + e.message);
    }
};

// ADMIN: SMAZÁNÍ ZÁPASU VČETNĚ JEHO TIPŮ
window.deleteMatch = (matchId) => {
    const activeAdminLeague = Alpine.store('appState')?.selectedAdminLeague;
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
            const q = query(collection(window.db, 'ligy', activeAdminLeague, 'tipy'), where('matchId', '==', matchId));
            const tipsSnapshot = await getDocs(q);
            const smazatTipySliby = [];
            tipsSnapshot.forEach(docSnap => { smazatTipySliby.push(deleteDoc(docSnap.ref)); });
            await Promise.all(smazatTipySliby);

            await deleteDoc(doc(window.db, 'ligy', activeAdminLeague, 'zapasy', matchId));
            window.showToast("🗑️ Zápas i uložené tipy kompletně vymazány!");
            window.renderAdminMatches();
        } catch (e) {
            alert("Chyba při promazávání databáze: " + e.message);
        }
    };
};

// ADMIN: RUČNÍ ZALOŽENÍ ZÁPASU
window.adminCreateMatch = async (leagueName) => {
    const domaci = document.getElementById('admin-new-domaci').value.trim();
    const hoste = document.getElementById('admin-new-hoste').value.trim();
    const datumVal = document.getElementById('admin-new-datum').value;
    const isPlayoff = document.getElementById('admin-new-isPlayoff').checked;

    if (!domaci || !hoste || !datumVal) {
        alert("Musíš vyplnit kompletní údaje pro založení zápasu! 🧐");
        return;
    }

    try {
        await setDoc(doc(collection(window.db, 'ligy', leagueName, 'zapasy')), {
            domaci: domaci,
            hoste: hoste,
            datum: Timestamp.fromDate(new Date(datumVal)),
            isPlayoff: isPlayoff
        });

        window.showToast("➕ Nový zápas úspěšně vytvořen!");
        window.renderAdminMatches();
    } catch (e) {
        alert("Chyba zakládání zápasu: " + e.message);
    }
};

// ADMIN: ZÁPIS CELKOVÝCH MISTRŮ
window.saveLeagueGlobalResults = async (leagueName) => {
    const inputId = leagueName.replace(/ /g, '_');
    const vitez = document.getElementById(`admin-liga-vitez-${inputId}`).value.trim();
    const strelec = document.getElementById(`admin-liga-strelec-${inputId}`).value.trim();

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
    const activeAdminLeague = Alpine.store('appState')?.selectedAdminLeague;
    if (!activeAdminLeague) return;

    const valDomaci = document.getElementById(`admin-res-domaci-${matchId}`).value;
    const valHoste = document.getElementById(`admin-res-hoste-${matchId}`).value;

    if (valDomaci === "" && valHoste === "") {
        try {
            await updateDoc(doc(window.db, 'ligy', activeAdminLeague, 'zapasy', matchId), {
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
        await updateDoc(doc(window.db, 'ligy', activeAdminLeague, 'zapasy', matchId), {
            vysledek_domaci: dVal,
            vysledek_hoste: hVal,
            postup: postupVal,
            apiStatus: "FINISHED"
        });

        window.showToast("⚙️ Skóre uloženo!");
        window.renderAdminMatches();
    } catch (e) {
        console.error("Chyba zápisu skóre:", e);
    }
};

// REKAPITULACE PRAVIDEL
window.renderScoring = () => {
    const container = document.getElementById('scoringCardsContainer');
    if (!container) return;
    const leagueName = Alpine.store('appState')?.selectedLeague;
    
    if (leagueName === "MS ve fotbale") {
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
    if (!isPlayoff) return;
    const d = document.getElementById(`tip-domaci-${matchId}`).value;
    const h = document.getElementById(`tip-hoste-${matchId}`).value;
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
    document.getElementById(`playoff-user-val-${matchId}`).value = choice;
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

// A) PRO HRÁČE: HROMADNÉ UKLÁDÁNÍ TIPŮ (S GLOBÁLNÍM 15VTEŘINOVÝM ZÁMKEM)
window.saveAllUserTips = async (leagueName) => {
    const user = window.auth.currentUser;
    if (!user) return;

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
    const listSlibuFirebase = [];
    const ovlivneneMatchIds = [];

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

            listSlibuFirebase.push(
                setDoc(doc(window.db, 'ligy', leagueName, 'tipy', `${user.uid}_${matchId}`), {
                    userId: user.uid,
                    userEmail: user.email,
                    matchId: matchId,
                    tip_domaci: dVal,
                    tip_hoste: hVal,
                    postup: postupVal,
                    vytvoreno: serverTimestamp()
                })
            );
            ovlivneneMatchIds.push(matchId);
            citacNovychTipu++;
        }
    });

    if (citacNovychTipu === 0) {
        window.showToast("⚠️ Navol nejprve v roletkách nějaké výsledky!", true);
        return;
    }

    const hromadnyBtn = document.getElementById('global-save-all-btn');
    if (hromadnyBtn) {
        hromadnyBtn.disabled = true;
        hromadnyBtn.style.opacity = "0.5";
        hromadnyBtn.innerText = "⏳ UKLÁDÁM...";
    }

    try {
        await Promise.all(listSlibuFirebase);

        const casUlozeni = Date.now();
        window.globalniTipoveCooldowny["HROMADNY_ZAPIS"] = casUlozeni;
        ovlivneneMatchIds.forEach(mId => {
            window.globalniTipoveCooldowny[mId] = casUlozeni;
        });

        window.showToast(`⚡ Bleskově uloženo ${citacNovychTipu} tipů najednou!`);
        window.renderMatches(leagueName);
    } catch (e) {
        console.error("Chyba hromadného tipování:", e);
        window.showToast("❌ Server odmítl hromadný zápis (App Check ochrana).", true);
        if (hromadnyBtn) {
            hromadnyBtn.disabled = false;
            hromadnyBtn.style.opacity = "1";
            hromadnyBtn.innerText = "🎯 ZAPSAT VŠE";
        }
    }
};

// B) PRO ADMINA: HROMADNÉ UKLÁDÁNÍ VÝSLEDKŮ
window.saveAllAdminResults = async () => {
    const container = document.getElementById('adminMatchesContainer');
    if (!container) return;

    const store = Alpine.store('appState');
    const activeAdminLeague = store ? store.selectedAdminLeague : null;
    if (!activeAdminLeague) return;

    const vsechnyRoletkyDomaci = container.querySelectorAll('[id^="admin-res-domaci-"]');
    let citacZapsanychVysledku = 0;
    const listSlibuFirebase = [];

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

            listSlibuFirebase.push(
                updateDoc(doc(window.db, 'ligy', activeAdminLeague, 'zapasy', matchId), {
                    vysledek_domaci: dVal,
                    vysledek_hoste: hVal,
                    postup: postupVal,
                    apiStatus: "FINISHED"
                })
            );
            citacZapsanychVysledku++;
        }
    });

    if (citacZapsanychVysledku === 0) {
        window.showToast("⚠️ Nebyly nalezeny žádné nové výsledky k zapsání!", true);
        return;
    }

    try {
        await Promise.all(listSlibuFirebase);
        window.showToast(`🎯 Hromadně zapsáno ${citacZapsanychVysledku} výsledků utkání!`);
        window.renderAdminMatches();
    } catch (e) {
        console.error("Chyba hromadného zápisu admina:", e);
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
                if (uid === 'tfLmfp1twLbcFsxWrgNkZ7iQRC22') return; // Ochrana tebe před sebepoškozením

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
                        <div style="border-top: 1px dashed #374151; padding-top: 12px; margin-top: 4px; display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: #e5e7eb; font-size: 0.85rem; font-weight: bold;">🎭 Správa tipů (Zpětný zápis):</span>
                            <button class="btn-tip" style="height: 32px; width: auto; padding: 0 12px; background: #ea580c; border: 1px solid #f97316; font-size: 0.72rem; font-weight:bold; font-family:'Oswald',sans-serif;" onclick="window.openLoutkovodicModal('${uid}', '${data.nickname?.replace(/'/g, "\\\\'") || 'Hráč'}', '${email}')">🎭 LOUTKOVODIČ</button>
                        </div>
                        <div style="border-top: 1px dashed #374151; padding-top: 12px; margin-top: 4px; display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: #9ca3af; font-size: 0.75rem; font-weight: bold;">🚨 Smazat kompletně data hráče:</span>
                            <button class="btn-tip" style="height: 32px; width: auto; padding: 0 12px; background: #dc2626; font-size: 0.72rem; font-weight:bold; font-family:'Oswald',sans-serif;" onclick="window.purgeUserAbsolute('${uid}', '${data.nickname?.replace(/'/g, "\\\\'") || 'Hráč'}')">🗑️ SMAZAT ÚČET</button>
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
                    <button class="action-btn" onclick="window.triggerTransferFeature()" style="background: #ea580c; color: white; width: 100%; font-weight: bold; font-family: 'Oswald', sans-serif; letter-spacing: 0.5px; border: 1px solid #f97316; height: 44px; font-size: 0.9rem; border-radius: 8px; margin-top: 5px;">
                        🚀 SPUSTIT TRANSFÉR BODŮ
                    </button>
                </div>
            </div>
        `;
    }
};

// 🌪️ SERVEROVÝ NUCLEAR PURGE BULDOZER: SMETAURACE ÚČTU Z AUTH I FIRESTORE POD PLNOU ROZVAHOU ADMIN SDK
window.purgeUserAbsolute = (uid, nickname) => {
    const modalOverlay = document.createElement('div');
    modalOverlay.style = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.85); z-index: 11000; display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);";

    modalOverlay.innerHTML = `
        <div style="background: #1f2937; border: 4px solid #dc2626; border-radius: 20px; padding: 30px 20px; max-width: 420px; width: 100%; text-align: center; box-shadow: 0 25px 60px rgba(0, 0, 0, 0.7); color: white; font-family: 'Segoe UI', sans-serif;">
            <h3 style="font-family: 'Oswald', sans-serif; color: #dc2626; font-size: 1.6rem; margin: 0 0 15px 0; text-transform: uppercase; letter-spacing: 1px;">🚨 SERVEROVÝ PURGE HRÁČE</h3>
            <p style="font-size: 0.95rem; color: #9ca3af; line-height: 1.5; margin: 0 0 25px 0;">
                Opravdu chceš trvale zničit účet hráče <span style="color: #ffffff; font-weight: bold;">${nickname}</span>?<br>
                <span style="color: #f87171; font-weight: bold;">Tato akce přes Firebase Admin SDK smaže jeho profil z Auth modulu, online status a VŠECHNY jeho tipy i bonusy ze všech soutěží! Akce je nevratná.</span>
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
        const autoApproved = user.uid === 'tfLmfp1twLbcFsxWrgNkZ7iQRC22';

        // 👑 Očištěno od isApproved, noví uživatelé začínají s čistým prázdným polem leagues: []
        await setDoc(docRef, {
            userId: user.uid,
            email: user.email.trim().toLowerCase(),
            nickname: nickVal,
            isAdmin: autoApproved,
            leagues: autoApproved ? ['MS v hokeji', 'MS ve fotbale', 'Tipsport Extraliga', 'Chance Liga'] : [],
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

// 👁️ ŽIVÝ MODAL PRO JEDEN ZÁPAS (ČTE 1 PŘEDPŘIPRAVENÝ DOKUMENT OD BOTA SRAŽENÝ NA 1 READ NAMÍSTO 50!)
window.showSpyModal = async (matchId, matchTitle) => {
    const store = Alpine.store('appState');
    const leagueName = store ? store.selectedLeague : null;
    if (!leagueName) return;

    window.showToast("🔍 Sosám tipy z tribuny...", false);

    try {
        const docSnap = await getDoc(doc(window.db, 'ligy', leagueName, 'stav', `tipy_zapasu_${matchId}`));
        const rozpisSnap = await getDoc(doc(window.db, 'ligy', leagueName, 'stav', 'rozpis'));
        
        const zapasyMapa = rozpisSnap.exists() ? (rozpisSnap.data().zapasyMapa || {}) : {};
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
        const tipyProZapas = docSnap.exists() ? (docSnap.data().tipy || []) : [];

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
                let pPozn = (matchData.isPlayoff && t.tip_domaci === t.tip_hoste && t.postup) ? '*' : '';
                tipStr = `${t.tip_domaci} : ${t.tip_hoste}${pPozn}`;
                tipColor = '#ffffff';
                tipWeight = 'normal';
                
                if (isEvaluated) {
                    let pts = window.vypocitejBodyZapasu(t.tip_domaci, t.tip_hoste, matchData.vysledek_domaci, matchData.vysledek_hoste, leagueName, t.postup, matchData.postup, matchData.isPlayoff);
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
                    let pts = (leagueName === "MS ve fotbale") ? -1 : 0;
                    ptsStr = `(${pts >= 0 ? '+' : ''}${pts} b.)`;
                    ptsColor = pts < 0 ? '#f87171' : '#9ca3af';
                }
            }

            // 👑 DOKONALÉ SLOUČENÍ: Kopírujeme identickou strukturu řádku z historie včetně výšky a sloupců!
            rowsHtml += `
                <div class="${exactClass}" style="display: grid; grid-template-columns: 1fr 65px 75px; gap: 4px; padding: 10px 14px; align-items: center; text-align: center; ${bgStyle} box-sizing: border-box; width: 100%;">
                    <div style="${nickColorStyle} overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${hracNick}</div>
                    <div style="color: ${tipColor}; font-weight: ${tipWeight}; font-family: monospace; font-size: 0.95rem;">${tipStr}</div>
                    <div style="color: ${ptsColor}; font-weight: bold; font-size: 0.9rem;">${ptsStr}</div>
                </div>
            `;
        });

        let scoreBadge = '';
        if (isEvaluated) {
            scoreBadge = ` (${matchData.vysledek_domaci}:${matchData.vysledek_hoste})`;
        } else if (matchData.apiStatus === "IN_PLAY" || matchData.apiStatus === "PAUSED") {
            let prubD = matchData.vysledek_domaci !== undefined ? matchData.vysledek_domaci : 0;
            let prubH = matchData.vysledek_hoste !== undefined ? matchData.vysledek_hoste : 0;
            scoreBadge = ` (${prubD}:${prubH})`;
        }

        // 📊 Centrovaný statistický panel
        let pDom = matchData.procentaDomaci !== undefined ? matchData.procentaDomaci : 0;
        let pRem = matchData.procentaRemiza !== undefined ? matchData.procentaRemiza : 0;
        let pHos = matchData.procentaHoste !== undefined ? matchData.procentaHoste : 0;
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

        const overlay = document.createElement('div');
        overlay.className = 'spy-modal-overlay';
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        overlay.innerHTML = `
            <div class="spy-modal-box" style="max-width:390px; width:95%; max-height:80vh; display:flex; flex-direction:column; padding:0; overflow:hidden; background:#0b0f19;">
                <div class="spy-modal-header" style="flex-shrink:0; padding:15px; border-bottom:1px solid #374151; background:#111827; position:static;">
                    <h3 style="font-family:'Oswald',sans-serif; font-size:1.1rem; margin:0; letter-spacing:0.3px;">📋 Tipy: ${matchTitle}${scoreBadge}</h3>
                    <button class="spy-modal-close" style="font-size:1.3rem; top:12px; right:15px;" onclick="this.closest('.spy-modal-overlay').remove()">✕</button>
                </div>
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
            </div>
        `;
        document.body.appendChild(overlay);
    } catch (e) { console.error(e); }
};

// Bezpečnostní spouštěč transferového asistenta
window.triggerTransferFeature = () => {
    const stary = document.getElementById('transfer-old-email').value.trim();
    const novy = document.getElementById('transfer-new-email').value.trim();

    if (!stary || !novy) {
        window.showToast("⚠️ Musíš vyplnit oba e-maily pro přesun dat!", true);
        return;
    }
    
    alert(`🔮 PŘELÉVÁNÍ DAT SPUŠTĚNO:\n\nSystém lokalizuje staré ID pro ${stary}, sesbírá všechny existující tipy napříč soutěžemi a bezpečně je naočkuje pod nové ID účtu ${novy}.\n\n(Vizuální specifikace rozhraní je plně hotová!)`);
};

// 👑 ARCHITEKTONICKÝ INTERCEPTOR PRO SYSTÉMOVÉ TLAČÍTKO ZPĚT (HTML5 HISTORY API MONKEY-PATCH)
(() => {
    const puvodniGoToScreen = window.goToScreen;
    
    window.goToScreen = (screenName, pushToHistory = true) => {
        // 1. Spustíme originální přepnutí obrazovky z app.js
        if (typeof puvodniGoToScreen === 'function') {
            puvodniGoToScreen(screenName);
        } else {
            const store = Alpine.store('appState');
            if (store) store.currentScreen = screenName;
        }
        
        // 2. Úvodní obrazovky ignorujeme, historii začínáme tlačit až od výběru lig dál
        const ignorovatObrazovky = ['splashScreen', 'loginScreen', 'nicknameScreen'];
        if (pushToHistory && !ignorovatObrazovky.includes(screenName)) {
            window.history.pushState({ screen: screenName }, "");
        }
    };

    // 📱 Sledujeme hardwarové/systémové gesto nebo tlačítko zpět zespodu mobilu
    window.addEventListener('popstate', (event) => {
        const store = Alpine.store('appState');
        if (!store) return;

        // Pokud je uživatel na úplném začátku (Katalog lig), dovolíme mu z aplikace normálně odejít
        if (store.currentScreen === 'leaguesScreen') {
            return; 
        }

        // Pokud je kdekoli hlouběji (zápasy, pořadí), vrátíme ho tichým způsobem zpět
        const navratovaObrazovka = (event.state && event.state.screen) ? event.state.screen : 'leaguesScreen';
        window.goToScreen(navratovaObrazovka, false); // 'false' je klíčové, abychom se nezacyklili
    });
})();

// =========================================================================
// 🎭 LOUTKOVODIČ INTERFACE: NEPRŮSTŘELNÝ FIXED-HEADER MODAL PRO ZPĚTNÝ ZÁPIS
// =========================================================================
window.openLoutkovodicModal = (uid, nickname, email) => {
    const overlay = document.createElement('div');
    overlay.className = 'spy-modal-overlay';
    overlay.id = 'loutkovodic-modal';
    overlay.innerHTML = `
        <div class="spy-modal-box" style="max-width: 460px; width: 95%; max-height: 85vh; display: flex; flex-direction: column; border: 2px solid #ea580c; box-shadow: 0 0 25px rgba(234, 88, 12, 0.4); padding: 0; overflow: hidden;">
            
            <div class="spy-modal-header" style="flex-shrink: 0; border-bottom: 1px solid #c2410c; background: #2c1a10; display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; position: static;">
                <h3 style="margin: 0; font-size: 1.1rem;">🎭 Loutkovodič: ${nickname}</h3>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div id="proxy-header-action-holder"></div>
                    <button class="spy-modal-close" style="position: static; margin: 0; font-size: 1.3rem;" onclick="this.closest('.spy-modal-overlay').remove()">✕</button>
                </div>
            </div>

            <div style="padding: 12px 15px; background: #1f2937; border-bottom: 1px solid #374151; flex-shrink: 0; text-align: left;">
                <label class="bonus-input-label" style="display:block; margin-bottom:5px; font-weight: bold; color: #ea580c; font-size: 0.8rem;">Zvolit soutěž pro proxy zápis:</label>
                <select id="proxy-league-select" class="bonus-text-input" style="width:100%; height:40px; background:#111827; color:#fff; border-color: #4b5563; font-weight: bold;" onchange="window.loadLoutkovodicLeagueData('${uid}', '${email}', this.value)">
                    <option value="" selected disabled>-- Vyber ligu ze stadionu --</option>
                    <option value="MS v hokeji">🏒 MS V HOKEJI</option>
                    <option value="MS ve fotbale">⚽ MS VE FOTBALE</option>
                    <option value="Tipsport Extraliga">🏒 TIPSPORT EXTRALIGA</option>
                    <option value="Chance Liga">⚽ CHANCE LIGA</option>
                </select>
            </div>

            <div id="proxy-modal-body-content" class="spy-modal-body" style="flex: 1; overflow-y: auto; padding: 15px; background: #0b0f19; display: flex; flex-direction: column; gap: 8px;">
                <div class="db-empty-msg" style="color: #6b7280; padding: 40px 0; text-align: center; width: 100%;">Nejprve vyber ligu v roletce nahoře... 👆</div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
};

window.loadLoutkovodicLeagueData = async (uid, email, leagueName) => {
    const contentArea = document.getElementById('proxy-modal-body-content');
    const actionHolder = document.getElementById('proxy-header-action-holder');
    if (!contentArea || !leagueName) return;

    contentArea.innerHTML = '<div class="db-empty-msg" style="color:#ea580c; text-align: center; padding: 30px 0; width:100%;">🔍 Stahuji historické složky hráče... ⏳</div>';
    if (actionHolder) actionHolder.innerHTML = '';

    try {
        const [rozpisSnap, bonusSnap, tipySnap] = await Promise.all([
            getDoc(doc(window.db, 'ligy', leagueName, 'stav', 'rozpis')),
            getDoc(doc(window.db, 'ligy', leagueName, 'bonusy', uid)),
            getDocs(query(collection(window.db, 'ligy', leagueName, 'tipy'), where('userId', '==', uid)))
        ]);

        if (!rozpisSnap.exists()) {
            contentArea.innerHTML = '<div class="db-empty-msg" style="color:#ef4444; text-align: center; width:100%;">Soutěž nemá vypsaný centrální rozpis zápasů!</div>';
            return;
        }

        // 👑 PINUJEME TLAČÍTKO NAHORU: Vstříkneme ho do fixního záhlaví a parametry schováme do datasetu
        if (actionHolder) {
            actionHolder.innerHTML = `
                <button id="proxy-submit-btn" class="action-btn" 
                        data-uid="${uid}" data-email="${email}" data-league="${leagueName}"
                        style="background: #2563eb; color: #fff; height: 32px; padding: 0 12px; font-weight: bold; font-size: 0.72rem; border: 1px solid #60a5fa; border-radius: 6px; cursor: pointer; text-transform: uppercase; font-family: 'Oswald', sans-serif; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: inline-flex; align-items: center; justify-content: center; margin: 0;"
                        onclick="window.submitProxyData()">
                    💾 ZAPSAT
                </button>
            `;
        }

        const zapasyMapa = rozpisSnap.data().zapasyMapa || {};
        const bonusData = bonusSnap.exists() ? bonusSnap.data() : { vitez: '', strelec: '' };
        
        const existujiciTipy = {};
        tipySnap.forEach(d => { existujiciTipy[d.data().matchId] = d.data(); });

        let serazeneZapasy = Object.keys(zapasyMapa).map(id => ({ id, ...zapasyMapa[id] }));
        serazeneZapasy.sort((a, b) => {
            const dA = a.datum?.toDate ? a.datum.toDate() : new Date(a.datum);
            const dB = b.datum?.toDate ? b.datum.toDate() : new Date(b.datum);
            return dA - dB;
        });

        let html = `
            <div style="background:#111827; padding:12px; border-radius:8px; border:1px solid #374151; margin-bottom:5px; text-align: left; width: 100%; box-sizing: border-box;">
                <h4 style="color:#fbbf24; margin:0 0 10px 0; font-family:'Oswald',sans-serif; font-size:0.85rem; letter-spacing: 0.3px;">🎁 ŠAMPIONÁTOVÉ BONUSY</h4>
                <div style="display:flex; gap:10px;">
                    <div style="flex:1;">
                        <label class="bonus-input-label" style="font-size:0.7rem; color:#9ca3af; display:block;">Celkový vítěz:</label>
                        <input type="text" id="proxy-vitez" value="${bonusData.vitez || ''}" class="bonus-text-input" style="height:34px; font-size:0.8rem; padding-left:8px; margin-top:2px; background:#0f172a; width: 100%; box-sizing: border-box;" placeholder="Zatím prázdné">
                    </div>
                    <div style="flex:1;">
                        <label class="bonus-input-label" style="font-size:0.7rem; color:#9ca3af; display:block;">Nejlepší střelec:</label>
                        <input type="text" id="proxy-strelec" value="${bonusData.strelec || ''}" class="bonus-text-input" style="height:34px; font-size:0.8rem; padding-left:8px; margin-top:2px; background:#0f172a; width: 100%; box-sizing: border-box;" placeholder="Zatím prázdné">
                    </div>
                </div>
            </div>
            <h4 style="color:#fff; margin:8px 0 2px 0; font-family:'Oswald',sans-serif; font-size:0.85rem; text-align: left; letter-spacing: 0.3px; width: 100%;">⚽ DETEKCE HISTORICKÝCH ZÁPASŮ</h4>
        `;

        serazeneZapasy.forEach(match => {
            const matchId = match.id;
            const tip = existujiciTipy[matchId];
            const vybranyDomaci = tip !== undefined ? tip.tip_domaci : '';
            const vybranyHoste = tip !== undefined ? tip.tip_hoste : '';
            const savedPostup = tip !== undefined ? tip.postup : '';
            
            let isEvaluated = (match.vysledek_domaci !== undefined && match.vysledek_hoste !== undefined);
            let statusBadge = isEvaluated 
                ? `<span style="color:#10b981; font-size:0.62rem; font-weight:bold; background:rgba(16,185,129,0.1); padding:2px 6px; border-radius:4px; border: 1px solid rgba(16,185,129,0.2);">✓ ODEHRANÉ (${match.vysledek_domaci}:${match.vysledek_hoste})</span>` 
                : `<span style="color:#38bdf8; font-size:0.62rem; font-weight:bold; background:rgba(56,189,248,0.1); padding:2px 6px; border-radius:4px; border: 1px solid rgba(56,189,248,0.2);">⏳ V ČEKÁRNĚ</span>`;

            html += `
                <div class="zebra-block" style="padding:10px; border-radius:6px; background:#111827; border:1px solid #374151; display:flex; flex-direction:column; gap:6px; width:100%; box-sizing: border-box;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="color:#9ca3af; font-size:0.68rem; font-family: monospace;">📅 ${new Date(match.datum?.toDate ? match.datum.toDate() : match.datum).toLocaleDateString('cs-CZ', {day:'numeric', month:'numeric', hour:'2-digit', minute:'2-digit'})}</span>
                        ${statusBadge}
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; text-align: left;">
                        <div style="color:#fff; font-size:0.85rem; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; font-family:'Oswald', sans-serif;">${match.domaci} – ${match.hoste}</div>
                        <div class="action-inputs" style="margin:0; flex-shrink:0; display: flex; align-items: center; gap: 2px;">
                            <select id="proxy-tip-domaci-${matchId}" class="select-score" style="height:32px; width:42px; background:#0f172a; color:#fff;" onchange="window.handleProxyScoreChange('${matchId}', ${match.isPlayoff || false})">
                                ${generujMožnostiAdmin(vybranyDomaci)}
                            </select>
                            <span class="select-divider" style="color:#4b5563; padding: 0 1px;">:</span>
                            <select id="proxy-tip-hoste-${matchId}" class="select-score" style="height:32px; width:42px; background:#0f172a; color:#fff;" onchange="window.handleProxyScoreChange('${matchId}', ${match.isPlayoff || false})">
                                ${generujMožnostiAdmin(vybranyHoste)}
                            </select>
                        </div>
                    </div>
                    <div id="proxy-playoff-box-${matchId}" style="display: ${match.isPlayoff && vybranyDomaci !== '' && parseInt(vybranyDomaci) === parseInt(vybranyHoste) ? 'flex' : 'none'}; gap: 6px; width: 100%; margin-top:2px;">
                        <button id="proxy-playoff-dom-${matchId}" style="flex:1; height:28px; border-radius:4px; font-weight:bold; font-size:0.7rem; cursor:pointer; border:1px solid #4b5563; background:${savedPostup === 'domaci' ? '#ea580c' : '#1f2937'}; color:${savedPostup === 'domaci' ? '#fff' : '#9ca3af'};" onclick="window.selectProxyPlayoff('${matchId}', 'domaci')">👉 ${match.domaci}</button>
                        <button id="proxy-playoff-hos-${matchId}" style="flex:1; height:28px; border-radius:4px; font-weight:bold; font-size:0.7rem; cursor:pointer; border:1px solid #4b5563; background:${savedPostup === 'hoste' ? '#ea580c' : '#1f2937'}; color:${savedPostup === 'hoste' ? '#fff' : '#9ca3af'};" onclick="window.selectProxyPlayoff('${matchId}', 'hoste')">${match.hoste} 👈</button>
                        <input type="hidden" id="proxy-playoff-val-${matchId}" value="${savedPostup || ''}">
                    </div>
                </div>
            `;
        });

        contentArea.innerHTML = html;

    } catch (err) {
        console.error(err);
        contentArea.innerHTML = '<div class="err-box" style="width:100%;">❌ Selhalo online spojení se složkou hráče.</div>';
    }
};

window.handleProxyScoreChange = (matchId, isPlayoff) => {
    if (!isPlayoff) return;
    const d = document.getElementById(`proxy-tip-domaci-${matchId}`).value;
    const h = document.getElementById(`proxy-tip-hoste-${matchId}`).value;
    const box = document.getElementById(`proxy-playoff-box-${matchId}`);
    if (box) {
        if (d !== "" && h !== "" && parseInt(d) === parseInt(h)) {
            box.style.display = 'flex';
        } else {
            box.style.display = 'none';
            document.getElementById(`proxy-playoff-val-${matchId}`).value = '';
            document.getElementById(`proxy-playoff-dom-${matchId}`).style.background = '#1f2937';
            document.getElementById(`proxy-playoff-dom-${matchId}`).style.color = '#9ca3af';
            document.getElementById(`proxy-playoff-hos-${matchId}`).style.background = '#1f2937';
            document.getElementById(`proxy-playoff-hos-${matchId}`).style.color = '#9ca3af';
        }
    }
};

window.selectProxyPlayoff = (matchId, choice) => {
    document.getElementById(`proxy-playoff-val-${matchId}`).value = choice;
    const btnDom = document.getElementById(`proxy-playoff-dom-${matchId}`);
    const btnHos = document.getElementById(`proxy-playoff-hos-${matchId}`);
    if (choice === 'domaci') {
        btnDom.style.background = '#ea580c'; btnDom.style.color = '#fff';
        btnHos.style.background = '#1f2937'; btnHos.style.color = '#9ca3af';
    } else {
        btnHos.style.background = '#ea580c'; btnHos.style.color = '#fff';
        btnDom.style.background = '#1f2937'; btnDom.style.color = '#9ca3af';
    }
};

window.submitProxyData = async () => {
    const btn = document.getElementById('proxy-submit-btn');
    if (!btn) return;

    // ⚡ SENIORNÍ BEZPEČNOST: Vytáhneme parametry čistě z datasetu, uvozovky už nemají šanci nic rozbít!
    const uid = btn.dataset.uid;
    const email = btn.dataset.email;
    const leagueName = btn.dataset.league;

    window.showToast("⏳ Vstřikuji proxy data přes Cloud...", false);

    const vitezEl = document.getElementById('proxy-vitez');
    const strelecEl = document.getElementById('proxy-strelec');
    const vitezVal = vitezEl ? vitezEl.value.trim() : '';
    const strelecVal = strelecEl ? strelecEl.value.trim() : '';

    const tipyMapa = {};
    const contentArea = document.getElementById('proxy-modal-body-content');
    const domaciSelects = contentArea.querySelectorAll('[id^="proxy-tip-domaci-"]');

    let chybajuciPostup = false;

    domaciSelects.forEach(selDom => {
        const matchId = selDom.id.replace('proxy-tip-domaci-', '');
        const selHos = document.getElementById(`proxy-tip-hoste-${matchId}`);
        
        const dVal = selDom.value;
        const hVal = selHos ? selHos.value : '';

        if (dVal !== "" && hVal !== "") {
            const hiddenInput = document.getElementById(`proxy-playoff-val-${matchId}`);
            let postupVal = hiddenInput ? hiddenInput.value : '';

            if (parseInt(dVal) === parseInt(hVal) && hiddenInput && !postupVal) {
                chybajuciPostup = true;
            }

            tipyMapa[matchId] = {
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

    // Vizuální zámek horního tlačítka
    btn.disabled = true;
    btn.style.opacity = "0.5";
    btn.innerText = "⏳...";

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
        const modal = document.getElementById('loutkovodic-modal');
        if (modal) modal.remove();

    } catch (err) {
        console.error(err);
        window.showToast("❌ Server proxy zápis odmítl.", true);
        btn.disabled = false;
        btn.style.opacity = "1";
        btn.innerText = "💾 ZAPSAT";
    }
};