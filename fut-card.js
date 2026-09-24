// =========================================================================
// 🃏 TIPNI TO! - FUT-STYLE HRÁČSKÉ KARTY & 3D EXPORT ENGINE (fut-card.js)
// =========================================================================

import { CONFIG } from "./config.js";

const canvasContext = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;

window.openPlayerProfile = (targetUid, targetLeague = undefined) => {
    const store = Alpine.store('appState');
    if (!store) return;
    const currentUid = window.auth?.currentUser?.uid;
    const uid = targetUid || currentUid;
    if (!uid) return;

    store.profileTargetUid = uid;
    store.profileReturnScreen = store.currentScreen || 'leaguesScreen';
    store.isMenuOpen = false;

    window.goToScreen('profileScreen');
    window.renderPlayerProfile(uid, targetLeague);
};

window.flipCard3D = () => {
    const cardObj = document.getElementById('futCardObject');
    if (cardObj) {
        cardObj.classList.toggle('is-flipped');
    }
};

window.posunProfileLeague = (smer, uid) => {
    const keys = window.profileCurrentAvailableLeagues || ['ALL'];
    const curFilter = window.playerProfileActiveFilter || 'ALL';
    let idx = keys.indexOf(curFilter);
    if (idx === -1) idx = 0;
    let newIdx = idx + smer;
    if (newIdx < 0) newIdx = keys.length - 1;
    if (newIdx >= keys.length) newIdx = 0;
    window.renderPlayerProfile(uid, keys[newIdx]);
};

