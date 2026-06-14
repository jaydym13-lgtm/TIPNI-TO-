// =========================================================================
// 🎨 TIPNI TO! - VYKRESLOVÁNÍ DAT, TIPŮ A FILTROVANÉHO ŽEBŘÍČKU (render.js)
// =========================================================================

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

const autoSmrskniPismoTymu = (containerSelector) => {
    setTimeout(() => {
        const container = document.querySelector(containerSelector);
        if (!container) return;
        container.querySelectorAll('.tip-row').forEach(row => {
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
        });
    }, 50);
};

// 1. UŽIVATEL: ZOBRAZENÍ TABULKY ZÁPASŮ PRO DANOU LIGU
window.renderMatches = async (leagueName) => {
    const container = document.querySelector('#matchesScreen .zebra-container');
    if (!container) return;

    container.innerHTML = '<div class="db-empty-msg">Načítám zápasy ze stadionu...</div>';
    const user = auth.currentUser;

    try {
        // NOVÁ CESTA: Dotaz míří do podsložky zápasů konkrétní ligy
        const snapshot = await db.collection('ligy').doc(leagueName).collection('zapasy').get();
        
        const myTips = {};
        const vnořenéTipy = {};
        
        // Načtení VŠECH tipů v lize pro možnost sledování soupeřů přímo u karet zápasů
        const tipsSnapshot = await db.collection('ligy').doc(leagueName).collection('tipy').get();
        tipsSnapshot.forEach(doc => {
            const tipData = doc.data();
            if (user && tipData.userId === user.uid) {
                myTips[tipData.matchId] = tipData;
            }
            if (tipData.matchId && tipData.userEmail) {
                const emailKey = tipData.userEmail.trim().toLowerCase();
                if (!vnořenéTipy[tipData.matchId]) vnořenéTipy[tipData.matchId] = [];
                vnořenéTipy[tipData.matchId].push({ ...tipData, userEmail: emailKey });
            }
        });

        // Načtení uživatelských přezdívek pro správné zobrazení jmen u cizích tipů
        const usersSnapshot = await db.collection('users').get();
        const mapaPrezdivek = {};
        usersSnapshot.forEach(uDoc => {
            mapaPrezdivek[uDoc.id.trim().toLowerCase()] = uDoc.data().nickname || uDoc.id;
        });

        container.innerHTML = '';

        if (snapshot.empty) {
            container.innerHTML = `<div class="db-empty-msg">Pro soutěž "${leagueName}" zatím nejsou vypsané zápasy.</div>`;
            return;
        }

        let klientskeZapasy = [];
        snapshot.forEach(doc => { klientskeZapasy.push({ id: doc.id, ...doc.data() }); });
        klientskeZapasy.sort((a, b) => (a.datum?.toDate ? a.datum.toDate() : 0) - (b.datum?.toDate ? b.datum.toDate() : 0));

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

        const evaluatedCollapseBox = document.createElement('div');
        evaluatedCollapseBox.className = 'bonus-collapse-box';
        evaluatedCollapseBox.style.marginTop = '5px';
        evaluatedCollapseBox.style.marginBottom = '6px';
        evaluatedCollapseBox.style.width = '100%';
        evaluatedCollapseBox.innerHTML = `
            <button class="bonus-collapse-trigger" onclick="const c = this.nextElementSibling; const isHidden = c.style.display === 'none'; c.style.display = isHidden ? 'block' : 'none'; this.querySelector('.arrow').innerText = isHidden ? '▲' : '▼';" style="color: #9ca3af; border-color: #374151; min-height: 48px;">
                <span>✅ ODEHRANÉ ZÁPASY</span>
                <span id="evaluated-total-badge" style="background: #111827; color: #34d399; border: 1px solid #059669; padding: 5px 12px; border-radius: 6px; font-size: 0.85rem; font-weight: bold; font-family: 'Oswald', sans-serif; white-space: nowrap; margin-left: auto; margin-right: 12px; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;">0 b.</span>
                <span class="arrow">▼</span>
            </button>
            <div class="bonus-collapse-content" style="display: none; padding: 4px 0; border: none; background: transparent; display: flex; flex-direction: column; gap: 4px;"></div>
        `;
        const evaluatedWrapper = evaluatedCollapseBox.querySelector('.bonus-collapse-content');

        klientskeZapasy.forEach(match => {
            const matchId = match.id;
            const existingTip = myTips[matchId];

            let mujTipHtml = '';
            if (existingTip) {
                let postupPoznamka = (match.isPlayoff && existingTip.tip_domaci === existingTip.tip_hoste && existingTip.postup) ? '*' : '';
                mujTipHtml = `<span class="user-tip-value valid-tip">${existingTip.tip_domaci} : ${existingTip.tip_hoste}${postupPoznamka}</span>`;
            } else {
                mujTipHtml = `<span class="user-tip-value no-tip">? : ?</span>`;
            }

            let vybranyDomaci = existingTip ? existingTip.tip_domaci : '';
            let vybranyHoste = existingTip ? existingTip.tip_hoste : '';

            let datumText = 'Již brzy';
            if (match.datum && typeof match.datum.toDate === 'function') {
                datumText = match.datum.toDate().toLocaleDateString('cs-CZ', {
                    day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit'
                });
            }

            let isEvaluated = (match.vysledek_domaci !== undefined && match.vysledek_hoste !== undefined);
            let rightSideGroupHtml = '';
            let evaluatedClass = '';
            let playoffUserRowHtml = '';

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

                let pointsBadgeClass = 'badge-pts-zero';
                if (ziskaneBody > 0) pointsBadgeClass = 'badge-pts-positive';
                if (ziskaneBody < 0) pointsBadgeClass = 'badge-pts-negative';

                let realPostupPoznamka = (match.isPlayoff && match.vysledek_domaci === match.vysledek_hoste && match.postup) ? ` (${match.postup === 'domaci' ? 'DOM' : 'HOS'})` : '';

                rightSideGroupHtml = `
                    <div class="user-tip-box admin-result-box">
                        <div class="user-tip-label result-label-color">Výsledek <span style="color:#10b981; font-weight:bold;">✔</span></div>
                        <span class="user-tip-value result-value-color">${match.vysledek_domaci} : ${match.vysledek_hoste}${realPostupPoznamka}</span>
                    </div>
                    <div class="match-points-badge ${pointsBadgeClass}">${ziskaneBody >= 0 ? '+' : ''}${ziskaneBody} b.</div>
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

            // 🔒 Anti-cheat časová pojistka pro stažení a odemčení cizích tipů v minutu výkopu
            const uzZacalo = match.datum && typeof match.datum.toDate === 'function' && match.datum.toDate() <= new Date();
            let spyEyeHtml = '';
            
            if (uzZacalo) {
                spyEyeHtml = `<span onclick="window.showSpyModal('${matchId}', '${match.domaci} – ${match.hoste}')" class="match-metadata-eye">👁️</span>`;
                
                const tipyProZapas = vnořenéTipy[matchId] || [];
                const filtryOstatnich = tipyProZapas.filter(t => !user || t.userId !== user.uid);
                let spyListHtml = '';
                
                if (filtryOstatnich.length === 0) {
                    spyListHtml = `<div style="color:#6b7280; font-size:0.85rem; text-align:center; padding:20px 0;">Žádný jiný hráč tento zápas netipoval.</div>`;
                } else {
                    spyListHtml = filtryOstatnich.map(t => {
                        const hracNick = mapaPrezdivek[t.userEmail] || t.userEmail;
                        let bonusLabel = '';
                        if (isEvaluated) {
                            const pts = window.vypocitejBodyZapasu(t.tip_domaci, t.tip_hoste, match.vysledek_domaci, match.vysledek_hoste, leagueName, t.postup, match.postup, match.isPlayoff);
                            bonusLabel = ` <span style="color:${pts < 0 ? '#f87171' : (pts > 0 ? '#34d399' : '#9ca3af')}; font-weight:bold;">(${pts >= 0 ? '+' : ''}${pts} b.)</span>`;
                        }
                        let pPozn = (match.isPlayoff && t.tip_domaci === t.tip_hoste && t.postup) ? '*' : '';
                        return `<div style="display:flex; justify-content:space-between; align-items:center; padding:7px 0; border-bottom:1px solid rgba(255,255,255,0.03); font-size:0.85rem;"><span style="color:#9ca3af;">${hracNick}</span><span style="font-weight:bold; color:#e5e7eb;">${t.tip_domaci} : ${t.tip_hoste}${pPozn}${bonusLabel}</span></div>`;
                    }).join('');
                }
                
                // Uložení vyrenderovaných tipů do globálního registru pro bleskové vyvolání modalem
                window.spyModalsRegistry = window.spyModalsRegistry || {};
                window.spyModalsRegistry[matchId] = spyListHtml;
            } else {
                spyEyeHtml = `<span class="match-metadata-lock" title="Tipy ostatních se odemknou automaticky v minutu startu utkání">🔒</span>`;
            }

            const matchRow = document.createElement('div');
            matchRow.className = `zebra-block tip-row ${existingTip ? 'has-tip' : ''} ${evaluatedClass}`;

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

            if (isEvaluated) {
                evaluatedWrapper.appendChild(matchRow);
            } else {
                activeWrapper.appendChild(matchRow);
            }
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

        if (evaluatedWrapper.children.length > 0) {
            container.appendChild(evaluatedCollapseBox);
        }
        container.appendChild(activeWrapper);

        autoSmrskniPismoTymu('#matchesScreen');

    } catch (error) {
        console.error("Chyba zápasů:", error);
    }
};

// UKLÁDÁNÍ JEDNOHO TIPU UŽIVATELE
window.saveTip = async (matchId, leagueName) => {
    const user = auth.currentUser;
    if (!user) return;

    const domaciSkore = document.getElementById(`tip-domaci-${matchId}`).value;
    const hosteSkore = document.getElementById(`tip-hoste-${matchId}`).value;

    if (domaciSkore === "" || hosteSkore === "") {
        alert("Před odesláním tipu musíš nejprve zvolit číselné skóre obou týmů! 🧐");
        return;
    }

    let postupVal = '';
    const dVal = parseInt(domaciSkore);
    const hVal = parseInt(hosteSkore);
    const hiddenInput = document.getElementById(`playoff-user-val-${matchId}`);

    if (hiddenInput && dVal === hVal) {
        postupVal = hiddenInput.value;
        if (!postupVal) {
            alert("V zápasech play-off musíš při remíze kliknutím zvolit postupující tým! 🏆");
            return;
        }
    }

    try {
        // NOVÁ CESTA: Ukládáme hluboko do podsložky tipů konkrétní ligy
        await db.collection('ligy').doc(leagueName).collection('tipy').doc(`${user.uid}_${matchId}`).set({
            userId: user.uid,
            userEmail: user.email,
            matchId: matchId,
            tip_domaci: dVal,
            tip_hoste: hVal,
            postup: postupVal,
            vytvoreno: firebase.firestore.FieldValue.serverTimestamp()
        });

        window.showToast("⚽ Tip bezpečně uložen!");
        window.renderMatches(leagueName);
        
    } catch (error) {
        console.error(error);
    }
};

// NAČÍTÁNÍ DLOUHODOBÝCH BONUSŮ
window.loadBonusTips = async (leagueName) => {
    const user = auth.currentUser;
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
        // NOVÁ CESTA: Bonusy načítáme z podsložky ligy (ID dokumentu je přímo UID uživatele)
        const doc = await db.collection('ligy').doc(leagueName).collection('bonusy').doc(user.uid).get();
        if (doc.exists) {
            const data = doc.data();
            inputVitez.value = data.vitez || '';
            inputStrelec.value = data.strelec || '';
            btnBonus.innerText = 'ULOŽENO ✔';
        }

        // NOVÁ CESTA: Kontrola, zda už nezačal první zápas ligy
        const matchesSnapshot = await db.collection('ligy').doc(leagueName).collection('zapasy').get();
        let uzZacalo = false;
        matchesSnapshot.forEach(m => {
            const mData = m.data();
            if (mData.datum && mData.datum.toDate() < new Date()) {
                uzZacalo = true;
            }
        });

        // ⚠️ DOČASNĚ VYPNUTO PRO TESTOVÁNÍ (Před ostrým spuštěním odkomentuj!)
        // if (uzZacalo) {
        //     inputVitez.disabled = true;
        //     inputStrelec.disabled = true;
        //     btnBonus.style.display = 'none';
        // }
    } catch (e) {
        console.error(e);
    }
};

// UKLÁDÁNÍ DLOUHODOBÝCH BONUSŮ
window.saveBonusTips = async () => {
    const user = auth.currentUser;
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
        // NOVÁ CESTA: Ukládáme bonusy přímo do ligy pod dokument uživatele (uid)
        await db.collection('ligy').doc(leagueName).collection('bonusy').doc(user.uid).set({
            userId: user.uid,
            userEmail: user.email,
            vitez: vitezValue.trim(),
            strelec: strelecValue.trim(),
            vytvoreno: firebase.firestore.FieldValue.serverTimestamp()
        });

        window.showToast("🎁 Bonusy na šampionát uloženy!");
        window.loadBonusTips(leagueName);
    } catch (e) {
        console.error(e);
        if (btnBonus) btnBonus.innerText = 'ULOŽIT';
    }
};

// 2. KROK: REAKTIVNÍ CENTRALIZOVANÝ ŽEBŘÍČEK (MAXIMÁLNÍ PROFI ARCHITEKTURA S KOSMICKOU RYCHLOSTÍ)
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
            <button class="nav-btn-leaderboard class-live-btn-tab" style="${btnStyleLive}" onclick="window.leaderboardActiveTab='live'; window.renderLeaderboard();">
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

    // 🔥 REAL-TIME STRUCKTURA (onSnapshot): Žádné zbytečné časovače, poslouchá se pouze 1 předpočítaný dokument
    window.currentLeaderboardUnsubscribe = db.collection('ligy').doc(leagueName).collection('stav').doc('zebricek')
        .onSnapshot(docSnap => {
            if (Alpine.store('appState')?.currentScreen !== 'leaderboardScreen') {
                if (window.currentLeaderboardUnsubscribe) {
                    window.currentLeaderboardUnsubscribe();
                    window.currentLeaderboardUnsubscribe = null;
                }
                return;
            }

            if (!docSnap.exists) {
                    contentArea.innerHTML = `<div class="db-empty-msg" style="color:#fbbf24;">Žebříček se na pozadí připravuje. Bot na GitHubu nebo admin musí zapsat nějaký výsledek zápasu! ⚙️</div>`;
                    
                    // 🔴 FIX: Pokud centrální dokument neexistuje, skryjeme LIVE tlačítko hned na startu
                    const liveBtn = document.querySelector('.class-live-btn-tab');
                    if (liveBtn) {
                        liveBtn.style.display = 'none';
                    }
                    return;
                }

            window.lastLeaderboardSnapshotData = docSnap.data();
            window.vykresliDataZebříčku(window.lastLeaderboardSnapshotData, contentArea, window.leaderboardActiveTab, leagueName);
        }, error => {
            console.error("Chyba real-time synchronizace žebříčku:", error);
            contentArea.innerHTML = '<div class="err-box">❌ Selhalo živé spojení se stadionem.</div>';
        });
};

// 🎨 ČISTÝ INTERAKTIVNÍ MANAŽER VYKRESLOVÁNÍ DAT
window.vykresliDataZebříčku = (centralDoc, contentArea, tab, leagueName) => {
    const hracStats = centralDoc.hracStats || {};
    const mapaTipu = centralDoc.mapaTipu || {};
    const lZapasy = centralDoc.lZapasy || {};
    const realLeagueData = centralDoc.realLeagueData || null;
    const mapaPrezdivek = centralDoc.mapaPrezdivek || {};
    const user = auth.currentUser;

    // 🔴 INTELIGENTNÍ FILTR PRO LIVE TLAČÍTKO: Běží právě nějaký zápas naživo?
    const jeNecoLive = Object.values(lZapasy).some(zap => {
        const zacal = zap.datum && typeof zap.datum.toDate === 'function' && zap.datum.toDate() <= new Date();
        const nemaVysledek = (zap.vysledek_domaci === undefined || zap.vysledek_domaci === null);
        return zacal && nemaVysledek;
    });

    // Najdeme LIVE tlačítko v záhlaví tabulky a skryjeme ho / ukážeme podle situace
    const liveBtn = document.querySelector('.class-live-btn-tab');
    if (liveBtn) {
        liveBtn.style.display = jeNecoLive ? 'flex' : 'none';
    }

    // Bezpečnostní pojistka: Pokud zápasy dohrály a uživatel visel v LIVE záložce, hodíme ho hladce zpět na Celkovou tabulku
    if (!jeNecoLive && tab === 'live') {
        window.leaderboardActiveTab = 'total';
        window.renderLeaderboard();
        return;
    }

    const finálníKlientskáTabulka = {};
    Object.keys(hracStats).forEach(email => {
        const s = hracStats[email];
        let klientskeBody = s.celkemBodu;

        if (tab === 'total' && realLeagueData && (realLeagueData.vitez || realLeagueData.strelec)) {
            if (typeof window.vypocitejBonusy === 'function') {
                klientskeBody += window.vypocitejBonusy(
                    s.vitezMs, s.nejStrelec,
                    realLeagueData.vitez, realLeagueData.strelec,
                    leagueName
                );
            }
        }
        finálníKlientskáTabulka[email] = { ...s, bodyProZobrazeni: klientskeBody };
    });

    const zebricekSrazeny = Object.entries(finálníKlientskáTabulka).sort((a, b) => b[1].bodyProZobrazeni - a[1].bodyProZobrazeni);
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
                contentDiv.classList.remove('show-fixed');
                arrow.innerText = '▼';
            } else {
                contentDiv.classList.add('show-fixed');
                arrow.innerText = '▲';
            }
        };
        contentArea.appendChild(rekordyCollapseBox);
    }

    zebricekSrazeny.forEach((hrac, index) => {
        const [email, stats] = hrac;
        const hracovaPrezdivka = mapaPrezdivek[email] || email;
        const row = document.createElement('div');
        row.className = 'leaderboard-row-wrapper';

        let pozice = `${index + 1}.`;
        if (index === 0) pozice = '🥇';
        if (index === 1) pozice = '🥈';
        if (index === 2) pozice = '🥉';

        let bonusRowsHtml = '';
        if (tab === 'total') {
            bonusRowsHtml = `
                <div class="leaderboard-meta-row">
                    <span class="leaderboard-meta-label">🏆 TIP NA VÍTĚZE:</span>
                    <span class="leaderboard-meta-value">${stats.vitezMs.toUpperCase()}</span>
                </div>
                <div class="leaderboard-meta-row">
                    <span class="leaderboard-meta-label">🥇 TIP NA STŘELCE:</span>
                    <span class="leaderboard-meta-value">${stats.nejStrelec.toUpperCase()}</span>
                </div>
            `;
        }

        row.innerHTML = `
            <div onclick="const det = this.nextElementSibling; const arr = this.querySelector('.leaderboard-arrow-icon'); if(det.style.display==='none' || !det.style.display){det.style.display='block'; arr.innerText='▲';}else{det.style.display='none'; arr.innerText='▼';}" class="leaderboard-row-trigger">
                <div class="leaderboard-row-left">
                    <span class="leaderboard-row-position">${pozice}</span>
                    <span class="leaderboard-row-nickname">${hracovaPrezdivka}</span>
                </div>
                <div class="leaderboard-row-right">
                    <div style="color: ${stats.bodyProZobrazeni < 0 ? '#f87171' : '#34d399'};" class="leaderboard-row-points">
                        ${stats.bodyProZobrazeni} b.
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
                <button onclick="window.showPlayerTipsModal('${email}', '${hracovaPrezdivka.replace(/'/g, "\\'")}', '${leagueName}')" class="leaderboard-spy-btn">
                    👁️ PROHLÉDNOUT TIPY HRÁČE
                </button>
            </div>
        `;
        contentArea.appendChild(row);
    });
};

// 👁️ SAMOSTATNÝ MODAL PRO CHRONOLOGICKÉ PROHLÍŽENÍ VŠECH TIPŮ DANÉHO HRÁČE
window.showPlayerTipsModal = (email, nickname, leagueName) => {
    const centralDoc = window.lastLeaderboardSnapshotData || {};
    const mapaTipu = centralDoc.mapaTipu || {};
    const lZapasy = centralDoc.lZapasy || {};
    const user = auth.currentUser;

    const hracEmailyKey = email.trim().toLowerCase();
    const hracovyTipy = mapaTipu[hracEmailyKey] || {};

    // ⏳ 1. KROK: Přetvoříme objekt na pole a seřadíme zápasy od nejstaršího po nejnovější podle data výkopu
    const serazeneZapasy = Object.entries(lZapasy)
        .map(([mId, zap]) => ({ matchId: mId, ...zap }))
        .sort((a, b) => (a.datum?.toDate ? a.datum.toDate() : 0) - (b.datum?.toDate ? b.datum.toDate() : 0));

    // 📜 2. KROK: Vygenerujeme HTML seznam položek
    let listHtml = '';
    serazeneZapasy.forEach(zap => {
        const t = hracovyTipy[zap.matchId];
        const zapZacalo = zap.datum && typeof zap.datum.toDate === 'function' && zap.datum.toDate() <= new Date();
        
        if (t) {
            // Anti-cheat: Cizí tipy uvidíš až ve chvíli výkopu, své vlastní vidíš vždycky
            if (zapZacalo || (user && hracEmailyKey === user.email.trim().toLowerCase())) {
                let pPozn = (zap.isPlayoff && t.tip_domaci === t.tip_hoste && t.postup) ? '*' : '';
                let bLabel = '';
                const jeVyh = (zap.vysledek_domaci !== undefined && zap.vysledek_hoste !== undefined);
                if (jeVyh) {
                    const pts = window.vypocitejBodyZapasu(t.tip_domaci, t.tip_hoste, zap.vysledek_domaci, zap.vysledek_hoste, leagueName, t.postup, zap.postup, zap.isPlayoff);
                    bLabel = ` <span style="color:${pts < 0 ? '#f87171' : (pts > 0 ? '#34d399' : '#9ca3af')}; font-weight:bold;">(${pts >= 0 ? '+' : ''}${pts} b.)</span>`;
                }
                listHtml += `
                    <div class="leaderboard-spy-item" style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.04); font-size:0.82rem;">
                        <span style="color:#9ca3af; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:65%;">${zap.domaci} - ${zap.hoste}</span>
                        <span style="font-weight:bold; color:#e5e7eb; flex-shrink:0;">${t.tip_domaci} : ${t.tip_hoste}${pPozn}${bLabel}</span>
                    </div>
                `;
            } else {
                listHtml += `
                    <div class="leaderboard-spy-item" style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.04); font-size:0.82rem;">
                        <span style="color:#4b5563; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:65%; text-decoration:line-through;">${zap.domaci} - ${zap.hoste}</span>
                        <span style="color:#6b7280; font-style:italic; flex-shrink:0; font-size:0.75rem;">🔒 Tajné</span>
                    </div>
                `;
            }
        }
    });

    if (!listHtml) {
        listHtml = '<div style="color:#6b7280; font-size:0.85rem; text-align:center; padding:20px 0;">Hráč nemá uložené žádné tipy.</div>';
    }

    // 👑 3. KROK: Injektujeme recyklovaný vládní modal přímo do těla dokumentu
    const overlay = document.createElement('div');
    overlay.className = 'spy-modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = `
        <div class="spy-modal-box" style="max-width:380px;">
            <div class="spy-modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #374151; padding-bottom:10px; margin-bottom:12px;">
                <h3 style="font-family:'Oswald', sans-serif; color:#fbbf24; margin:0; font-size:1.1rem; text-transform:uppercase; letter-spacing:0.5px;">📋 Tipy hráče: ${nickname}</h3>
                <button class="spy-modal-close" onclick="this.closest('.spy-modal-overlay').remove()" style="background:none; border:none; color:#9ca3af; font-size:1.4rem; cursor:pointer; padding:0; line-height:1; font-weight:bold;">✕</button>
            </div>
            <div class="spy-modal-body" style="max-height:360px; overflow-y:auto; padding-right:2px; box-sizing:border-box;">
                ${listHtml}
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
};

