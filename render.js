// =========================================================================
// 🎨 TIPNI TO! - VYKRESLOVÁNÍ DAT, TIPŮ A FILTROVANÉHO ŽEBŘÍČKU (render.js)
// =========================================================================

import { doc, collection, onSnapshot, query, where, getDocs, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp, deleteField } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

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
    const container = document.querySelector('#matchesScreen .zebra-container');
    if (!container) return;

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

                const headerRight = document.querySelector('#globalHeader .header-right');
                if (headerRight) {
                    if (klientskeZapasy.length > 0) {
                        headerRight.style.width = "auto";
                        headerRight.style.display = "flex";
                        headerRight.innerHTML = `
                            <button id="global-save-all-btn" onclick="window.saveAllUserTips('${leagueName}')" style="background: #2563eb; color: #fff; height: 36px; padding: 0 10px; font-weight: bold; font-size: 0.72rem; border: 1px solid #60a5fa; border-radius: 6px; cursor: pointer; text-transform: uppercase; font-family: 'Oswald', sans-serif; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; margin: 0;">
                                🎯 ZAPSAT VŠE
                            </button>
                        `;
                    } else {
                        headerRight.style.width = "";
                        headerRight.innerHTML = '';
                    }
                }

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
                    const jeDomaciNull = !match.domaci || match.domaci === 'null' || String(match.domaci).trim() === '';
                    const jeHosteNull = !match.hoste || match.hoste === 'null' || String(match.hoste).trim() === '';

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
                            if (leagueName === "MS ve fotbale" || leagueName === "MS ve fotbale 2026") {
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
                    let procentaBarHtml = '';
                        if (match.procentaDomaci !== undefined && (match.procentaDomaci > 0 || match.procentaRemiza > 0 || match.procentaHoste > 0)) {
                            procentaBarHtml = `
                                <div class="match-spy-consensus" style="margin-top: 4px; font-size: 0.7rem; color: #9ca3af; background: transparent; padding: 0; border: none; box-shadow: none;">
                                    📊 Skupina: <span class="match-spy-consensus-value">${match.procentaDomaci}%</span> – <span class="match-spy-consensus-value">${match.procentaRemiza}%</span> – <span class="match-spy-consensus-value">${match.procentaHoste}%</span>
                                </div>
                            `;
                        }

                        matchRow.innerHTML = `
                            <div class="match-info">
                                <span class="match-date">📅 ${datumText} ${match.isPlayoff ? '<span style="color:#fbbf24; font-size:0.7rem; font-weight:bold; margin-left:4px; margin-right:4px;">🏆 PLAY-OFF</span>' : ''}${spyEyeHtml}</span>
                                <div class="match-teams">${match.domaci} – ${match.hoste}</div>
                                ${procentaBarHtml}
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

    const headerRight = document.querySelector('#globalHeader .header-right');
    if (headerRight) { headerRight.style.width = ""; headerRight.innerHTML = ''; }
    const container = document.querySelector('#leaderboardScreen .zebra-container');
    if (!container) return;

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
            contentArea.innerHTML = '<div class="err-box">❌ Selhalo živé spojení se stadionem.</div>';
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
            if (!t) return; 

            let isEvaluated = (zap.vysledek_domaci !== undefined && zap.vysledek_hoste !== undefined && zap.apiStatus !== "IN_PLAY" && zap.apiStatus !== "PAUSED");
            let resStr = isEvaluated ? `${zap.vysledek_domaci} : ${zap.vysledek_hoste}` : '? : ?';

            let exactClass = '';
            let ptsStr = '-';
            let ptsColor = '#9ca3af';

            if (isEvaluated) {
                const pts = window.vypocitejBodyZapasu(t.tip_domaci, t.tip_hoste, zap.vysledek_domaci, zap.vysledek_hoste, leagueName, t.postup, zap.postup, zap.isPlayoff);
                ptsStr = `(${pts >= 0 ? '+' : ''}${pts} b.)`;
                ptsColor = pts < 0 ? '#f87171' : (pts > 0 ? '#34d399' : '#9ca3af');
                if (pts === 6) exactClass = 'exact-tip';
            }

            let pPozn = (zap.isPlayoff && t.tip_domaci === t.tip_hoste && t.postup) ? '*' : '';
            let tipStr = `${t.tip_domaci} : ${t.tip_hoste}${pPozn}`;

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

// ADMIN: VYKRESLENÍ ZÁPASŮ PRO SPRÁVU (V11 MODULÁRNÍ INTEGRACE)
window.renderAdminMatches = async () => {
    const container = document.getElementById('adminMatchesContainer');
    if (!container) return;

    const store = Alpine.store('appState');
    if (!store || !store.isAdmin) {
        window.goToScreen('leaguesScreen');
        return;
    }

    const activeAdminLeague = store.selectedAdminLeague;

    const headerRight = document.querySelector('#globalHeader .header-right');
    if (headerRight) {
        headerRight.style.width = "";
        headerRight.innerHTML = '';
    }

    if (!activeAdminLeague) {
        container.innerHTML = `
            <h2 class="font-white" style="text-align:center; font-family:'Oswald', sans-serif; margin-bottom:20px;">Vyber soutěž k administraci:</h2>
            <div class="katalog-list-wrapper">
                <button class="action-btn katalog-item-btn btn-blue-league" onclick="window.selectAdminLeague('MS v hokeji')">
                    <div class="katalog-item-title"><div class="kat-code-part">🏒</div><div class="kat-name-part">MS V HOKEJI</div></div>
                    <span class="katalog-item-arrow">➔</span>
                </button>
                <button class="action-btn katalog-item-btn btn-green-league" onclick="window.selectAdminLeague('MS ve fotbale')">
                    <div class="katalog-item-title"><div class="kat-code-part">⚽</div><div class="kat-name-part">MS VE FOTBALE 2026</div></div>
                    <span class="katalog-item-arrow">➔</span>
                </button>
                <button class="action-btn katalog-item-btn btn-red-league" onclick="window.selectAdminLeague('Tipsport Extraliga')">
                    <div class="katalog-item-title"><div class="kat-code-part">🏒</div><div class="kat-name-part">TIPSPORT EXTRALIGA</div></div>
                    <span class="katalog-item-arrow">➔</span>
                </button>
                <button class="action-btn katalog-item-btn btn-green-league" onclick="window.selectAdminLeague('Chance Liga')">
                    <div class="katalog-item-title"><div class="kat-code-part">⚽</div><div class="kat-name-part">CHANCE LIGA</div></div>
                    <span class="katalog-item-arrow">➔</span>
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = '<div class="db-empty-msg">Načítám ligu ze stadionu...</div>';

    try {
        const lDoc = await getDoc(doc(window.db, 'ligy', activeAdminLeague));
        const lData = lDoc.exists() ? lDoc.data() : { vitez: '', strelec: '' };
        const inputId = activeAdminLeague.replace(/ /g, '_');

        const adminHeaderRight = document.querySelector('#globalHeader .header-right');
        if (adminHeaderRight) {
            adminHeaderRight.style.width = "auto";
            adminHeaderRight.style.display = "flex";
            adminHeaderRight.innerHTML = `
                <button id="global-admin-save-btn" onclick="window.saveAllAdminResults()" style="background: #2563eb; color: #fff; height: 36px; padding: 0 10px; font-weight: bold; font-size: 0.72rem; border: 1px solid #60a5fa; border-radius: 6px; cursor: pointer; text-transform: uppercase; font-family: 'Oswald', sans-serif; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; margin: 0;">
                    🎯 ZAPSAT VŠE
                </button>
            `;
        }

        let backBtnHtml = `
            <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                <button class="nav-btn" onclick="window.selectAdminLeague(null)" style="background:#4b5563; width:auto; padding:6px 14px; text-transform:uppercase; margin:0;">⬅ Výběr ligy</button>
            </div>
        `;
        
        let headerTitleHtml = `<h2 class="font-white" style="text-align:left; font-family:'Oswald', sans-serif; margin-bottom:15px; font-size:1.4rem;">⚙️ SPRÁVA: ${activeAdminLeague.toUpperCase()}</h2>`;

        let roletkaZapasHtml = `
            <div class="bonus-collapse-box">
                <button class="bonus-collapse-trigger" onclick="const c = this.nextElementSibling; c.style.display = c.style.display === 'none' ? 'block' : 'none';">
                    <span>➕ Přidání nového zápasu</span><span>▼</span>
                </button>
                <div class="bonus-collapse-content" style="display: none;">
                    <div style="margin-bottom: 8px;">
                        <label class="bonus-input-label">Domácí tým:</label>
                        <input type="text" id="admin-new-domaci" placeholder="Např. Itálie" class="bonus-text-input">
                    </div>
                    <div style="margin-bottom: 8px;">
                        <label class="bonus-input-label">Hostující tým:</label>
                        <input type="text" id="admin-new-hoste" placeholder="Např. Slovensko" class="bonus-text-input">
                    </div>
                    <div style="margin-bottom: 12px;">
                        <label class="bonus-input-label">Datum a čas zápasu:</label>
                        <input type="datetime-local" id="admin-new-datum" class="bonus-text-input" style="color-scheme: dark;">
                    </div>
                    <div style="margin-bottom: 15px; display: flex; align-items: center; gap: 10px; padding: 5px 0;">
                        <input type="checkbox" id="admin-new-isPlayoff" style="width: 20px; height: 20px; margin: 0; cursor: pointer; box-shadow: none; accent-color: #10b981;">
                        <label for="admin-new-isPlayoff" style="color: #ffffff; font-size: 0.9rem; font-weight: bold; cursor: pointer; user-select: none;">🏆 Zápas PLAY-OFF</label>
                    </div>
                    <button class="action-btn btn-tip" onclick="window.adminCreateMatch('${activeAdminLeague}')" style="margin: 0 auto; display: block; width: auto; padding: 6px 14px;">VLOŽIT ZÁPAS</button>
                </div>
            </div>
        `;

        let roletkaGlobalHtml = `
            <div class="bonus-collapse-box" style="margin-bottom: 25px;">
                <button class="bonus-collapse-trigger" onclick="const c = this.nextElementSibling; c.style.display = c.style.display === 'none' ? 'block' : 'none';" style="color: #fbbf24; border-color: #fbbf24;">
                    <span>🏆 Globální vyhodnocení turnaje</span><span>▼</span>
                </button>
                <div class="bonus-collapse-content" style="display: none;">
                    <div class="bonus-grid-inputs">
                        <div>
                            <label class="bonus-input-label">Celkový vítěz:</label>
                            <input type="text" id="admin-liga-vitez-${inputId}" value="${lData.vitez || ''}" placeholder="Reálný mistr" class="bonus-text-input">
                        </div>
                        <div>
                            <label class="bonus-input-label">Nejlepší střelec:</label>
                            <input type="text" id="admin-liga-strelec-${inputId}" value="${lData.strelec || ''}" placeholder="Nejlepší střelec" class="bonus-text-input">
                        </div>
                    </div>
                    <button id="btn-admin-save-global" class="action-btn btn-tip" onclick="window.saveLeagueGlobalResults('${activeAdminLeague}')" style="margin: 5px auto 0 auto; display: block; width: auto; padding: 6px 14px;">ZAPSAT</button>
                </div>
            </div>
        `;

        const snapshot = await getDocs(collection(window.db, 'ligy', activeAdminLeague, 'zapasy'));

        if (snapshot.empty) {
            container.innerHTML = backBtnHtml + headerTitleHtml + roletkaZapasHtml + roletkaGlobalHtml + '<h3 style="color:#fff; font-size:1rem; margin-bottom:10px; text-align:left; font-family:\'Oswald\', sans-serif;">⚽ AKTUÁLNÍ ZÁPASY</h3><div class="db-empty-msg">V této soutěži zatím nejsou vytvořené žádné zápasy.</div>';
            return;
        }

        let zZapasy = [];
        snapshot.forEach(docSnap => { zZapasy.push({ id: docSnap.id, ...docSnap.data() }); });
        zZapasy.sort((a, b) => (a.datum?.toDate ? a.datum.toDate() : 0) - (b.datum?.toDate ? b.datum.toDate() : 0));

        let activeMatchesHtml = '';
        let evaluatedMatchesHtml = '';

        zZapasy.forEach(match => {
            const jeDomaciNull = !match.domaci || match.domaci === 'null' || String(match.domaci).trim() === '';
            const jeHosteNull = !match.hoste || match.hoste === 'null' || String(match.hoste).trim() === '';

            if (jeDomaciNull && jeHosteNull) return;

            if (jeDomaciNull) match.domaci = 'Neznámý';
            if (jeHosteNull) match.hoste = 'Neznámý';

            const matchId = match.id;
            const resDomaci = match.vysledek_domaci !== undefined ? match.vysledek_domaci : '';
            const resHoste = match.vysledek_hoste !== undefined ? match.vysledek_hoste : '';
            const isSaved = match.vysledek_domaci !== undefined;

            let datumText = 'Již brzy';
            let inputDatumIso = '';
            if (match.datum && typeof match.datum.toDate === 'function') {
                const dObj = match.datum.toDate();
                datumText = dObj.toLocaleDateString('cs-CZ', {
                    day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit'
                });
                const tzOffset = dObj.getTimezoneOffset() * 60000;
                inputDatumIso = (new Date(dObj - tzOffset)).toISOString().slice(0, 16);
            }

            let realResultHtml = isSaved 
                ? `<span class="user-tip-value result-value-color">${match.vysledek_domaci} : ${match.vysledek_hoste}${match.isPlayoff && match.vysledek_domaci === match.vysledek_hoste && match.postup ? '*' : ''}</span>`
                : `<span class="user-tip-value no-tip">? : ?</span>`;

            let showAdminPlayoff = (match.isPlayoff && resDomaci !== '' && resHoste !== '' && parseInt(resDomaci) === parseInt(resHoste));
            let adminSavedPostup = match.postup || '';

            let playoffAdminRowHtml = `
                <div id="playoff-admin-box-${matchId}" style="grid-column: span 3; display: ${showAdminPlayoff ? 'flex' : 'none'}; gap: 8px; margin-top: 8px; width: 100%;">
                    <button id="playoff-admin-dom-${matchId}" style="flex:1; height:34px; border-radius:6px; font-weight:bold; font-size:0.8rem; cursor:pointer; border:1px solid #4b5563; background:${adminSavedPostup === 'domaci' ? '#1e3a8a' : '#111827'}; color:${adminSavedPostup === 'domaci' ? '#fff' : '#9ca3af'};" onclick="window.selectPlayoffAdmin('${matchId}', 'domaci')">🏆 POSTUPUJE: ${match.domaci}</button>
                    <button id="playoff-admin-hos-${matchId}" style="flex:1; height:34px; border-radius:6px; font-weight:bold; font-size:0.8rem; cursor:pointer; border:1px solid #4b5563; background:${adminSavedPostup === 'hoste' ? '#1e3a8a' : '#111827'}; color:${adminSavedPostup === 'hoste' ? '#fff' : '#9ca3af'};" onclick="window.selectPlayoffAdmin('${matchId}', 'hoste')">🏆 POSTUPUJE: ${match.hoste}</button>
                    <input type="hidden" id="playoff-admin-val-${matchId}" value="${adminSavedPostup || ''}">
                </div>
            `;

            let advancedAdminRowHtml = `
                <div id="manage-admin-box-${matchId}" style="grid-column: span 3; display: none; background: #0f172a; padding: 12px; border-radius: 8px; border: 1px solid #374151; margin-top: 4px; width: 100%; box-sizing: border-box;">
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <label class="bonus-input-label" style="text-align: left;">Upravit datum a čas zápasu:</label>
                            <div style="display: flex; gap: 6px; align-items: center;">
                                <input type="datetime-local" id="admin-edit-datum-${matchId}" value="${inputDatumIso}" class="bonus-text-input" style="color-scheme: dark; height: 36px; padding: 4px 8px; margin: 0; flex: 1;">
                                <button class="btn-tip" style="height: 36px; width: auto; padding: 0 12px; background: #2563eb; font-size: 0.75rem;" onclick="window.updateMatchDate('${matchId}')">ULOŽIT ČAS</button>
                            </div>
                        </div>
                        <div style="border-top: 1px dashed #374151; padding-top: 8px; display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: #ef4444; font-size: 0.75rem; font-weight: bold;">⚠️ Nezvratná akce:</span>
                            <button class="btn-tip" style="height: 34px; width: auto; padding: 0 12px; background: #dc2626; font-size: 0.75rem;" onclick="window.deleteMatch('${matchId}')">🗑️ SMAZAT ZÁPAS</button>
                        </div>
                    </div>
                </div>
            `;

            let matchHtml = `
                <div class="zebra-block tip-row">
                    <div class="match-info">
                        <span class="match-date" style="cursor: pointer; user-select: none; display: inline-flex; align-items: center; gap: 4px;" onclick="const el = document.getElementById('manage-admin-box-${matchId}'); el.style.display = el.style.display === 'none' ? 'block' : 'none';">
                            📅 ${datumText} <span style="color: #38bdf8; font-size: 0.85rem;">⚙️</span>
                            ${match.isPlayoff ? '<span style="color:#fbbf24; font-size:0.7rem; font-weight:bold;">🏆 PLAY-OFF</span>' : ''}
                        </span>
                        <div class="match-teams">${match.domaci} – ${match.hoste}</div>
                    </div>
                    
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 190px; flex-shrink: 0; box-sizing: border-box; margin: 0; padding: 0;">
                        <div class="user-tip-box admin-result-box">
                            <div class="user-tip-label result-label-color">Výsledek ${isSaved ? '<span style="color:#34d399; font-weight:bold;">✔</span>' : ''}</div>
                            ${realResultHtml}
                        </div>
                        
                        <div class="action-inputs">
                            <select id="admin-res-domaci-${matchId}" class="select-score" onchange="window.handleAdminScoreChange('${matchId}', ${match.isPlayoff || false})">
                                ${generujMožnostiAdmin(resDomaci)}
                            </select>
                            <span class="select-divider">:</span>
                            <select id="admin-res-hoste-${matchId}" class="select-score" onchange="window.handleAdminScoreChange('${matchId}', ${match.isPlayoff || false})">
                                ${generujMožnostiAdmin(resHoste)}
                            </select>
                        </div>

                        <button class="btn-tip" onclick="window.saveRealResult('${matchId}')">
                            ${isSaved ? 'ZMĚŇ' : 'ULOŽ'}
                        </button>
                    </div>
                    ${playoffAdminRowHtml}
                    ${advancedAdminRowHtml}
                </div>
            `;

            if (isSaved) evaluatedMatchesHtml += matchHtml;
            else activeMatchesHtml += matchHtml;
        });

        let finalMatchesHtml = '';
        if (evaluatedMatchesHtml) {
            finalMatchesHtml += `
                <div class="bonus-collapse-box" style="margin-top: 5px; margin-bottom: 20px;">
                    <button class="bonus-collapse-trigger" onclick="const c = this.nextElementSibling; const isHidden = c.style.display === 'none'; c.style.display = isHidden ? 'block' : 'none'; this.querySelector('.arrow').innerText = isHidden ? '▲' : '▼';" style="color: #9ca3af; border-color: #374151;">
                        <span>✅ ODEHRANÉ ZÁPASY</span><span class="arrow">▼</span>
                    </button>
                    <div class="bonus-collapse-content" style="display: none; padding: 10px 0; border: none; background: transparent; display: flex; flex-direction: column; gap: 8px;">
                        ${evaluatedMatchesHtml}
                    </div>
                </div>
            `;
        }

        finalMatchesHtml += '<h3 style="color:#fff; font-size:1rem; margin-bottom:10px; text-align:left; font-family:\'Oswald\', sans-serif;">⚽ AKTUÁLNÍ ZÁPASY</h3>';
        if (!activeMatchesHtml) {
            finalMatchesHtml += '<div class="db-empty-msg">Žádné aktivní zápasy k vyhodnocení.</div>';
        } else {
            finalMatchesHtml += `<div style="display:flex; flex-direction:column; gap:8px;">${activeMatchesHtml}</div>`;
        }

        container.innerHTML = backBtnHtml + headerTitleHtml + roletkaZapasHtml + roletkaGlobalHtml + finalMatchesHtml;
        autoSmrskniPismoTymu('#adminMatchesContainer');

    } catch (e) {
        console.error(e);
        container.innerHTML = '<div class="err-box">❌ Selhal import dat administrace.</div>';
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

    const headerRight = document.querySelector('#globalHeader .header-right');
    if (headerRight) { headerRight.style.width = ""; headerRight.innerHTML = ''; }
    
    if (leagueName === "MS ve fotbale" || leagueName === "MS ve fotbale 2026") {
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
window.toggleUserApproval = async (uid, checked) => {
    try {
        await updateDoc(doc(window.db, 'users', uid), { isApproved: checked });
        window.showToast(checked ? "🟢 Hráč byl vpuštěn na stadion!" : "⏳ Hráč přesunut do čekárny.");
    } catch (e) { console.error(e); }
};

window.toggleUserAdmin = async (uid, checked) => {
    try {
        await updateDoc(doc(window.db, 'users', uid), { isAdmin: checked });
        window.showToast(checked ? "👑 Práva administrátora udělena." : "ℹ Práva administrátora odebrána.");
    } catch (e) { console.error(e); }
};

window.toggleUserLeague = async (uid, leagueName, checked) => {
    try {
        const userRef = doc(window.db, 'users', uid);
        const docSnap = await getDoc(userRef);
        if (docSnap.exists()) {
            let currentLeagues = docSnap.data().leagues || [];
            if (checked) {
                if (!currentLeagues.includes(leagueName)) currentLeagues.push(leagueName);
            } else {
                currentLeagues = currentLeagues.filter(l => l !== leagueName);
            }
            await updateDoc(userRef, { leagues: currentLeagues });
            window.showToast(`🎯 Přístup do ligy aktualizován.`);
        }
    } catch (e) { console.error(e); }
};

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

    container.innerHTML = '<div class="db-empty-msg">Načítám soupisku dravých tipérů... ⏳</div>';

    // 🔥 ŽIVÝ RADAR: onSnapshot automaticky překreslí tabulku, jakmile kdokoli kdekoli klikne
    window.superAdminUsersUnsubscribe = onSnapshot(collection(window.db, 'users'), (snapshot) => {
        if (store.currentScreen !== 'superAdminScreen') {
            if (window.superAdminUsersUnsubscribe) {
                window.superAdminUsersUnsubscribe();
                window.superAdminUsersUnsubscribe = null;
            }
            return;
        }

        container.innerHTML = `
            <div style="margin-bottom: 15px; padding: 4px 0;">
                <p style="color: #9ca3af; font-size: 0.85rem; margin: 0; line-height: 1.4; text-align: left;">
                    Vítej v manažerském kokpitu. Veškeré změny se do databáze propisují okamžitě po zaškrtnutí (Real-time Event-driven UX).
                </p>
            </div>

            <div class="bonus-collapse-box" style="margin-bottom: 20px; border: 1px solid #c2410c; background: rgba(194, 65, 12, 0.03);">
                <button class="bonus-collapse-trigger" onclick="const c = this.nextElementSibling; const isHidden = c.style.display === 'none'; c.style.display = isHidden ? 'block' : 'none'; this.querySelector('.arrow').innerText = isHidden ? '▲' : '▼';" style="color: #ea580c; border-color: #c2410c; font-weight: bold; background: transparent;">
                    <span>🔄 PŘEVOD DAT (ZÁCHRANA BODŮ)</span><span class="arrow">▼</span>
                </button>
                <div class="bonus-collapse-content" style="display: none; padding: 15px; background: #111827; border-top: 1px solid #374151;">
                    <div style="margin-bottom: 12px; text-align: left;">
                        <label class="bonus-input-label" style="color: #9ca3af; font-size: 0.8rem; display: block; margin-bottom: 4px;">Starý e-mail (Ztracený / Původní):</label>
                        <input type="email" id="transfer-old-email" placeholder="stary-ucet@seznam.cz" class="bonus-text-input" style="width: 100%; box-sizing: border-box; text-align: left; padding-left: 10px;">
                    </div>
                    <div style="margin-bottom: 15px; text-align: left;">
                        <label class="bonus-input-label" style="color: #9ca3af; font-size: 0.8rem; display: block; margin-bottom: 4px;">Nový e-mail (Zbrusu nový / Cílový):</label>
                        <input type="email" id="transfer-new-email" placeholder="novy-ucet@gmail.com" class="bonus-text-input" style="width: 100%; box-sizing: border-box; text-align: left; padding-left: 10px;">
                    </div>
                    <button class="action-btn" onclick="window.triggerTransferFeature()" style="background: #ea580c; color: white; width: 100%; font-weight: bold; font-family: 'Oswald', sans-serif; letter-spacing: 0.5px; border: 1px solid #f97316;">
                        🚀 SPUSTIT TRANSFÉR BODŮ
                    </button>
                </div>
            </div>

            <h3 style="color:#fff; font-size:1.1rem; margin-top:15px; margin-bottom:10px; text-align:left; font-family:\'Oswald\', sans-serif;">👥 SPRÁVA LIGOVÝCH ÚČASTNÍKŮ</h3>
            <div id="adminLiveUsersWrapper" style="display: flex; flex-direction: column; gap: 10px; width: 100%;"></div>
        `;

        const wrapper = document.getElementById('adminLiveUsersWrapper');
        let counter = 0;

        snapshot.forEach((uDoc) => {
            const data = uDoc.data();
            const uid = uDoc.id;
            const email = data.email || '';

            // 🕵️‍♂️ ABSOLUTNÍ DISKRECIONÁLNÍ ŠTÍT: Makyán je pro systém neviditelný duch!
            if (email.toLowerCase().trim() === 'makyan13@seznam.cz' || uid === 'tfLmfp1twLbcFsxWrgNkZ7iQRC22') {
                return;
            }

            counter++;
            const leagues = data.leagues || [];

            const userRow = document.createElement('div');
            userRow.className = 'zebra-block';
            userRow.style = 'padding: 14px; display: flex; flex-direction: column; gap: 10px; border-radius: 10px; background: #111827; border: 1px solid #374151; box-sizing: border-box; width: 100%; text-align: left;';
            
            userRow.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #374151; padding-bottom: 8px;">
                    <div>
                        <strong style="color: #ffffff; font-size: 1rem; font-family: 'Oswald', sans-serif; letter-spacing: 0.3px;">${data.nickname || 'Nový Hráč'}</strong>
                        <div style="color: #9ca3af; font-size: 0.72rem; font-family: monospace; margin-top: 1px;">${email}</div>
                    </div>
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 0.82rem; color: #fbbf24; font-weight: bold; cursor: pointer; user-select: none;">
                        <input type="checkbox" ${data.isApproved ? 'checked' : ''} onchange="window.toggleUserApproval('${uid}', this.checked)" style="width: 18px; height: 18px; cursor: pointer; accent-color: #fbbf24; margin: 0;"> VSTUP
                    </label>
                </div>

                <div style="display: flex; flex-direction: column; gap: 8px; font-size: 0.8rem; color: #e5e7eb; padding: 2px 0;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;"><input type="checkbox" ${leagues.includes('MS v hokeji') ? 'checked' : ''} onchange="window.toggleUserLeague('${uid}', 'MS v hokeji', this.checked)" style="width: 16px; height: 16px; cursor: pointer; accent-color: #10b981; margin: 0;"> 🏒 MS V HOKEJI</label>
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;"><input type="checkbox" ${leagues.includes('MS ve fotbale') ? 'checked' : ''} onchange="window.toggleUserLeague('${uid}', 'MS ve fotbale', this.checked)" style="width: 16px; height: 16px; cursor: pointer; accent-color: #10b981; margin: 0;"> ⚽ MS VE FOTBALE 2026</label>
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;"><input type="checkbox" ${leagues.includes('Tipsport Extraliga') ? 'checked' : ''} onchange="window.toggleUserLeague('${uid}', 'Tipsport Extraliga', this.checked)" style="width: 16px; height: 16px; cursor: pointer; accent-color: #10b981; margin: 0;"> 🏒 TIPSPORT EXTRALIGA</label>
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;"><input type="checkbox" ${leagues.includes('Chance Liga') ? 'checked' : ''} onchange="window.toggleUserLeague('${uid}', 'Chance Liga', this.checked)" style="width: 16px; height: 16px; cursor: pointer; accent-color: #10b981; margin: 0;"> ⚽ CHANCE LIGA</label>
                </div>

                <div style="border-top: 1px dashed #374151; padding-top: 8px; margin-top: 2px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 0.78rem; color: #9ca3af;">Práva správce výsledků (Admin):</span>
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 0.82rem; color: #ef4444; font-weight: bold; cursor: ${store.isSuperAdmin ? 'pointer' : 'not-allowed'}; user-select: none;">
                        <input type="checkbox" ${data.isAdmin ? 'checked' : ''} ${!store.isSuperAdmin ? 'disabled' : ''} onchange="window.toggleUserAdmin('${uid}', this.checked)" style="width: 16px; height: 16px; cursor: ${store.isSuperAdmin ? 'pointer' : 'not-allowed'}; accent-color: #ef4444; margin: 0;"> ADMIN
                    </label>
                </div>
            `;
            wrapper.appendChild(userRow);
        });

        if (counter === 0) {
            wrapper.innerHTML = '<div class="db-empty-msg">V čekárně ani na soupisce zatím nejsou žádní ostatní hráči.</div>';
        }
    });
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

        await setDoc(docRef, {
            userId: user.uid,
            email: user.email.trim().toLowerCase(),
            nickname: nickVal,
            isApproved: autoApproved,
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
        const centralDocData = store.leaderboardData || {};
        const mapaPrezdivek = centralDocData.mapaPrezdivek || {};

        let listHtml = `<div class="match-spy-table-header"><span>HRÁČ</span><span>TIP</span><span>BODY</span></div>`;
        let všichniHraciEmaily = Object.keys(mapaPrezdivek);
        let isEvaluated = (matchData.vysledek_domaci !== undefined && matchData.vysledek_hoste !== undefined && matchData.apiStatus !== "IN_PLAY" && matchData.apiStatus !== "PAUSED");

        const tipyProZapas = docSnap.exists() ? (docSnap.data().tipy || []) : [];

        if (všichniHraciEmaily.length === 0) {
            listHtml = `<div style="color:#6b7280; font-size:0.85rem; text-align:center; padding:20px 0;">Žádný hráč v této lize není.</div>`;
        } else {
            listHtml += všichniHraciEmaily.map(em => {
                const hracNick = mapaPrezdivek[em] || em.split('@')[0];
                const t = tipyProZapas.find(tip => tip.userEmail && tip.userEmail.trim().toLowerCase() === em.trim().toLowerCase());
                const isMe = em === (window.auth.currentUser?.email || '').trim().toLowerCase();
                
                const nickColorStyle = isMe ? 'color: #10b981; font-weight: bold;' : 'color: #f3f4f6;';
                const netipovalStyle = isMe ? 'color: #ef4444; font-weight: bold;' : 'color: #f3f4f6;';

                if (t && t.tip_domaci !== undefined && t.tip_domaci !== null && t.tip_domaci !== '') {
                    let ptsStr = '-'; let ptsColor = '#9ca3af'; let exactClass = '';
                    if (isEvaluated) {
                        let pts = window.vypocitejBodyZapasu(t.tip_domaci, t.tip_hoste, matchData.vysledek_domaci, matchData.vysledek_hoste, leagueName, t.postup, matchData.postup, matchData.isPlayoff);
                        ptsStr = `(${pts >= 0 ? '+' : ''}${pts} b.)`;
                        ptsColor = pts < 0 ? '#f87171' : (pts > 0 ? '#34d399' : '#9ca3af');
                        if (pts === 6) exactClass = 'exact-tip';
                    }
                    let pPozn = (matchData.isPlayoff && t.tip_domaci === t.tip_hoste && t.postup) ? '*' : '';
                    return `
                        <div class="match-spy-table-row ${exactClass}">
                            <div style="${nickColorStyle}">${hracNick}</div>
                            <div class="match-spy-cell-tip">${t.tip_domaci} : ${t.tip_hoste}${pPozn}</div>
                            <div class="match-spy-cell-points" style="color: ${ptsColor};">${ptsStr}</div>
                        </div>
                    `;
                } else {
                    let ptsStr = '-'; let ptsColor = '#9ca3af';
                    if (isEvaluated) {
                        let pts = (leagueName === "MS ve fotbale" || leagueName === "MS ve fotbale 2026") ? -1 : 0;
                        ptsStr = `(${pts >= 0 ? '+' : ''}${pts} b.)`;
                        ptsColor = pts < 0 ? '#f87171' : '#9ca3af';
                    }
                    return `
                        <div class="match-spy-table-row">
                            <div style="${netipovalStyle}">${hracNick}</div>
                            <div class="match-spy-cell-tip" style="color: #ef4444;">? : ?</div>
                            <div class="match-spy-cell-points" style="color: ${ptsColor};">${ptsStr}</div>
                        </div>
                    `;
                }
            }).join('');
        }

        let scoreBadge = '';
        if (isEvaluated) {
            scoreBadge = ` <span style="color:#10b981; font-size:0.95rem; font-weight:bold; margin-left:4px;">(${matchData.vysledek_domaci}:${matchData.vysledek_hoste})</span>`;
        } else if (matchData.apiStatus === "IN_PLAY" || matchData.apiStatus === "PAUSED") {
            let prubD = matchData.vysledek_domaci !== undefined ? matchData.vysledek_domaci : 0;
            let prubH = matchData.vysledek_hoste !== undefined ? matchData.vysledek_hoste : 0;
            scoreBadge = ` <span style="color:#ef4444; font-size:0.95rem; font-weight:bold; margin-left:4px;">(${prubD}:${prubH})</span><span style="color:#ef4444; font-size:0.68rem; font-weight:bold; margin-left:6px; animation:pulse 1.5s infinite; background:rgba(239,68,68,0.15); padding:2px 6px; border-radius:4px; border:1px solid rgba(239,68,68,0.3);">🔴 LIVE</span>`;
        }

        const overlay = document.createElement('div');
        overlay.className = 'spy-modal-overlay';
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        overlay.innerHTML = `
            <div class="spy-modal-box">
                <div class="spy-modal-header"><h3>📋 Tipy: ${matchTitle}${scoreBadge}</h3><button class="spy-modal-close" onclick="this.closest('.spy-modal-overlay').remove()">✕</button></div>
                <div class="spy-modal-body">${listHtml}</div>
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