// =========================================================================
// 🏆 TIPNI TO! - POHÁROVÝ ENGINE: CHANCE CUP & PREMIER CUP (cup.js)
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
    const leagueName = overrideLeague || store?.selectedLeague || localStorage.getItem('savedLeague') || 'Premier League';
    const activeTab = store?.cupActiveTab || 'groups';
    
    const isPL = String(leagueName || '').toLowerCase().includes('premier');
    const cupTitle = isPL ? 'TIPNI PREMIER CUP' : 'TIPNI CHANCE CUP';

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
    // 🌳 PODZÁLOŽKA 2: PAVOUK
    // ─────────────────────────────────────────────────────────────────────
    if (activeTab === 'bracket') {
        if (!isPlayoff) {
            if (isPL) {
                container.innerHTML = `
                    <div class="cup-wrapper">
                        <div class="cup-preview-badge">
                            <span>🌳</span>
                            <span>OFICIÁLNÍ STRUKTURA PAVOUKA (Start od 21. kola)</span>
                        </div>
                        <div class="cup-bracket-tree">
                            <div class="cup-stage-box" style="border-color: rgba(251, 191, 36, 0.4); background: rgba(251, 191, 36, 0.03);">
                                <div class="cup-stage-header" style="color: #fbbf24;">
                                    <span>🏆 GRAND FINÁLE (32. KOLO)</span>
                                    <span style="color: #fbbf24; font-weight: bold;">1 ROZHODUJÍCÍ ZÁPAS</span>
                                </div>
                                <div class="cup-match-slot" style="justify-content: space-between; font-weight: bold; color: #fff;">
                                    <span>👑 Vítěz Semifinále 1</span>
                                    <span style="color: #fbbf24;">vs.</span>
                                    <span>👑 Vítěz Semifinále 2</span>
                                </div>
                            </div>
                            <div class="cup-stage-box">
                                <div class="cup-stage-header" style="color: #f87171;">
                                    <span>🔥 SEMIFINÁLE (29. & 30. KOLO)</span>
                                    <span>2 duely • Součet 2 kol</span>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 6px;">
                                    <div class="cup-match-slot"><span>Vítěz Čtvrtfinále 1</span><span style="color: #64748b;">vs.</span><span>Vítěz Čtvrtfinále 2</span></div>
                                    <div class="cup-match-slot"><span>Vítěz Čtvrtfinále 3</span><span style="color: #64748b;">vs.</span><span>Vítěz Čtvrtfinále 4</span></div>
                                </div>
                            </div>
                            <div class="cup-stage-box">
                                <div class="cup-stage-header" style="color: #fbbf24;">
                                    <span>👑 ČTVRTFINÁLE (27. & 28. KOLO)</span>
                                    <span>4 duely • Nástup vítězů skupin</span>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 6px;">
                                    <div class="cup-match-slot"><span style="color: #fbbf24; font-weight: bold;">1. ze skupiny A</span><span style="color: #64748b;">vs.</span><span>Vítěz Osmifinále 1</span></div>
                                    <div class="cup-match-slot"><span style="color: #fbbf24; font-weight: bold;">1. ze skupiny B</span><span style="color: #64748b;">vs.</span><span>Vítěz Osmifinále 2</span></div>
                                    <div class="cup-match-slot"><span style="color: #fbbf24; font-weight: bold;">1. ze skupiny C</span><span style="color: #64748b;">vs.</span><span>Vítěz Osmifinále 3</span></div>
                                    <div class="cup-match-slot"><span style="color: #fbbf24; font-weight: bold;">1. ze skupiny D</span><span style="color: #64748b;">vs.</span><span>Vítěz Osmifinále 4</span></div>
                                </div>
                            </div>
                            <div class="cup-stage-box">
                                <div class="cup-stage-header" style="color: #34d399;">
                                    <span>🏆 OSMIFINÁLE (25. & 26. KOLO)</span>
                                    <span>4 duely • Nástup 2. míst</span>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 6px;">
                                    <div class="cup-match-slot"><span style="color: #34d399; font-weight: bold;">2. ze skupiny A</span><span style="color: #64748b;">vs.</span><span>Vítěz 2. Předkola 1</span></div>
                                    <div class="cup-match-slot"><span style="color: #34d399; font-weight: bold;">2. ze skupiny B</span><span style="color: #64748b;">vs.</span><span>Vítěz 2. Předkola 2</span></div>
                                    <div class="cup-match-slot"><span style="color: #34d399; font-weight: bold;">2. ze skupiny C</span><span style="color: #64748b;">vs.</span><span>Vítěz 2. Předkola 3</span></div>
                                    <div class="cup-match-slot"><span style="color: #34d399; font-weight: bold;">2. ze skupiny D</span><span style="color: #64748b;">vs.</span><span>Vítěz 2. Předkola 4</span></div>
                                </div>
                            </div>
                            <div class="cup-stage-box">
                                <div class="cup-stage-header" style="color: #c084fc;">
                                    <span>⚔️ 2. PŘEDKOLO (23. & 24. KOLO)</span>
                                    <span>4 duely • Nástup 3. míst</span>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 6px;">
                                    <div class="cup-match-slot"><span style="color: #c084fc; font-weight: bold;">3. ze skupiny C</span><span style="color: #64748b;">vs.</span><span>Vítěz 1. Předkola 1</span></div>
                                    <div class="cup-match-slot"><span style="color: #c084fc; font-weight: bold;">3. ze skupiny D</span><span style="color: #64748b;">vs.</span><span>Vítěz 1. Předkola 2</span></div>
                                    <div class="cup-match-slot"><span style="color: #c084fc; font-weight: bold;">3. ze skupiny A</span><span style="color: #64748b;">vs.</span><span>Vítěz 1. Předkola 3</span></div>
                                    <div class="cup-match-slot"><span style="color: #c084fc; font-weight: bold;">3. ze skupiny B</span><span style="color: #64748b;">vs.</span><span>Vítěz 1. Předkola 4</span></div>
                                </div>
                            </div>
                            <div class="cup-stage-box">
                                <div class="cup-stage-header" style="color: #f97316;">
                                    <span>🥊 1. PŘEDKOLO (21. & 22. KOLO)</span>
                                    <span>4 duely • 4. vs. 5. místa ze skupin</span>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 6px;">
                                    <div class="cup-match-slot"><span style="color: #fb923c; font-weight: bold;">4. ze skupiny A</span><span style="color: #64748b;">vs.</span><span style="color: #fb923c; font-weight: bold;">5. ze skupiny B</span></div>
                                    <div class="cup-match-slot"><span style="color: #fb923c; font-weight: bold;">4. ze skupiny B</span><span style="color: #64748b;">vs.</span><span style="color: #fb923c; font-weight: bold;">5. ze skupiny A</span></div>
                                    <div class="cup-match-slot"><span style="color: #fb923c; font-weight: bold;">4. ze skupiny C</span><span style="color: #64748b;">vs.</span><span style="color: #fb923c; font-weight: bold;">5. ze skupiny D</span></div>
                                    <div class="cup-match-slot"><span style="color: #fb923c; font-weight: bold;">4. ze skupiny D</span><span style="color: #64748b;">vs.</span><span style="color: #fb923c; font-weight: bold;">5. ze skupiny C</span></div>
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
    const qualText = isPL ? '(1.–9. KOLO KVALIFIKACE)' : '(1.–11. KOLO KVALIFIKACE)';
    const badgeTitle = isLocked 
        ? `ZÁKLADNÍ SKUPINY: ${cupTitle} ${lockText}` 
        : (isPL ? `JAK BY VYPADALY SKUPINY DNES? ${qualText}` : `ŽIVÝ NÁHLED KVALIFIKACE: ${cupTitle} ${qualText}`);

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