// ADMIN SELEKTOR LIGY
window.selectAdminLeague = (leagueName) => {
    const store = Alpine.store('appState');
    if (store) {
        store.selectedAdminLeague = leagueName;
        window.renderAdminMatches();
    }
};

// ADMIN: VYKRESLENÍ ZÁPASŮ PRO SPRÁVU
window.renderAdminMatches = async () => {
    const container = document.getElementById('adminMatchesContainer');
    if (!container) return;

    const store = Alpine.store('appState');
    // 🔐 FRONTENDOVÝ ZÁMEK: Běžný tiper nemá právo spouštět admin skripty
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
        const lDoc = await db.collection('ligy').doc(activeAdminLeague).get();
        const lData = lDoc.exists ? lDoc.data() : { vitez: '', strelec: '' };
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

        // NOVÁ CESTA: Načítáme z vnořené kolekce admin zápasů
        const snapshot = await db.collection('ligy').doc(activeAdminLeague).collection('zapasy').get();

        if (snapshot.empty) {
            container.innerHTML = backBtnHtml + headerTitleHtml + roletkaZapasHtml + roletkaGlobalHtml + '<h3 style="color:#fff; font-size:1rem; margin-bottom:10px; text-align:left; font-family:\'Oswald\', sans-serif;">⚽ AKTUÁLNÍ ZÁPASY</h3><div class="db-empty-msg">V této soutěži zatím nejsou vytvořené žádné zápasy.</div>';
            return;
        }

        let zZapasy = [];
        snapshot.forEach(doc => { zZapasy.push({ id: doc.id, ...doc.data() }); });
        zZapasy.sort((a, b) => (a.datum?.toDate ? a.datum.toDate() : 0) - (b.datum?.toDate ? b.datum.toDate() : 0));

        let activeMatchesHtml = '';
        let evaluatedMatchesHtml = '';

        zZapasy.forEach(match => {
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

            let realResultHtml = '';
            if (isSaved) {
                let postupLabel = (match.isPlayoff && match.vysledek_domaci === match.vysledek_hoste && match.postup) ? '*' : '';
                realResultHtml = `<span class="user-tip-value result-value-color">${match.vysledek_domaci} : ${match.vysledek_hoste}${postupLabel}</span>`;
            } else {
                realResultHtml = `<span class="user-tip-value no-tip">? : ?</span>`;
            }

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

            if (isSaved) {
                evaluatedMatchesHtml += matchHtml;
            } else {
                activeMatchesHtml += matchHtml;
            }
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
        // NOVÁ CESTA: Aktualizujeme dokument v podsložke zápasů ligy
        await db.collection('ligy').doc(activeAdminLeague).collection('zapasy').doc(matchId).update({
            datum: firebase.firestore.Timestamp.fromDate(new Date(newVal))
        });
        
        window.showToast("📅 Čas zápasu úspěšně upraven!");
        window.renderAdminMatches();
    } catch (e) {
        alert("Chyba úpravy data: " + e.message);
    }
};

// ADMIN: SMAZÁNÍ ZÁPASU VČETNÊ JEHO TIPŮ
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
            // NOVÁ CESTA: Mažeme tipy z podsložky této ligy
            const tipsSnapshot = await db.collection('ligy').doc(activeAdminLeague).collection('tipy').where('matchId', '==', matchId).get();
            const smazatTipySliby = [];
            tipsSnapshot.forEach(doc => { smazatTipySliby.push(doc.ref.delete()); });
            await Promise.all(smazatTipySliby);

            // NOVÁ CESTA: Smažeme zápas z podsložky ligy
            await db.collection('ligy').doc(activeAdminLeague).collection('zapasy').doc(matchId).delete();
            
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
        // NOVÁ CESTA: Přidáváme zápas do vnořené subkolekce ligy
        await db.collection('ligy').doc(leagueName).collection('zapasy').add({
            domaci: domaci,
            hoste: hoste,
            datum: firebase.firestore.Timestamp.fromDate(new Date(datumVal)),
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
        // Zůstává v hlavní kolekci 'ligy', kde držíme globální parametry turnaje
        await db.collection('ligy').doc(leagueName).set({
            vitez: vitez,
            strelec: strelec,
            aktualizovano: firebase.firestore.FieldValue.serverTimestamp()
        });

        window.showToast(`⚙️ Výsledky turnaje ${leagueName} uloženy!`);

        const btn = document.getElementById('btn-admin-save-global');
        if (btn) {
            btn.innerText = 'ULOŽENO ✔';
            setTimeout(() => { if (btn) btn.innerText = 'ZAPSAT'; }, 2000);
        }

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

    // SITUACE A: Reset zápasu zpět k otazníkům
    if (valDomaci === "" && valHoste === "") {
        try {
            // NOVÁ CESTA: Mažeme položky výsledku uvnitř dokumentu zápasu v subkolekci ligy
            await db.collection('ligy').doc(activeAdminLeague).collection('zapasy').doc(matchId).update({
                vysledek_domaci: firebase.firestore.FieldValue.delete(),
                vysledek_hoste: firebase.firestore.FieldValue.delete(),
                postup: firebase.firestore.FieldValue.delete()
            });

            window.showToast("🔄 Zápas odemčen a vrácen k tipování!");
            window.renderAdminMatches();
            return;
        } catch (e) {
            console.error("Chyba resetu:", e);
            return;
        }
    }

    // SITUACE B: Neúplný výsledek
    if (valDomaci === "" || valHoste === "") {
        window.showToast("⚠️ Vyber obě čísla, nebo nech oba otazníky!", true);
        return;
    }

    // SITUACE C: Standardní zápis regulérního skóre
    let postupVal = '';
    const dVal = parseInt(valDomaci);
    const hVal = parseInt(valHoste);
    const hiddenAdminInput = document.getElementById(`playoff-admin-val-${matchId}`);

    if (hiddenAdminInput && dVal === hVal) {
        postupVal = hiddenAdminInput.value;
        if (!postupVal) {
            window.showToast("🏆 V play-off musíš při remíze zvolit postupujícího!", true);
            return;
        }
    }

    try {
        // NOVÁ CESTA: Ukládáme skóre do podsložky zápasů ligy
        await db.collection('ligy').doc(activeAdminLeague).collection('zapasy').doc(matchId).update({
            vysledek_domaci: dVal,
            vysledek_hoste: hVal,
            postup: postupVal
        });

        window.showToast("⚙️ Skóre uloženo, tabulky přegenerovány!");
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
    if (headerRight) {
        headerRight.style.width = "";
        headerRight.innerHTML = '';
    }
    
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
                    <div class="scoring-card-title text-muted">🥅 GÓL ÚTÊCHY</div>
                    <div class="scoring-card-desc">Netrefíš nic, ale uhodneš přesný počet gólů aspoň jednoho týmu</div>
                </div>
                <div class="match-points-badge badge-pts-zero">+1 b.</div>
            </div>
            <div class="zebra-block scoring-card font-white">
                <div class="scoring-card-info">
                    <div class="scoring-card-title text-blue">⏱️ VÍTÊZ PRODLOUŽENÍ</div>
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
            document.getElementById(`playoff-admin-dom-${matchId}`).style.background = '#111827';
            document.getElementById(`playoff-admin-hos-${matchId}`).style.background = '#111827';
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

// A) PRO HRÁČE: HROMADNÉ UKLÁDÁNÍ TIPŮ
window.saveAllUserTips = async (leagueName) => {
    const user = auth.currentUser;
    if (!user) return;

    const container = document.querySelector('#matchesScreen .zebra-container');
    if (!container) return;

    const vsechnyRoletkyDomaci = container.querySelectorAll('[id^="tip-domaci-"]');
    let citacNovychTipu = 0;
    const listSlibuFirebase = [];

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

            // NOVÁ CESTA: Zápis do podsložky tipů ligy v hromadné operaci
            listSlibuFirebase.push(
                db.collection('ligy').doc(leagueName).collection('tipy').doc(`${user.uid}_${matchId}`).set({
                    userId: user.uid,
                    userEmail: user.email,
                    matchId: matchId,
                    tip_domaci: dVal,
                    tip_hoste: hVal,
                    postup: postupVal,
                    vytvoreno: firebase.firestore.FieldValue.serverTimestamp()
                })
            );
            citacNovychTipu++;
        }
    });

    if (citacNovychTipu === 0) {
        window.showToast("⚠️ Navol nejprve v roletkách nějaké výsledky!", true);
        return;
    }

    try {
        await Promise.all(listSlibuFirebase);
        window.showToast(`⚡ Bleskově uloženo ${citacNovychTipu} tipů najednou!`);
        window.renderMatches(leagueName);
    } catch (e) {
        console.error("Chyba hromadného tipování:", e);
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

            // NOVÁ CESTA: Hromadná aktualizace v podsložce zápasů ligy
            listSlibuFirebase.push(
                db.collection('ligy').doc(activeAdminLeague).collection('zapasy').doc(matchId).update({
                    vysledek_domaci: dVal,
                    vysledek_hoste: hVal,
                    postup: postupVal
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
// 👑 SUPER ADMIN: CHYTRÝ PANEL SE ZÁLOŽKAMI (API / UŽIVATELÉ)
// =========================================================================

// Stavová proměnná pro aktivní záložku (výchozí je 'api')
window.superAdminActiveTab = window.superAdminActiveTab || 'api';

// Přepínač záložek
window.switchSuperAdminTab = (tabName) => {
    window.superAdminActiveTab = tabName;
    window.renderSuperAdmin();
};

window.renderSuperAdmin = async () => {
    const container = document.getElementById('superAdminContainer');
    if (!container) return;

    const store = Alpine.store('appState');
    
    // 🔐 KORUNNÍ BEZPEČNOST: Sem nesmí wkročit nikdo kromě tebe
    if (!store || !store.isSuperAdmin) {
        window.goToScreen('leaguesScreen');
        return;
    }

    container.innerHTML = '<div class="db-empty-msg">Otevírám vládní trezor...</div>';

    const tab = window.superAdminActiveTab;

    // Styl pro tlačítka záložek navrchu
    const btnStyleApi = tab === 'api' ? 'background: #2563eb; color: white; border-color: #60a5fa;' : 'background: #1f2937; color: #9ca3af; border-color: #374151;';
    const btnStyleUsers = tab === 'users' ? 'background: #2563eb; color: white; border-color: #60a5fa;' : 'background: #1f2937; color: #9ca3af; border-color: #374151;';

    let tabContentHtml = '';

    try {
        // --- ZÁLOŽKA A: GLOBÁLNÍ API KOKPIT ---
        if (tab === 'api') {
            tabContentHtml = `
                <div class="content-box" style="background:#111827; border:1px solid #374151; padding:18px; border-radius:12px; width:100%; box-sizing:border-box; margin-top: 5px;">
                    <h3 style="font-family:'Oswald', sans-serif; color:#38bdf8; font-size:1.1rem; margin-top:0; margin-bottom:15px; text-transform:uppercase; text-align:left; letter-spacing:0.5px;">📡 Globální API Ovládání</h3>
                    <div style="display:flex; flex-direction:column; gap:12px;">
                        <div>
                            <label class="bonus-input-label" style="text-align:left; margin-bottom:4px;">Cílová soutěž pro synchronizaci:</label>
                            <select id="super-api-league-select" class="bonus-text-input" style="background:#1f2937; height:42px; padding:5px; text-align-last:left; color:#fff;">
                                <option value="MS v hokeji">MS v hokeji</option>
                                <option value="MS ve fotbale">MS ve fotbale 2026</option>
                                <option value="Tipsport Extraliga">Tipsport Extraliga</option>
                                <option value="Chance Liga">Chance Liga</option>
                            </select>
                        </div>
                        <div>
                            <label class="bonus-input-label" style="text-align:left; margin-bottom:4px;">Tvůj API Klíč (X-Auth-Token):</label>
                            <input type="password" id="api-key-input" placeholder="Vlož svůj tajný token z dashboardu" class="bonus-text-input" style="background:#1f2937; text-align:left; padding:10px; height:42px;">
                        </div>
                        <div>
                            <label class="bonus-input-label" style="text-align:left; margin-bottom:4px;">ID / Kód ligy z API-Football:</label>
                            <input type="text" id="api-league-id-input" placeholder="Např. WC nebo konkrétní číslo" class="bonus-text-input" style="background:#1f2937; text-align:left; padding:10px; height:42px;">
                        </div>
                        <div style="display:flex; gap:8px; margin-top:8px;">
                            <button class="action-btn" onclick="window.triggerSuperApi('import')" style="background:#2563eb; font-size:0.75rem; height:42px; padding:0; margin:0; flex:1; font-weight:bold;">🛠️ IMPORT ROZPISU</button>
                            <button class="action-btn" onclick="window.triggerSuperApi('results')" style="background:#059669; font-size:0.75rem; height:42px; padding:0; margin:0; flex:1; font-weight:bold;">🎯 KONTROLA VÝSLEDKŮ</button>
                        </div>
                    </div>
                </div>
            `;
        } 
        
        // --- ZÁLOŽKA B: MANAGEMENT UŽIVATELŮ A ROLÍ ---
        else if (tab === 'users') {
            // Načteme seznam všech aktuálně připojených e-mailů z nové online tabulky
            const onlineSnapshot = await db.collection('uzivatele_online').get().catch(() => null);
            const onlineEmails = new Set();
            if (onlineSnapshot) {
                onlineSnapshot.forEach(d => onlineEmails.add(d.id));
            }

            const snapshot = await db.collection('users').get();
            let usersRowsHtml = '';

            snapshot.forEach(doc => {
                const email = doc.id;
                
                // 🔐 NEKOMPROMISNÍ POJISTKA: Tebe (makyana) v seznamu úplně přeskočíme, nikdo ti na práva nesáhne!
                if (email === 'makyan13@seznam.cz') return;

                const userData = doc.data();
                const nickname = userData.nickname || 'Zatím nezadána ⏳';
                const role = userData.role || 'tiper';

                // 🟢 Výpočet online / offline vizitky
                const isOnline = onlineEmails.has(email.trim().toLowerCase());
                let statusBadgeHtml = '';

                if (isOnline) {
                    statusBadgeHtml = `<span style="font-size: 0.82rem; color: #10b981; font-weight: bold; background: rgba(16,185,129,0.15); padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(16,185,129,0.3);">🟢 PRÁVĚ ONLINE</span>`;
                } else {
                    const lastSeenTs = userData.lastSeen;
                    let lastSeenText = 'Nikdy ✕';
                    if (lastSeenTs && typeof lastSeenTs.toDate === 'function') {
                        lastSeenText = lastSeenTs.toDate().toLocaleDateString('cs-CZ', {
                            day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit'
                        });
                    }
                    statusBadgeHtml = `<span style="font-size: 0.78rem; color: #9ca3af;">⏱️ NAPOSLEDY: <strong style="font-family:monospace; color:#e5e7eb;">${lastSeenText}</strong></span>`;
                }

                usersRowsHtml += `
                    <div class="zebra-block" style="display: flex; flex-direction: column; align-items: stretch; gap: 10px; padding: 14px; margin-bottom: 4px; background: #1f2937; border: 1px solid #374151;">
                        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #374151; padding-bottom: 8px;">
                            <span style="color: #9ca3af; font-size: 0.8rem; font-family: monospace; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 55%;">📧 ${email}</span>
                            <span style="color: #fbbf24; font-weight: bold; font-size: 0.95rem; font-family: 'Oswald', sans-serif;">🎮 ${nickname}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; background: rgba(0,0,0,0.15); padding: 6px 10px; border-radius: 6px;">
                            <span style="font-size: 0.82rem; color: #9ca3af;">Stav aktivity:</span>
                            ${statusBadgeHtml}
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <span style="font-size: 0.82rem; color: #e5e7eb;">Pravomoci:</span>
                                <select onchange="window.updateUserRole('${email}', this.value)" style="width: auto; max-width: 120px; height: 36px; padding: 0 8px; font-size: 0.8rem; margin: 0; background: #111827; color: white; border: 1px solid #4b5563; border-radius: 6px; text-align-last: left; font-weight: bold; cursor: pointer;">
                                    <option value="tiper" ${role === 'tiper' ? 'selected' : ''}>⚽ TIPER</option>
                                    <option value="admin" ${role === 'admin' ? 'selected' : ''}>⚙️ ADMIN</option>
                                </select>
                            </div>
                            <button onclick="window.superAdminDeleteUser('${email}', '${nickname}')" style="background: #dc2626; color: white; border: none; padding: 0 12px; height: 36px; border-radius: 6px; font-weight: bold; font-size: 0.75rem; cursor: pointer; text-transform: uppercase; font-family: 'Oswald', sans-serif;">🗑️ SMAZAT</button>
                        </div>
                    </div>
                `;
            });

            if (!usersRowsHtml) {
                usersRowsHtml = '<div class="db-empty-msg">Na stadionu zatím nejsou žádní registrovaní kluci.</div>';
            }

            tabContentHtml = `
                <div class="content-box" style="background:#111827; border:1px solid #ea580c; padding:18px; border-radius:12px; width:100%; box-sizing:border-box; margin-top: 5px; margin-bottom: 20px;">
                    <h3 style="font-family:'Oswald', sans-serif; color:#ea580c; font-size:1.1rem; margin-top:0; margin-bottom:12px; text-transform:uppercase; text-align:left; letter-spacing:0.5px;">🔄 Převod dat (Záchrana bodů)</h3>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        <div>
                            <label class="bonus-input-label" style="text-align:left; margin-bottom:4px;">Starý e-mail (Ztracený / Původní):</label>
                            <input type="email" id="transfer-stary-email" placeholder="stary-ucet@seznam.cz" class="bonus-text-input" style="background:#1f2937; text-align:left; padding:10px; height:38px;">
                        </div>
                        <div>
                            <label class="bonus-input-label" style="text-align:left; margin-bottom:4px;">Nový e-mail (Zbrusu nový / Cílový):</label>
                            <input type="email" id="transfer-novy-email" placeholder="novy-ucet@gmail.com" class="bonus-text-input" style="background:#1f2937; text-align:left; padding:10px; height:38px;">
                        </div>
                        <button class="action-btn" onclick="window.triggerTransferHrace()" style="background:#ea580c; font-size:0.8rem; height:40px; padding:0; margin-top:5px; font-weight:bold; font-family:'Oswald', sans-serif;">🎯 SPUSTIT TRANSFÉR BODŮ</button>
                    </div>
                </div>

                <div class="content-box" style="background:#111827; border:1px solid #374151; padding:18px; border-radius:12px; width:100%; box-sizing:border-box; margin-top: 5px;">
                    <h3 style="font-family:'Oswald', sans-serif; color:#ffffff; font-size:1.1rem; margin-top:0; margin-bottom:15px; text-transform:uppercase; text-align:left; letter-spacing:0.5px;">👥 Správa ligových účastníků</h3>
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        ${usersRowsHtml}
                    </div>
                </div>
            `;
        }

        // Finální sestavení celého okna (Záhlaví záložek + aktivní obsah)
        container.innerHTML = `
            <div style="display: flex; gap: 8px; width: 100%; margin-bottom: 15px; box-sizing: border-box;">
                <button class="nav-btn" style="flex: 1; height: 42px; border-radius: 8px; font-weight: bold; font-family: 'Oswald', sans-serif; text-transform: uppercase; font-size: 0.85rem; border: 1px solid; cursor: pointer; transition: background 0.2s; margin: 0; justify-content: center; ${btnStyleApi}" onclick="window.switchSuperAdminTab('api')">
                    📡 API Kokpit
                </button>
                <button class="nav-btn" style="flex: 1; height: 42px; border-radius: 8px; font-weight: bold; font-family: 'Oswald', sans-serif; text-transform: uppercase; font-size: 0.85rem; border: 1px solid; cursor: pointer; transition: background 0.2s; margin: 0; justify-content: center; ${btnStyleUsers}" onclick="window.switchSuperAdminTab('users')">
                    👥 Uživatelé
                </button>
            </div>
            
            ${tabContentHtml}
        `;

    } catch (e) {
        console.error(e);
        container.innerHTML = '<div class="err-box">❌ Selhalo bezpečné načtení vládního panelu.</div>';
    }
};

// Živá asynchronní aktualizace role z roletky přímo do dokumentu uživatele
window.updateUserRole = async (email, newRole) => {
    try {
        await db.collection('users').doc(email).update({
            role: newRole,
            aktualizovano: firebase.firestore.FieldValue.serverTimestamp()
        });
        window.showToast("👑 Práva úspěšně upravena!");
        window.renderSuperAdmin();
    } catch (e) {
        alert("Chyba změny role: " + e.message);
    }
};

window.triggerSuperApi = (action) => {
    const selectedLeague = document.getElementById('super-api-league-select').value;
    const store = Alpine.store('appState');
    if (store) {
        store.selectedAdminLeague = selectedLeague;
    }
    
    if (action === 'import') {
        window.importMatchesFromApi();
    } else {
        window.updateResultsFromApi();
    }
};

// FUNKCE PRO VYNUCENÉ ULOŽENÍ UNIKÁTNÍ PŘEZDÍVKY HRÁČE
window.saveNickname = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const nickInput = document.getElementById('new-nickname');
    const nickVal = nickInput ? nickInput.value.trim() : '';

    if (!nickVal || nickVal.length < 3) {
        alert("Přezdívka musí mít aspoň 3 znaky! 🧐");
        return;
    }

    if (nickVal.length > 16) {
        alert("Přezdívka je moc dlouhá, maximum je 16 znaků! 🛑");
        return;
    }

    try {
        // Kontrola, zda už přezdívku nepoužívá někdo jiný
        const duplicateCheck = await db.collection('users').where('nickname', '==', nickVal).get();
        if (!duplicateCheck.empty) {
            alert("Tuhle přezdívku už vyfoukl někdo před tebou! Zvol si jinou. 🤯");
            return;
        }

        // Zjistíme, jestli dokument uživatele existuje, abychom nepřepsali roli, pokud už nějakou má
        const docRef = db.collection('users').doc(user.email);
        const docSnap = await docRef.get();
        
        let stajRole = 'tiper'; // Výchozí stav pro nováčky
        if (docSnap.exists && docSnap.data().role) {
            stajRole = docSnap.data().role;
        }

        // Zapíšeme přezdívku s uchováním role
        await docRef.set({
            nickname: nickVal,
            role: stajRole,
            vytvoreno: firebase.firestore.FieldValue.serverTimestamp()
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

// 👑 SUPER ADMIN: KOMPLETNÍ SMAZÁNÍ UŽIVATELE A VŠECH JEHO DAT ZE VŠECH LIG
window.superAdminDeleteUser = async (email, nickname) => {
    const emailNormalized = email.trim().toLowerCase();
    
    const potvrzeni = confirm(`🚨 KONEČNÝ ROZSUDEK!\nOpravdu chceš hráče "${nickname}" (${emailNormalized}) kompletně vymazat ze systému?\n\nTato akce trvale smaže jeho profil, vykopne ho z živého připojení a vymaže VŠECHNY jeho uložené tipy a bonusy napříč všemi ligami!`);
    if (!potvrzeni) return;

    window.showToast("⏳ Zahajuji hloubkovou čistku hráče...", false);

    try {
        // 1. Smazání profilu z 'users' a real-time přítomnosti z 'uzivatele_online'
        await db.collection('users').doc(emailNormalized).delete();
        await db.collection('uzivatele_online').doc(emailNormalized).delete().catch(() => {});

        // Seznam všech definovaných lig v aplikaci
        const ligy = ['MS v hokeji', 'MS ve fotbale', 'Tipsport Extraliga', 'Chance Liga'];
        let smazanoTipyCelkem = 0;

        // 2. Projití všech lig a smazání vázaných tipů a bonusů
        for (const liga of ligy) {
            // Smazání dlouhodobých bonusů pro danou ligu
            const bonusySnap = await db.collection('ligy').doc(liga).collection('bonusy').where('userEmail', '==', emailNormalized).get();
            const bonusySliby = [];
            bonusySnap.forEach(doc => bonusySliby.push(doc.ref.delete()));
            await Promise.all(bonusySliby);

            // Smazání běžných tipů na zápasy pro danou ligu
            const tipySnap = await db.collection('ligy').doc(liga).collection('tipy').where('userEmail', '==', emailNormalized).get();
            const tipySliby = [];
            tipySnap.forEach(doc => {
                tipySliby.push(doc.ref.delete());
                smazanoTipyCelkem++;
            });
            await Promise.all(tipySliby);
        }

        window.showToast(`🗑️ Čistka úspěšná! Profil smazán a odstraněno ${smazanoTipyCelkem} tipů.`);
        
        // Obnovíme zobrazení Super Admina
        if (typeof window.renderSuperAdmin === 'function') {
            window.renderSuperAdmin();
        }
    } catch (error) {
        console.error("Chyba při mazání uživatele:", error);
        alert("❌ Došlo k chybě při promazávání databáze: " + error.message);
    }
};

// ⚙️ AUTOMATICKÉ AKTUALIZAČNÍ HÁČKY PRO RUČNÍ ZÁPIS ADMINA
const starejSaveRealResult = window.saveRealResult;
window.saveRealResult = async (matchId) => {
    await starejSaveRealResult(matchId);
    const activeAdminLeague = Alpine.store('appState')?.selectedAdminLeague;
    if (activeAdminLeague) await window.aktualizujCentralniZebricek(activeAdminLeague);
};

const starejSaveAllAdminResults = window.saveAllAdminResults;
window.saveAllAdminResults = async () => {
    await starejSaveAllAdminResults();
    const activeAdminLeague = Alpine.store('appState')?.selectedAdminLeague;
    if (activeAdminLeague) await window.aktualizujCentralniZebricek(activeAdminLeague);
};

// 👑 CENTRALIZOVANÝ GENIÁLNÍ PŘEDVÝPOČET ŽEBŘÍČKU (PROVOZ NAVŽDY 100% ZDARMA)
window.aktualizujCentralniZebricek = async (leagueName) => {
    try {
        console.log(`🧠 Spouštím centrální přepočet tabulek pro ligu: ${leagueName}...`);
        const matchesSnapshot = await db.collection('ligy').doc(leagueName).collection('zapasy').get();
        const lZapasy = {};
        matchesSnapshot.forEach(doc => { lZapasy[doc.id] = doc.data(); });

        const leagueDoc = await db.collection('ligy').doc(leagueName).get();
        const realLeagueData = leagueDoc.exists ? leagueDoc.data() : null;

        const tipsSnapshot = await db.collection('ligy').doc(leagueName).collection('tipy').get();
        const bonusTipsSnapshot = await db.collection('ligy').doc(leagueName).collection('bonusy').get();

        const vsichniHraciEmaily = new Set();
        tipsSnapshot.forEach(doc => { if (doc.data().userEmail) vsichniHraciEmaily.add(doc.data().userEmail.trim().toLowerCase()); });
        bonusTipsSnapshot.forEach(doc => { if (doc.data().userEmail) vsichniHraciEmaily.add(doc.data().userEmail.trim().toLowerCase()); });

        const hracStats = {};
        vsichniHraciEmaily.forEach(email => {
            hracStats[email] = {
                celkemBodu: 0,
                natipovaneVyhodnocene: 0,
                nenatipovaneVyhodnocene: 0,
                presneVysledkyCount: 0,
                bodyPoKolech: { 1: 0, 2: 0, 3: 0, 4: 0 }, 
                nejStrelec: '–',
                vitezMs: '–',
                nejviceBoduVKole: 0
            };
        });

        const mapaTipu = {};
        tipsSnapshot.forEach(doc => {
            const tip = doc.data();
            if (tip.userEmail) {
                const emailKey = tip.userEmail.trim().toLowerCase();
                if (!mapaTipu[emailKey]) mapaTipu[emailKey] = {};
                mapaTipu[emailKey][tip.matchId] = tip;
            }
        });

        const jeFotbaloveMS = (leagueName === "MS ve fotbale" || leagueName === "MS ve fotbale 2026");

        const usersSnapshot = await db.collection('users').get();
        const mapaPrezdivek = {};
        usersSnapshot.forEach(uDoc => {
            mapaPrezdivek[uDoc.id.trim().toLowerCase()] = uDoc.data().nickname || uDoc.id;
        });

        vsichniHraciEmaily.forEach(email => {
            Object.keys(lZapasy).forEach(matchId => {
                const zapas = lZapasy[matchId];
                const jeVyhodnoceny = (zapas.vysledek_domaci !== undefined && zapas.vysledek_hoste !== undefined);

                if (jeVyhodnoceny) {
                    const uživatelůvTip = mapaTipu[email] ? mapaTipu[email][matchId] : null;
                    let bodyZapasu = 0;

                    if (uživatelůvTip) {
                        bodyZapasu = window.vypocitejBodyZapasu(
                            uživatelůvTip.tip_domaci, uživatelůvTip.tip_hoste,
                            zapas.vysledek_domaci, zapas.vysledek_hoste,
                            leagueName, uživatelůvTip.postup, zapas.postup, zapas.isPlayoff
                        );
                        hracStats[email].celkemBodu += bodyZapasu;
                        hracStats[email].natipovaneVyhodnocene++;
                        
                        if (parseInt(uživatelůvTip.tip_domaci) === parseInt(zapas.vysledek_domaci) && 
                            parseInt(uživatelůvTip.tip_hoste) === parseInt(zapas.vysledek_hoste)) {
                            hracStats[email].presneVysledkyCount++;
                        }
                    } else {
                        if (jeFotbaloveMS) { hracStats[email].celkemBodu -= 1; }
                        hracStats[email].nenatipovaneVyhodnocene++;
                    }

                    if (zapas.kolo && hracStats[email].bodyPoKolech[zapas.kolo] !== undefined) {
                        hracStats[email].bodyPoKolech[zapas.kolo] += bodyZapasu;
                    }
                }
            });
        });

        bonusTipsSnapshot.forEach(doc => {
            const bTip = doc.data();
            if (bTip.userEmail) {
                const emailKey = bTip.userEmail.trim().toLowerCase();
                if (hracStats[emailKey]) {
                    hracStats[emailKey].nejStrelec = bTip.strelec || '–';
                    hracStats[emailKey].vitezMs = bTip.vitez || '–';
                }
            }
        });

        let maxPresnychGlobal = 0;
        let maxBoduKoloGlobal = 0;

        vsichniHraciEmaily.forEach(email => {
            const kolaBodove = [hracStats[email].bodyPoKolech[1], hracStats[email].bodyPoKolech[2], hracStats[email].bodyPoKolech[3], hracStats[email].bodyPoKolech[4]];
            hracStats[email].nejviceBoduVKole = Math.max(...kolaBodove);
            if (hracStats[email].presneVysledkyCount > maxPresnychGlobal) maxPresnychGlobal = hracStats[email].presneVysledkyCount;
            if (hracStats[email].nejviceBoduVKole > maxBoduKoloGlobal) maxBoduKoloGlobal = hracStats[email].nejviceBoduVKole;
        });

        let kraliPresnosti = [];
        let rekordmaniKola = [];

        vsichniHraciEmaily.forEach(email => {
            const nick = mapaPrezdivek[email] || email;
            if (hracStats[email].presneVysledkyCount === maxPresnychGlobal && maxPresnychGlobal > 0) kraliPresnosti.push(nick);
            if (hracStats[email].nejviceBoduVKole === maxBoduKoloGlobal && maxBoduKoloGlobal > 0) rekordmaniKola.push(nick);
        });

        // Přepíšeme starý centrální dokument zbrusu novým aktuálním stavem
        await db.collection('ligy').doc(leagueName).collection('stav').doc('zebricek').set({
            hracStats: hracStats,
            mapaTipu: mapaTipu,
            lZapasy: lZapasy,
            realLeagueData: realLeagueData,
            mapaPrezdivek: mapaPrezdivek,
            textKraliPresnosti: kraliPresnosti.length > 0 ? `${kraliPresnosti.join(', ')} (${maxPresnychGlobal}x)` : '–',
            textRekordmaniKola: rekordmaniKola.length > 0 ? `${rekordmaniKola.join(', ')} (${maxBoduKoloGlobal} b.)` : '–'
        });
        console.log(`🎯 Centrální balíček pro ligu "${leagueName}" úspěšně aktualizován.`);
    } catch (e) {
        console.error("Kritická chyba centralizace dat:", e);
    }
};

// Pomocný spouštěč transferu z UI formuláře
window.triggerTransferHrace = () => {
    const stary = document.getElementById('transfer-stary-email').value;
    const novy = document.getElementById('transfer-novy-email').value;
    window.superAdminPrevedDataHrace(stary, novy);
};

// JÁDRO PŘEVODU: Najde data starého e-mailu, přepíše je na nový a přepočítá tabulky
window.superAdminPrevedDataHrace = async (staryEmail, novyEmail) => {
    const staryEmailNorm = staryEmail.trim().toLowerCase();
    const novyEmailNorm = novyEmail.trim().toLowerCase();

    if (!staryEmailNorm || !novyEmailNorm) {
        alert("Musíš vyplnit oba e-maily! 🧐");
        return;
    }

    if (staryEmailNorm === novyEmailNorm) {
        alert("E-maily se nesmí shodovat! Vždyť převádíš data z jednoho na druhý. 🤯");
        return;
    }

    const prvotniPotvrzeni = confirm(`🚨 REKONSTRUKCE ÚČTU!\nOpravdu chceš převést všechny tipy a body z e-mailu:\n➡️ ${staryEmailNorm}\n\nna zbrusu nový účet:\n➡️ ${novyEmailNorm}?`);
    if (!prvotniPotvrzeni) return;

    window.showToast("⏳ Převádím data na jiný e-mail...", false);

    try {
        // 1. Zkontrolujeme starý profil
        const staryUserSnap = await db.collection('users').doc(staryEmailNorm).get();
        if (!staryUserSnap.exists) {
            alert("Chyba: Starý e-mail nemá v databázi žádný profil! Prověř překlepy. ✕");
            return;
        }
        const staryUserData = staryUserSnap.data();
        const staraPrezdivka = staryUserData.nickname;

        // 2. Zkontrolujeme nový profil
        const novyUserSnap = await db.collection('users').doc(novyEmailNorm).get();
        if (!novyUserSnap.exists) {
            alert("Chyba: Nový e-mail se ještě v aplikaci neregistroval (nemá založený profil)! Kluk se musí nejdřív pod novým mailem aspoň jednou přihlásit do appky. ✕");
            return;
        }
        const noveUid = novyUserSnap.data().userId; 
        if (!noveUid) {
            alert("Chyba: Nový profil nemá vygenerované userId! Kluk musí nejdřív vlézt do appky.");
            return;
        }

        // 3. Aktualizujeme profil nového uživatele - přepíšeme mu přezdívku na tu starou
        await db.collection('users').doc(novyEmailNorm).update({
            nickname: staraPrezdivka,
            aktualizovano: firebase.firestore.FieldValue.serverTimestamp()
        });

        const ligy = ['MS v hokeji', 'MS ve fotbale', 'Tipsport Extraliga', 'Chance Liga'];

        // 4. Projdeme všechny ligy a přepíšeme vlastnictví dat
        for (const liga of ligy) {
            // A) Migrace dlouhodobých bonusů
            const bonusySnap = await db.collection('ligy').doc(liga).collection('bonusy').where('userEmail', '==', staryEmailNorm).get();
            for (const doc of bonusySnap.docs) {
                const bData = doc.data();
                await db.collection('ligy').doc(liga).collection('bonusy').doc(noveUid).set({
                    ...bData,
                    userId: noveUid,
                    userEmail: novyEmailNorm
                });
                await doc.ref.delete();
            }

            // B) Migrace běžných tipů na zápasy
            const tipySnap = await db.collection('ligy').doc(liga).collection('tipy').where('userEmail', '==', staryEmailNorm).get();
            for (const doc of tipySnap.docs) {
                const tData = doc.data();
                const matchId = tData.matchId;
                await db.collection('ligy').doc(liga).collection('tipy').doc(`${noveUid}_${matchId}`).set({
                    ...tData,
                    userId: noveUid,
                    userEmail: novyEmailNorm
                });
                await doc.ref.delete();
            }

            // C) Vyvoláme realtime přepočet žebříčku pro upravenou ligu
            await window.aktualizujCentralniZebricek(liga);
        }

        // 5. Definitivně smažeme starý prázdný skelet profilu z 'users'
        await db.collection('users').doc(staryEmailNorm).delete();

        window.showToast(`🎯 Úspěšně převedeno! Přezdívka "${staraPrezdivka}" i body připsány.`);
        
        if (typeof window.renderSuperAdmin === 'function') {
            window.renderSuperAdmin();
        }

    } catch (error) {
        console.error("Chyba při převodu uživatele:", error);
        alert("❌ Selhal vládní transfer dat: " + error.message);
    }
};