window.renderPlayerProfile = (targetUid, leagueFilter = undefined) => {
    const store = Alpine.store('appState');
    const container = document.getElementById('profileCardContainer');
    const carouselContainer = document.getElementById('profileLeagueCarousel') || document.getElementById('profileLeaguePills');
    if (!container || !store) return;

    const currentUid = window.auth?.currentUser?.uid;
    const uid = targetUid || store.profileTargetUid || currentUid;
    if (!uid) return;

    const allLeagues = (CONFIG && CONFIG.MASTER_LEAGUES) ? CONFIG.MASTER_LEAGUES : ['Chance Liga', 'Premier League', 'Liga mistrů', 'Tipsport Extraliga', 'MS v hokeji', 'MS ve fotbale'];
    const sezId = store.activeSeason || window.SEZONA_ID || "2026_2027";
    const cardsByLeague = {};
    let playerNickname = '';

    allLeagues.forEach(lName => {
        const lKlic = String(lName).replace(/ /g, "_");
        let lb = (lName === store.selectedLeague && store.leaderboardData)
            ? store.leaderboardData
            : store.leaguesMemoryCache?.[lName]?.leaderboardData;

        if (!lb) {
            try {
                const cached = localStorage.getItem(`tipni_cache_lb_${sezId}_${lKlic}`);
                if (cached) lb = JSON.parse(cached);
            } catch(e) {}
        }
        if (lb && (lb.zebricek || lb.zebricekLive)) {
            const isLiveLeague = Boolean(lb.isLive || store.liveLeaguesMap?.[lName]);
            const list = (isLiveLeague && lb.zebricekLive && lb.zebricekLive.length > 0)
                ? lb.zebricekLive
                : (lb.zebricek || lb.zebricekLive || []);

            const p = list.find(x => x.uid === uid);
            if (p && p.futCard) {
                const odehranoZapasu = (p.natipovaneVyhodnocene || p.natipovaneVyhodnoceneLive || 0) + (p.nenatipovaneVyhodnocene || p.nenatipovaneVyhodnoceneLive || 0);
                if (odehranoZapasu > 0) {
                    cardsByLeague[lName] = p.futCard;
                }
                if (!playerNickname && p.nickname) playerNickname = p.nickname;
            }
        }
    });

    if (!playerNickname) {
        const userDoc = window.adminUsersCache?.find(u => u.id === uid);
        const uData = userDoc ? (typeof userDoc.data === 'function' ? userDoc.data() : userDoc) : null;
        playerNickname = uData?.nickname || (uid === currentUid ? store.nickname : 'Hráč');
    }

    const availableLeagueNames = Object.keys(cardsByLeague);
    let masterCard = null;

    let hofData = store?.hallOfFameData;
    if (!hofData) {
        try {
            const cached = localStorage.getItem(`tipni_cache_hof_${sezId}`);
            if (cached) hofData = JSON.parse(cached);
        } catch(e) {}
    }
    const serverPlayer = (hofData?.all || hofData?.players)?.find(p => p.uid === uid);
    if (serverPlayer) {
        masterCard = {
            ovr: serverPlayer.masterOvr || serverPlayer.ovr,
            tier: serverPlayer.tier,
            archetype: serverPlayer.archetype,
            archetypeName: serverPlayer.archetypeName,
            specialization: serverPlayer.specialization || `Specializace: ${serverPlayer.bestLeague}`,
            isMaster: true,
            leagueName: serverPlayer.bestLeague,
            stats: serverPlayer.stats,
            badges: serverPlayer.badges,
            backSide: serverPlayer.backSide
        };
    }

    const pillOptions = [];
    if (masterCard) {
        pillOptions.push({ key: 'ALL', label: '🏛️ VŠECHNY LIGY' });
    }
    availableLeagueNames.forEach(lKey => {
        pillOptions.push({ key: lKey, label: lKey.toUpperCase() });
    });

    if (leagueFilter !== undefined) {
        window.playerProfileActiveFilter = leagueFilter;
    } else if (!window.playerProfileActiveFilter || !pillOptions.some(o => o.key === window.playerProfileActiveFilter)) {
        window.playerProfileActiveFilter = (masterCard) ? 'ALL' : (availableLeagueNames[0] || 'ALL');
    }

    const currentFilter = window.playerProfileActiveFilter;
    window.profileCurrentAvailableLeagues = pillOptions.map(o => o.key);

    const activeCard = (currentFilter === 'ALL' && masterCard) ? masterCard : (cardsByLeague[currentFilter] || masterCard || {
        ovr: 60, tier: 'bronze', archetype: 'TAK', archetypeName: 'Taktik',
        stats: { pre: 60, odv: 60, clu: 60, sta: 60, for: 60, efe: 60 },
        badges: { streaks: 0, exacts: 0, draws: 0, maxRound: 0, roundWins: 0, perfektniKola: 0 },
        backSide: { totalMatches: 0, bestCatch: 'Zatím bez úlovku', favTendency: '–' }
    });

    if (uid === currentUid) {
        const masterOvr = masterCard ? masterCard.ovr : (activeCard?.ovr ?? 60);
        store.myOvr = masterOvr;
        localStorage.setItem('tipni_cache_my_ovr', String(masterOvr));
    }

    if (carouselContainer) {
        const curPillIdx = pillOptions.findIndex(o => o.key === currentFilter);
        const activePillOpt = curPillIdx !== -1 ? pillOptions[curPillIdx] : pillOptions[0];

        const pOptionsHtml = pillOptions.map(opt => `
            <div class="custom-dropdown-item ${opt.key === currentFilter ? 'is-active' : ''}" onclick="window.renderPlayerProfile('${uid}', '${opt.key}')">
                ${opt.label}
            </div>
        `).join('');

        carouselContainer.innerHTML = `
            <div class="carousel-container" style="margin: 0 0 16px 0;">
                <button class="nav-btn-leaderboard carousel-btn" onclick="window.posunProfileLeague(-1, '${uid}')">◀</button>
                <div class="custom-dropdown-wrapper">
                    <div class="custom-dropdown-trigger" onclick="const m = this.nextElementSibling; const isVis = m.style.display === 'flex'; m.style.display = isVis ? 'none' : 'flex';">
                        <span>${activePillOpt ? activePillOpt.label : 'VÝBĚR'}</span>
                        <span class="custom-dropdown-arrow">▼</span>
                    </div>
                    <div class="custom-dropdown-menu" style="display: none;">
                        ${pOptionsHtml}
                    </div>
                </div>
                <button class="nav-btn-leaderboard carousel-btn" onclick="window.posunProfileLeague(1, '${uid}')">▶</button>
            </div>
        `;
    }

    const logoLiga = (currentFilter === 'ALL') ? (activeCard.leagueName || 'Chance Liga') : currentFilter;
    const crestUrl = window.getLeagueLogo ? window.getLeagueLogo(logoLiga) : '';

    const badgeExacts = activeCard.badges?.exacts || 0;
    const badgeStreaks = activeCard.badges?.streaks || 0;
    const badgeDraws = activeCard.badges?.draws || 0;
    const badgeMaxRound = activeCard.badges?.maxRound || 0;

    const vypocitejPismoKarty = (text) => {
        if (!canvasContext) return '1.55rem';
        canvasContext.font = "bold 25px 'Oswald', sans-serif";
        const widthPx = canvasContext.measureText(text.toUpperCase()).width;
        const targetWidthPx = 240;
        if (widthPx <= targetWidthPx) return '1.55rem';
        const rem = Math.max(1.05, (targetWidthPx / widthPx) * 1.55);
        return `${rem.toFixed(2)}rem`;
    };

    const cardNickFontSize = vypocitejPismoKarty(playerNickname);

    window.activeFUTCardExport = {
        card: activeCard,
        nickname: playerNickname,
        crestUrl: crestUrl,
        badgesData: {
            exacts: badgeExacts,
            streaks: badgeStreaks,
            draws: badgeDraws,
            maxRound: badgeMaxRound
        }
    };

    window.__cardWasFlippedBeforeRender = Boolean(document.getElementById('futCardObject')?.classList.contains('is-flipped'));

    container.innerHTML = `
        <div class="fut-card-perspective">
            <div class="fut-card-object" id="futCardObject" onclick="window.flipCard3D()">
                <div class="fut-card-face card-front tier-${activeCard.tier}">
                    <div class="fut-front-header">
                        <div class="fut-ovr-group">
                            <span class="fut-ovr-value">${activeCard.ovr}</span>
                            <span class="fut-archetype-tag">${activeCard.archetype}</span>
                        </div>
                        ${crestUrl ? `<img src="${crestUrl}" class="fut-league-crest" alt="Crest">` : '<div style="width:38px;height:38px;"></div>'}
                    </div>

                    <div class="fut-player-info">
                        <div class="fut-player-name" style="font-size: ${cardNickFontSize};">${window.escapeHTML(playerNickname)}</div>
                        <div class="fut-archetype-name">${activeCard.specialization ? activeCard.specialization : activeCard.archetypeName}</div>
                    </div>

                    <div class="fut-stats-matrix">
                        <div class="fut-stat-cell"><span class="fut-stat-num">${activeCard.stats?.pre ?? 60}</span><span class="fut-stat-label">PŘESNOST</span></div>
                        <div class="fut-stat-cell"><span class="fut-stat-num">${activeCard.stats?.odv ?? 60}</span><span class="fut-stat-label">ODVAHA</span></div>
                        <div class="fut-stat-cell"><span class="fut-stat-num">${activeCard.stats?.clu ?? 60}</span><span class="fut-stat-label">PSYCHIKA</span></div>
                        <div class="fut-stat-cell"><span class="fut-stat-num">${activeCard.stats?.sta ?? 60}</span><span class="fut-stat-label">STABILITA</span></div>
                        <div class="fut-stat-cell"><span class="fut-stat-num">${activeCard.stats?.for ?? 60}</span><span class="fut-stat-label">FORMA</span></div>
                        <div class="fut-stat-cell"><span class="fut-stat-num">${activeCard.stats?.efe ?? 60}</span><span class="fut-stat-label">EFEKTIVITA</span></div>
                    </div>

                    <div class="fut-badges-footer">
                        <div class="fut-badge-item ${badgeExacts > 0 ? '' : 'is-empty'}">
                            <span class="fut-badge-icon">🎯</span>
                            <span class="fut-badge-count">${badgeExacts}×</span>
                            <span class="fut-badge-label">PŘESNÉ</span>
                        </div>
                        <div class="fut-badge-item ${badgeStreaks > 0 ? '' : 'is-empty'}">
                            <span class="fut-badge-icon">🚀</span>
                            <span class="fut-badge-count">${badgeStreaks}</span>
                            <span class="fut-badge-label">SÉRIE</span>
                        </div>
                        <div class="fut-badge-item ${badgeDraws > 0 ? '' : 'is-empty'}">
                            <span class="fut-badge-icon">🤝</span>
                            <span class="fut-badge-count">${badgeDraws}×</span>
                            <span class="fut-badge-label">REMÍZY</span>
                        </div>
                        <div class="fut-badge-item ${badgeMaxRound > 0 ? '' : 'is-empty'}">
                            <span class="fut-badge-icon">⚡</span>
                            <span class="fut-badge-count">${badgeMaxRound} b.</span>
                            <span class="fut-badge-label">REKORD</span>
                        </div>
                    </div>
                </div>

                <div class="fut-card-face card-back tier-${activeCard.tier}">
                    <div class="fut-back-wrapper">
                        <div class="fut-back-title">DETAILNÍ ANALÝZA</div>
                        <div class="fut-back-rows">
                            <div class="fut-back-row">
                                <span class="fut-back-lbl">Odehrané zápasy:</span>
                                <span class="fut-back-val">${activeCard.backSide?.totalMatches ?? 0}</span>
                            </div>
                            <div class="fut-back-row">
                                <span class="fut-back-lbl">Průměrný zisk:</span>
                                <span class="fut-back-val">${window.escapeHTML(activeCard.backSide?.avgRoundPts ?? '0.0 b.')} / kolo</span>
                            </div>
                            <div class="fut-back-row">
                                <span class="fut-back-lbl">Ligový percentil:</span>
                                <span class="fut-back-val">${window.escapeHTML(activeCard.backSide?.percentile ?? '–')}</span>
                            </div>
                            <div class="fut-back-row fut-back-row-tendency">
                                <span class="fut-back-lbl">Preferovaná tendence:</span>
                                <div class="fut-tendency-pills">
                                    ${(() => {
                                        const raw = activeCard.backSide?.favTendency || '';
                                        const m1 = raw.match(/1:\s*(\d+)\s*%/);
                                        const mX = raw.match(/X:\s*(\d+)\s*%/);
                                        const m2 = raw.match(/2:\s*(\d+)\s*%/);
                                        const v1 = m1 ? `${m1[1]} %` : '–';
                                        const vX = mX ? `${mX[1]} %` : '–';
                                        const v2 = m2 ? `${m2[1]} %` : '–';
                                        return `
                                            <div class="fut-pill-item"><span class="fut-pill-lbl">1</span><span class="fut-pill-val">${v1}</span></div>
                                            <div class="fut-pill-item"><span class="fut-pill-lbl">X</span><span class="fut-pill-val">${vX}</span></div>
                                            <div class="fut-pill-item"><span class="fut-pill-lbl">2</span><span class="fut-pill-val">${v2}</span></div>
                                        `;
                                    })()}
                                </div>
                            </div>
                            <div class="fut-back-row fut-back-row-style">
                                <div class="fut-style-header">
                                    <span class="fut-back-lbl">Herní styl:</span>
                                    <span class="fut-back-val">${activeCard.archetypeName} (${activeCard.archetype})</span>
                                </div>
                                <div class="fut-style-desc">
                                    ${(() => {
                                        const descs = {
                                            'STR': 'Pragmatický styl. Volí přímočaré tipy s cílem vytěžit body a vyhýbá se zbytečným experimentům.',
                                            'ODS': 'Důraz na přesná skóre. Preferuje trefování konkrétních výsledků před tipy na pouhé vítěze zápasů.',
                                            'HAZ': 'Hra proti většině. Vybírá remízy a zápasy s vyššími kurzy namísto spoléhání na papírové favority.',
                                            'CLU': 'Zaměření na šlágry. Výsledky staví především na těsných duelech a prestižních zápasech kola.',
                                            'TAK': 'Pravidelný styl. Hraje na disciplínu bez vynechaných kol a snaží se o stabilní přísun bodů.',
                                            'PRE': 'Hráč nálad a sérií. Výsledky u něj přicházejí ve vlnách a silně závisí na aktuálním rozpoložení.'
                                        };
                                        return descs[activeCard.archetype] || 'Vyrovnaný herní styl bez výrazné dominantní tendence.';
                                    })()}
                                </div>
                            </div>
                        </div>
                        <div class="fut-back-hint">🔄 Klepnutím otočíš kartu zpět</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    if (typeof window.__cardWasFlippedBeforeRender !== 'undefined' && window.__cardWasFlippedBeforeRender) {
        const cardObj = document.getElementById('futCardObject');
        if (cardObj) cardObj.classList.add('is-flipped');
    }
};

window.sharePlayerCard = async (event) => {
    const data = window.activeFUTCardExport;
    if (!data || !data.card) {
        window.showToast("Karta není připravena ke sdílení.", true);
        return;
    }

    const shareBtn = event?.target?.closest('button') || document.querySelector('#profileScreen button[onclick*="sharePlayerCard"]') || document.querySelector('.fut-share-btn');
    const originalText = shareBtn ? shareBtn.innerText : '📸 SDÍLET KARTU (ULOŽIT)';

    if (shareBtn) {
        shareBtn.disabled = true;
        shareBtn.style.opacity = '0.6';
        shareBtn.innerText = '⏳ PŘIPRAVUJI KARTU...';
    }

    try {
        if (document.fonts) {
            try {
                await document.fonts.load("bold 58px 'Oswald'");
                await document.fonts.load("bold 92px 'Oswald'");
                await document.fonts.load("bold 32px 'Oswald'");
                await document.fonts.ready;
            } catch (fontErr) {
                console.warn("Chyba při načítání fontů před exportem:", fontErr);
            }
        }

        const c = data.card;
        const nick = data.nickname;
        const badges = data.badgesData || { exacts: 0, streaks: 0, draws: 0, maxRound: 0 };

        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 1880;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            if (shareBtn) {
                shareBtn.disabled = false;
                shareBtn.style.opacity = '1';
                shareBtn.innerText = originalText;
            }
            return;
        }

        ctx.fillStyle = '#070b14';
        ctx.fillRect(0, 0, 640, 1880);

        const nakresliTvarKarty = (context, x, y, w, h) => {
            const rT = 36;
            const rB = 54;
            context.beginPath();
            context.moveTo(x + rT, y);
            context.lineTo(x + w - rT, y);
            context.quadraticCurveTo(x + w, y, x + w, y + rT);
            context.lineTo(x + w, y + h - rB);
            context.quadraticCurveTo(x + w, y + h, x + w - rB, y + h);
            context.lineTo(x + rB, y + h);
            context.quadraticCurveTo(x, y + h, x, y + h - rB);
            context.lineTo(x, y + rT);
            context.quadraticCurveTo(x, y, x + rT, y);
            context.closePath();
        };

        const borderColor = c.tier === 'gold' ? '#fbbf24' : (c.tier === 'elite' ? '#38bdf8' : (c.tier === 'silver' ? '#cbd5e1' : '#d97706'));

        ctx.save();
        nakresliTvarKarty(ctx, 0, 0, 640, 920);
        ctx.clip();

        let gradFront = ctx.createLinearGradient(0, 0, 640, 920);
        if (c.tier === 'elite') {
            gradFront.addColorStop(0, '#090d16');
            gradFront.addColorStop(0.45, '#1e1b4b');
            gradFront.addColorStop(1, '#020617');
        } else if (c.tier === 'gold') {
            gradFront.addColorStop(0, '#1f1505');
            gradFront.addColorStop(0.4, '#522606');
            gradFront.addColorStop(0.75, '#78350f');
            gradFront.addColorStop(1, '#1c1005');
        } else if (c.tier === 'silver') {
            gradFront.addColorStop(0, '#0f172a');
            gradFront.addColorStop(0.4, '#1e293b');
            gradFront.addColorStop(0.75, '#334155');
            gradFront.addColorStop(1, '#0f172a');
        } else {
            gradFront.addColorStop(0, '#1c0d06');
            gradFront.addColorStop(0.4, '#3f1d0b');
            gradFront.addColorStop(0.75, '#5c240d');
            gradFront.addColorStop(1, '#180a04');
        }
        ctx.fillStyle = gradFront;
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = "bold 92px 'Oswald', sans-serif";
        ctx.textAlign = 'left';
        ctx.fillText(String(c.ovr), 55, 130);

        ctx.fillStyle = '#fbbf24';
        ctx.font = "bold 34px 'Oswald', sans-serif";
        ctx.fillText(String(c.archetype), 58, 178);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(470, 68, 115, 34, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fbbf24';
        ctx.font = "bold 15px 'Oswald', sans-serif";
        ctx.textAlign = 'center';
        ctx.fillText('★ SOUTĚŽ ★', 527, 90);

        ctx.font = "bold 58px 'Oswald', sans-serif";
        let nickWidth = ctx.measureText(nick.toUpperCase()).width;
        let nickFontSize = 58;
        while (nickWidth > 500 && nickFontSize > 34) {
            nickFontSize -= 4;
            ctx.font = `bold ${nickFontSize}px 'Oswald', sans-serif`;
            nickWidth = ctx.measureText(nick.toUpperCase()).width;
        }
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(nick.toUpperCase(), 320, 275);

        ctx.fillStyle = '#94a3b8';
        ctx.font = "bold 26px 'Oswald', sans-serif";
        const subtext = c.specialization ? c.specialization : c.archetypeName;
        ctx.fillText(subtext.toUpperCase(), 320, 320);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(90, 350);
        ctx.lineTo(550, 350);
        ctx.stroke();

        const statsList = [
            { num: c.stats?.pre ?? 60, lbl: 'PŘESNOST' },
            { num: c.stats?.clu ?? 60, lbl: 'PSYCHIKA' },
            { num: c.stats?.for ?? 60, lbl: 'FORMA' },
            { num: c.stats?.odv ?? 60, lbl: 'ODVAHA' },
            { num: c.stats?.sta ?? 60, lbl: 'STABILITA' },
            { num: c.stats?.efe ?? 60, lbl: 'EFEKTIVITA' }
        ];

        const rowYs = [435, 530, 625];
        for (let i = 0; i < 3; i++) {
            ctx.textAlign = 'right';
            ctx.font = "bold 46px 'Oswald', sans-serif";
            ctx.fillStyle = '#ffffff';
            ctx.fillText(String(statsList[i].num), 200, rowYs[i]);
            ctx.textAlign = 'left';
            ctx.font = "bold 32px 'Oswald', sans-serif";
            ctx.fillStyle = '#cbd5e1';
            ctx.fillText(statsList[i].lbl, 218, rowYs[i]);

            ctx.textAlign = 'right';
            ctx.font = "bold 46px 'Oswald', sans-serif";
            ctx.fillStyle = '#ffffff';
            ctx.fillText(String(statsList[i + 3].num), 440, rowYs[i]);
            ctx.textAlign = 'left';
            ctx.font = "bold 32px 'Oswald', sans-serif";
            ctx.fillStyle = '#cbd5e1';
            ctx.fillText(statsList[i + 3].lbl, 458, rowYs[i]);
        }

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 755, 640, 165);

        const badgeCols = [80, 240, 400, 560];
        const badgesToDraw = [
            { icon: '🎯', count: `${badges.exacts}×`, label: 'PŘESNÉ' },
            { icon: '🚀', count: `${badges.streaks}`, label: 'SÉRIE' },
            { icon: '🤝', count: `${badges.draws}×`, label: 'REMÍZY' },
            { icon: '⚡', count: `${badges.maxRound} b.`, label: 'REKORD' }
        ];

        badgesToDraw.forEach((b, idx) => {
            const x = badgeCols[idx];
            ctx.textAlign = 'center';
            ctx.font = "38px 'Segoe UI', sans-serif";
            ctx.fillText(b.icon, x, 810);
            ctx.font = "bold 32px 'Oswald', sans-serif";
            ctx.fillStyle = '#fbbf24';
            ctx.fillText(b.count, x, 855);
            ctx.font = "bold 20px 'Oswald', sans-serif";
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(b.label, x, 888);
        });

        ctx.restore();

        ctx.save();
        nakresliTvarKarty(ctx, 0, 0, 640, 920);
        ctx.lineWidth = 10;
        ctx.strokeStyle = borderColor;
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = '#10b981';
        ctx.font = "bold 20px 'Oswald', sans-serif";
        ctx.textAlign = 'center';
        ctx.fillText('⚽ TIPNI TO! • ZADNÍ STRANA NÍŽE ▼', 320, 946);

        const y0 = 960;
        ctx.save();
        nakresliTvarKarty(ctx, 0, y0, 640, 920);
        ctx.clip();

        let gradBack = ctx.createLinearGradient(0, y0, 640, y0 + 920);
        gradBack.addColorStop(0, '#0b0f19');
        gradBack.addColorStop(0.5, '#0f172a');
        gradBack.addColorStop(1, '#080c14');
        ctx.fillStyle = gradBack;
        ctx.fill();

        ctx.textAlign = 'center';
        ctx.fillStyle = '#fbbf24';
        ctx.font = "bold 36px 'Oswald', sans-serif";
        ctx.fillText('DETAILNÍ ANALÝZA', 320, y0 + 60);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(80, y0 + 78);
        ctx.lineTo(560, y0 + 78);
        ctx.stroke();

        const nakresliBox = (bx, by, bw, bh) => {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(bx, by, bw, bh, 10);
            ctx.fill();
            ctx.stroke();
        };

        nakresliBox(40, y0 + 100, 560, 80);
        ctx.textAlign = 'left';
        ctx.font = "bold 20px 'Oswald', sans-serif";
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('ODEHRANÉ ZÁPASY:', 60, y0 + 132);
        ctx.font = "bold 34px 'Oswald', sans-serif";
        ctx.fillStyle = '#f1f5f9';
        ctx.fillText(String(c.backSide?.totalMatches ?? 0), 60, y0 + 168);

        nakresliBox(40, y0 + 195, 560, 80);
        ctx.textAlign = 'left';
        ctx.font = "bold 20px 'Oswald', sans-serif";
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('PRŮMĚRNÝ ZISK:', 60, y0 + 227);
        ctx.font = "bold 34px 'Oswald', sans-serif";
        ctx.fillStyle = '#f1f5f9';
        ctx.fillText(`${c.backSide?.avgRoundPts ?? '0.0 b.'} / kolo`, 60, y0 + 263);

        nakresliBox(40, y0 + 290, 560, 80);
        ctx.textAlign = 'left';
        ctx.font = "bold 20px 'Oswald', sans-serif";
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('LIGOVÝ PERCENTIL:', 60, y0 + 322);
        ctx.font = "bold 34px 'Oswald', sans-serif";
        ctx.fillStyle = '#f1f5f9';
        ctx.fillText(String(c.backSide?.percentile ?? '–'), 60, y0 + 358);

        nakresliBox(40, y0 + 385, 560, 102);
        ctx.textAlign = 'left';
        ctx.font = "bold 20px 'Oswald', sans-serif";
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('PREFEROVANÁ TENDENCE:', 60, y0 + 417);

        const rawTend = c.backSide?.favTendency || '';
        const m1 = rawTend.match(/1:\s*(\d+)\s*%/);
        const mX = rawTend.match(/X:\s*(\d+)\s*%/);
        const m2 = rawTend.match(/2:\s*(\d+)\s*%/);
        const v1 = m1 ? `${m1[1]} %` : '–';
        const vX = mX ? `${mX[1]} %` : '–';
        const v2 = m2 ? `${m2[1]} %` : '–';

        const pills = [
            { lbl: '1', val: v1, x: 60 },
            { lbl: 'X', val: vX, x: 235 },
            { lbl: '2', val: v2, x: 410 }
        ];

        pills.forEach(p => {
            ctx.fillStyle = '#0f172a';
            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(p.x, y0 + 432, 140, 42, 6);
            ctx.fill();
            ctx.stroke();

            ctx.textAlign = 'left';
            ctx.font = "bold 22px 'Oswald', sans-serif";
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(p.lbl, p.x + 16, y0 + 461);

            ctx.textAlign = 'right';
            ctx.font = "bold 26px 'Oswald', sans-serif";
            ctx.fillStyle = '#38bdf8';
            ctx.fillText(p.val, p.x + 124, y0 + 462);
        });

        nakresliBox(40, y0 + 502, 560, 245);
        ctx.textAlign = 'left';
        ctx.font = "bold 20px 'Oswald', sans-serif";
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('HERNÍ STYL:', 60, y0 + 534);

        ctx.font = "bold 32px 'Oswald', sans-serif";
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${c.archetypeName} (${c.archetype})`, 60, y0 + 574);

        ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
        ctx.beginPath();
        ctx.roundRect(60, y0 + 597, 520, 130, 8);
        ctx.fill();

        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(60, y0 + 597, 6, 130);

        const descs = {
            'STR': 'Pragmatický styl. Volí přímočaré tipy s cílem vytěžit body a vyhýbá se zbytečným experimentům.',
            'ODS': 'Důraz na přesná skóre. Preferuje trefování konkrétních výsledků před tipy na pouhé vítěze zápasů.',
            'HAZ': 'Hra proti většině. Vybírá remízy a zápasy s vyššími kurzy namísto spoléhání na papírové favority.',
            'CLU': 'Zaměření na šlágry. Výsledky staví především na těsných duelech a prestižních zápasech kola.',
            'TAK': 'Pravidelný styl. Hraje na disciplínu bez vynechaných kol a snaží se o stabilní přísun bodů.',
            'PRE': 'Hráč nálad a sérií. Výsledky u něj přicházejí ve vlnách a silně závisí na aktuálním rozpoložení.'
        };
        const descText = descs[c.archetype] || 'Vyrovnaný herní styl bez výrazné dominantní tendence.';

        ctx.font = "22px 'Segoe UI', sans-serif";
        ctx.fillStyle = '#cbd5e1';
        ctx.textAlign = 'left';

        const words = descText.split(' ');
        let line = '';
        let lY = y0 + 638;
        words.forEach(w => {
            const test = line ? `${line} ${w}` : w;
            if (ctx.measureText(test).width > 480 && line) {
                ctx.fillText(line, 82, lY);
                line = w;
                lY += 34;
            } else {
                line = test;
            }
        });
        if (line) ctx.fillText(line, 82, lY);

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, y0 + 785, 640, 135);

        ctx.textAlign = 'center';
        ctx.font = "bold 28px 'Oswald', sans-serif";
        ctx.fillStyle = '#10b981';
        ctx.fillText('⚽ TIPNI TO! • SOUTĚŽNÍ SEZÓNA', 320, y0 + 860);

        ctx.restore();

        ctx.save();
        nakresliTvarKarty(ctx, 0, y0, 640, 920);
        ctx.lineWidth = 10;
        ctx.strokeStyle = borderColor;
        ctx.stroke();
        ctx.restore();

        canvas.toBlob(async (blob) => {
            try {
                if (!blob) {
                    window.showToast("Chyba při exportu karty.", true);
                    return;
                }
                const filename = `${nick.replace(/[^a-zA-Z0-9]/g, '_')}_FUT_karta.png`;
                const file = new File([blob], filename, { type: 'image/png' });

                const stahniJakoSoubor = () => {
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = filename;
                    a.click();
                    URL.revokeObjectURL(a.href);
                    window.showToast("📸 Karta hráče stažena do počítače!");
                };

                const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

                if (isMobileDevice && navigator.canShare && navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({
                            title: `TIPNI TO! – Karta hráče ${nick}`,
                            files: [file]
                        });
                        return;
                    } catch (err) {
                        if (err.name === 'AbortError') return;
                        stahniJakoSoubor();
                        return;
                    }
                }

                stahniJakoSoubor();
            } finally {
                if (shareBtn) {
                    shareBtn.disabled = false;
                    shareBtn.style.opacity = '1';
                    shareBtn.innerText = originalText;
                }
            }
        }, 'image/png');

    } catch (err) {
        console.error("Chyba při generování karty:", err);
        window.showToast("❌ Chyba při generování karty.", true);
        if (shareBtn) {
            shareBtn.disabled = false;
            shareBtn.style.opacity = '1';
            shareBtn.innerText = originalText;
        }
    }
};