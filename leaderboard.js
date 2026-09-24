// =========================================================================
// 🏆 TIPNI TO! - ŽEBŘÍČEK, STATISTIKY, RADAR & SÍŇ SLÁVY (leaderboard.js)
// =========================================================================

import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { CONFIG } from "./config.js";
import { PRAVIDLA_LIG } from "./rules.js";
import "./excelExport.js";

const canvasContext = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;

// =========================================================================
// 📋 ADMIN REPORT GENERATOR (STÁHNOUT STAV)
// =========================================================================
window.otevriReportModal = (leagueName, tab) => {
    const store = Alpine.store('appState');
    const centralDoc = store?.leaderboardData;
    if (!centralDoc) return;

    const isLive = (tab === 'live');
    const zebricek = isLive ? (centralDoc.zebricekLive || []) : (centralDoc.zebricek || []);
    const kolaSouhrn = centralDoc.kolaSouhrn || {};

    const availableRounds = Object.keys(kolaSouhrn).filter(k => {
        const s = kolaSouhrn[k];
        return s && (s.hracKola || s.nejvicPresnych || (s.topMatch && s.topMatch.isStarted));
    });
    availableRounds.sort((a, b) => {
        const numA = parseInt(String(a).replace(/[^0-9]/g, '')) || 0;
        const numB = parseInt(String(b).replace(/[^0-9]/g, '')) || 0;
        return numB - numA;
    });

    const targetRoundKey = availableRounds[0] || centralDoc.aktivniKoloText || '';
    const souhrnKola = kolaSouhrn[targetRoundKey] || null;

    let report = `🏆 ${leagueName.toUpperCase()} – STAV & POŘADÍ\n`;
    report += isLive ? `🔴 ŽIVÝ STAV POLE / BĚHEM ZÁPASŮ\n` : `📊 AKTUÁLNÍ TABULKA A SOUHRN\n`;
    report += `────────────────────────────\n\n`;

    report += `📋 POŘADÍ TIPÉRŮ:\n`;
    let curRank = 1;
    zebricek.forEach((p, idx) => {
        if (idx > 0 && p.celkemBodu < zebricek[idx - 1].celkemBodu) {
            curRank = idx + 1;
        }
        let rankIcon = curRank === 1 ? '🥇' : (curRank === 2 ? '🥈' : (curRank === 3 ? '🥉' : `${curRank}.`));
        let deltaStr = '';
        if (isLive && p.poziceDelta) {
            deltaStr = p.poziceDelta > 0 ? ` (▲${p.poziceDelta})` : (p.poziceDelta < 0 ? ` (▼${Math.abs(p.poziceDelta)})` : '');
        }
        report += `${rankIcon} ${p.nickname}: ${p.celkemBodu} b.${deltaStr}\n`;
    });
    report += `\n────────────────────────────\n\n`;

    if (souhrnKola) {
        let koloHeader = targetRoundKey ? (targetRoundKey.includes('kolo') ? targetRoundKey : `${targetRoundKey}. KOLO`) : 'KOLO';
        report += `⚽ SOUHRN – ${koloHeader.toUpperCase()}:\n`;
        let roundItems = [];

        if (souhrnKola.hracKola && souhrnKola.hracKola.names) {
            roundItems.push(`👑 Hráč kola: ${souhrnKola.hracKola.names} (+${souhrnKola.hracKola.points} b.)`);
        }
        if (souhrnKola.nejvicPresnych && souhrnKola.nejvicPresnych.names) {
            roundItems.push(`🎯 Nejvíc přesných: ${souhrnKola.nejvicPresnych.names} (${souhrnKola.nejvicPresnych.count}×)`);
        }
        if (souhrnKola.topMatch && souhrnKola.topMatch.hasTopMatch && souhrnKola.topMatch.isStarted) {
            const tmUsers = souhrnKola.topMatch.exactUsers || [];
            const tmCnt = souhrnKola.topMatch.exactCount || 0;
            roundItems.push(`🔥 TOP zápas: ${tmCnt > 0 ? tmUsers.join(', ') : 'Nikdo netrefil'}`);
        }

        const klicKolaClean = String(targetRoundKey || '').replace(/[^0-9]/g, '');
        const roundPointsList = [];
        zebricek.forEach(p => {
            let pts = undefined;
            const bMap = isLive ? (p.bodyPoKolechLive || p.bodyPoKolech || {}) : (p.bodyPoKolech || {});
            for (const [k, v] of Object.entries(bMap)) {
                if (String(k).replace(/[^0-9]/g, '') === klicKolaClean) {
                    pts = v;
                    break;
                }
            }
            if (pts !== undefined) {
                roundPointsList.push({ nick: p.nickname, pts: pts });
            }
        });
        if (roundPointsList.length > 0) {
            const minPts = Math.min(...roundPointsList.map(x => x.pts));
            const minPlayers = roundPointsList.filter(x => x.pts === minPts).map(x => x.nick);
            const minPlayersStr = minPlayers.length > 3 ? `${minPlayers.slice(0, 3).join(', ')} a ${minPlayers.length - 3} další` : minPlayers.join(', ');
            roundItems.push(`💀 Nejméně bodů v kole: ${minPlayersStr} (${minPts >= 0 ? '+' : ''}${minPts} b.)`);
        }

        if (roundItems.length > 0) {
            report += roundItems.join('\n\n') + `\n\n`;
            report += `────────────────────────────\n\n`;
        }
    }

    let seasonSummaryItems = [];
    const topHraciKola = isLive ? (centralDoc.top3HraciKolaLive || centralDoc.top3HraciKola) : centralDoc.top3HraciKola;
    if (topHraciKola && topHraciKola.length > 0 && topHraciKola[0].count > 0) {
        seasonSummaryItems.push(`💎 Nejvíce titulů Hráč kola: ${topHraciKola[0].names} (${topHraciKola[0].count}×)`);
    }
    const topExact = isLive ? (centralDoc.top3PresneLive || centralDoc.top3Presne) : centralDoc.top3Presne;
    if (topExact && topExact.length > 0 && topExact[0].count > 0) {
        seasonSummaryItems.push(`🎯 Nejvíce přesných výsledků: ${topExact[0].names} (${topExact[0].count}×)`);
    }
    const topMatchesExact = isLive ? (centralDoc.top3PresneTopLive || centralDoc.top3PresneTop) : centralDoc.top3PresneTop;
    if (topMatchesExact && topMatchesExact.length > 0 && topMatchesExact[0].count > 0) {
        seasonSummaryItems.push(`🔥 Nejvíce přesných TOP zápasů: ${topMatchesExact[0].names} (${topMatchesExact[0].count}×)`);
    }
    const topRoundPts = isLive ? (centralDoc.top3KolaLive || centralDoc.top3Kola) : centralDoc.top3Kola;
    if (topRoundPts && topRoundPts.length > 0 && topRoundPts[0].points > 0) {
        seasonSummaryItems.push(`⚡ Rekord za jedno kolo: ${topRoundPts[0].text} (${topRoundPts[0].points} b.)`);
    }
    if (seasonSummaryItems.length > 0) {
        report += `🌟 STATISTIKY SEZÓNY:\n` + seasonSummaryItems.join('\n\n') + `\n`;
    }

    const modalHtml = `
        <div class="report-modal-content">
            <div class="report-modal-desc">
                Níže je předpřipravený text s aktuálním stavem. Můžeš ho před zkopírováním nebo odesláním libovolně upravit.
            </div>
            <textarea id="reportModalTextarea" class="report-modal-textarea">${window.escapeHTML(report)}</textarea>
            <div class="report-actions-wrapper">
                <button type="button" class="btn-report-excel" onclick="window.exportujTabulkuPoradiExcel()">
                    📊 STÁHNOUT POŘADÍ DO EXCELU (.XLSX)
                </button>
                <div class="report-actions-subgroup">
                    <button type="button" class="btn-report-copy" onclick="window.copyReportFromModal()">
                        📋 KOPÍROVAT TEXT
                    </button>
                    ${navigator.share ? `
                        <button type="button" class="btn-report-share" onclick="window.shareReportFromModal('${window.escapeHTML(leagueName)}')">
                            📤 SDÍLET
                        </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;

    window.openGlobalUiModal('📥 STÁHNOUT STAV', modalHtml);
};

window.copyReportFromModal = () => {
    const textarea = document.getElementById('reportModalTextarea');
    if (!textarea) return;
    const text = textarea.value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            window.showToast("📋 Souhrn zkopírován do schránky!");
        }).catch(() => {
            textarea.select();
            document.execCommand('copy');
            window.showToast("📋 Souhrn zkopírován do schránky!");
        });
    } else {
        textarea.select();
        document.execCommand('copy');
        window.showToast("📋 Souhrn zkopírován do schránky!");
    }
};

window.shareReportFromModal = async (leagueName) => {
    const textarea = document.getElementById('reportModalTextarea');
    if (!textarea) return;
    const text = textarea.value;
    if (navigator.share) {
        try {
            await navigator.share({
                title: `${leagueName} – stav a pořadí`,
                text: text
            });
        } catch (err) {
            if (err.name !== 'AbortError') {
                window.copyReportFromModal();
            }
        }
    } else {
        window.copyReportFromModal();
    }
};

// =========================================================================
// 🏆 ČISTÉ VYKRESLENÍ TABULKY HRÁČŮ
// =========================================================================
window.renderLeaderboard = (resetExpanded = false) => {
    const store = Alpine.store('appState');
    const leagueName = store ? store.selectedLeague : null;
    const container = document.querySelector('#leaderboardScreen .zebra-container');
    if (!container) return;

    if (!leagueName) {
        container.innerHTML = '<div class="db-empty-msg">⚠️ Žebříček je izolovaný. Nejprve běž Domů a klikni na konkrétní ligu!</div>';
        return;
    }

    const isLiveAvailable = Boolean(store?.isLive);
    if (!isLiveAvailable && window.leaderboardActiveTab === 'live') {
        window.leaderboardActiveTab = 'total';
    }

    window.leaderboardActiveTab = window.leaderboardActiveTab || 'total';
    window.leaderboardActiveSubTab = window.leaderboardActiveSubTab || 'table';

    if (window.leaderboardActiveTab === 'live' && window.leaderboardActiveSubTab === 'radar') {
        window.leaderboardActiveSubTab = 'table';
    }
    
    const tab = window.leaderboardActiveTab;
    const subTab = window.leaderboardActiveSubTab;

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

    const statusBar = document.createElement('div');
    statusBar.className = 'leaderboard-status-bar';
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
    const isAdmin = Boolean(Alpine.store('appState')?.isAdmin);
    statusBar.innerHTML = `
        ${isAdmin ? `<button type="button" class="btn-admin-report-trigger" onclick="window.otevriReportModal('${window.escapeHTML(leagueName)}', '${tab}')">📥 STÁHNOUT STAV</button>` : '<div></div>'}
        <div class="leaderboard-status-time">Aktualizováno: ${dText}</div>
    `;
    contentArea.appendChild(statusBar);

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
        if (tab === 'total' && leagueName !== "Liga mistrů") {
            const isLeagueStarted = Alpine.store('appState')?.isLeagueStarted;
            const currentUid = window.auth?.currentUser?.uid;
            const isMe = stats.uid && stats.uid === currentUid;

            let vitezVal = (stats.vitezMs || '–').toUpperCase();
            let strelecVal = (stats.nejStrelec || '–').toUpperCase();

            if (!isLeagueStarted && !isMe) {
                vitezVal = '🔒 SKRYTO DO STARTU';
                strelecVal = '🔒 SKRYTO DO STARTU';
            }

            let kanadskeVal = (stats.nejKanadske || stats.kanadske || '–').toUpperCase();
            if (!isLeagueStarted && !isMe) {
                kanadskeVal = '🔒 SKRYTO DO STARTU';
            }

            const isChance = (leagueName === "Chance Liga");
            const isExtraliga = (leagueName === "Tipsport Extraliga");

            const vitezLabel = isExtraliga ? '🏆 VÍTĚZ ZÁKLADNÍ ČÁSTI:' : '🏆 TIP NA VÍTĚZE:';
            const strelecLabel = isExtraliga ? '🥇 KRÁL STŘELCŮ:' : '🥇 TIP NA STŘELCE:';

            const vitezRowHtml = isChance ? '' : `
                <div class="leaderboard-meta-row">
                    <span class="leaderboard-meta-label">${vitezLabel}</span>
                    <span class="leaderboard-meta-value">${vitezVal}</span>
                </div>
            `;

            const strelecRowHtml = `
                <div class="leaderboard-meta-row">
                    <span class="leaderboard-meta-label">${strelecLabel}</span>
                    <span class="leaderboard-meta-value">${strelecVal}</span>
                </div>
            `;

            const kanadskeRowHtml = isExtraliga ? `
                <div class="leaderboard-meta-row">
                    <span class="leaderboard-meta-label">🍁 KANADSKÉ BODOVÁNÍ:</span>
                    <span class="leaderboard-meta-value">${kanadskeVal}</span>
                </div>
            ` : '';

            bonusRowsHtml = `
                ${vitezRowHtml}
                ${strelecRowHtml}
                ${kanadskeRowHtml}
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
                        <div class="leaderboard-stat-label">🌟 Hráč kola</div>
                        <div class="leaderboard-stat-value-gold" style="color: #c084fc;">${stats.vyhranaKolaCount || 0}x</div>
                    </div>
                    <div class="leaderboard-stat-card">
                        <div class="leaderboard-stat-label">🧭 Trefené tendence</div>
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
                        <div class="leaderboard-stat-label">💎 Perfektní kola</div>
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
                <button onclick="window.openPlayerProfile('${stats.uid}')" class="leaderboard-fut-btn">
                    🃏 KARTA HRÁČE
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

// =========================================================================
// 📊 DEDIKOVANÁ STRÁNKA: TV BROADCAST STRIP STATISTIKY
// =========================================================================
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

    const meObj = zebricek.find(p => (p.uid && p.uid === myUid) || (p.nickname && p.nickname.trim().toLowerCase() === myNickClean));

    const formatNamesBroadcast = (namesStr) => {
        if (!namesStr) return '';
        const namesArr = namesStr.split(/,\s*(?![^()]*\))/).map(n => n.trim()).filter(Boolean);
        
        const myItems = [];
        const otherNames = [];

        namesArr.forEach(n => {
            const isMe = Boolean(myNickClean && (n.toLowerCase() === myNickClean || n.toLowerCase().startsWith(myNickClean + ' ')));
            if (isMe) {
                let displayName = n;
                if (n.toLowerCase().startsWith(myNickClean + ' ')) {
                    displayName = myNick + n.slice(myNickClean.length);
                } else if (n.toLowerCase() === myNickClean) {
                    displayName = myNick;
                }
                myItems.push(displayName);
            } else {
                otherNames.push(n);
            }
        });

        const sortedNames = [];
        myItems.forEach(name => {
            sortedNames.push({ name: name, isMe: true });
        });
        otherNames.forEach(n => {
            sortedNames.push({ name: n, isMe: false });
        });

        const renderItem = (item) => `<span class="rekord-name ${item.isMe ? 'is-me' : ''}">${window.escapeHTML(item.name)}</span>`;
        const ampSep = ` <span class="rekord-amp">&</span> `;
        const commaSep = `, `;

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

    const getMyAnchorRow = (top3Array, metricKey, suffix, customVal = null, customExtra = '') => {
        if (!myNick || !meObj) return '';
        const isInTop3 = top3Array.some(item => {
            const names = (item.names || item.text || '').toLowerCase();
            return names.split(/,\s*(?![^()]*\))/).some(n => n.trim() === myNickClean || n.trim().startsWith(myNickClean + ' '));
        });
        if (isInTop3) return '';

        let val = customVal !== null ? customVal : (meObj[metricKey] !== undefined && meObj[metricKey] !== null ? meObj[metricKey] : 0);

        const uniqueVals = [...new Set(zebricek.map(p => p[metricKey] !== undefined && p[metricKey] !== null ? p[metricKey] : 0))].sort((a, b) => b - a);
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

    const preciseLabel = isLiveTab ? '🎯 LIVE NEJVÍC TREFENÝCH PŘESNÝCH VÝSLEDKŮ' : '🎯 NEJVÍC TREFENÝCH PŘESNÝCH VÝSLEDKŮ';
    const topMatchLabel = isLiveTab ? '🔥 LIVE NEJVÍC TREFENÝCH PŘESNÝCH TOP ZÁPASŮ' : '🔥 NEJVÍC TREFENÝCH PŘESNÝCH TOP ZÁPASŮ';
    const tendenceLabel = isLiveTab ? '🧭 LIVE NEJVÍC TREFENÝCH SPRÁVNÝCH TENDENCÍ' : '🧭 NEJVÍC TREFENÝCH SPRÁVNÝCH TENDENCÍ';
    const hraciKolaLabel = isLiveTab ? '💎 LIVE NEJVÍCE TITULŮ HRÁČ KOLA' : '💎 NEJVÍCE TITULŮ HRÁČ KOLA';
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
        const hracGroup = {};
        zdrojPerfektni.forEach(item => {
            const klic = item.uid || item.nickname;
            if (!hracGroup[klic]) {
                hracGroup[klic] = { uid: item.uid, nickname: item.nickname, rounds: [] };
            }
            if (item.round && !hracGroup[klic].rounds.includes(item.round)) {
                hracGroup[klic].rounds.push(item.round);
            }
        });

        const rows = Object.values(hracGroup)
            .sort((a, b) => b.rounds.length - a.rounds.length)
            .map(item => {
                const count = item.rounds.length;
                const isMe = Boolean(myNickClean && (item.nickname.toLowerCase() === myNickClean || item.nickname.toLowerCase().startsWith(myNickClean + ' ')));
                return `
                    <div class="rekord-row is-gold-tier">
                        <div class="rekord-badge">👑 ${count}x</div>
                        <div class="rekord-names-text">
                            <span class="rekord-name ${isMe ? 'is-me' : ''}">${window.escapeHTML(item.nickname)} (${window.escapeHTML(item.rounds.join(', '))})</span>
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
    const otevrenaStatistiky = isLiveTab
        ? (centralDoc.otevrenaKolaStatistikyLive || centralDoc.otevrenaKolaStatistiky || [])
        : (centralDoc.otevrenaKolaStatistiky || []);
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

            let myAnchor = '';
            if (myNick && meObj) {
                const isInTop3 = kStat.top3.some(item => {
                    const names = (item.names || '').toLowerCase();
                    return names.split(', ').some(n => n.trim() === myNickClean || n.trim().startsWith(myNickClean + ' '));
                });
                if (!isInTop3) {
                    const getPtsForRound = (p) => {
                        const ok = (p.otevrenaKola || []).find(r => r.round === kStat.round);
                        return ok ? (ok.points || 0) : 0;
                    };
                    const myVal = getPtsForRound(meObj);
                    const allVals = zebricek.map(getPtsForRound);
                    const uniqueVals = [...new Set(allVals)].sort((a, b) => b - a);
                    const rank = uniqueVals.indexOf(myVal) + 1;
                    const displayRank = rank > 0 ? `${rank}. místo` : '–';
                    myAnchor = `
                        <div class="rekord-row is-my-rank">
                            <div class="rekord-badge is-rank">${displayRank}</div>
                            <div class="rekord-names-text">
                                <span class="rekord-name is-me">${window.escapeHTML(myNick)} (${myVal} b.)</span>
                            </div>
                        </div>`;
                }
            }

            const cardHeader = isLiveTab ? `🔴 LIVE BODY V ROZEHRANÉM KOLE – ${cisloKola}. KOLO` : `📈 BODY V ROZEHRANÉM KOLE – ${cisloKola}. KOLO`;
            return `
                <div class="rekord-card ${isLiveTab ? 'is-live' : ''}">
                    <div class="rekord-card-header">${cardHeader}</div>
                    <div class="rekord-card-body">${rows}${myAnchor}</div>
                </div>`;
        }).join('');
    }

    const allCardsHtml = [
        presneBlockHtml,
        topMatchesBlockHtml,
        tendenceBlockHtml,
        hraciKolaBlockHtml,
        kolaBlockHtml,
        perfektniKoloBlockHtml,
        aktualniKoloBlockHtml
    ].filter(Boolean).join('');

    if (!allCardsHtml) {
        contentArea.innerHTML = `
            <div class="db-empty-msg" style="padding: 40px 15px; text-align: center; color: #9ca3af; line-height: 1.5;">
                📊 <strong>Statistiky a rekordy ožijí po odehrání prvních zápasů!</strong><br>
                Jakmile padnou první výsledky, objeví se zde žebříčky přesných tref, TOP zápasů, trefených tendencí i nejlepších kol. 🏟️
            </div>
        `;
        return;
    }

    contentArea.innerHTML = `
        <div style="text-align: right; color: #9ca3af; font-size: 0.72rem; font-family: monospace; margin-bottom: 10px; padding-right: 4px; text-transform: uppercase; letter-spacing: 0.5px; width: 100%; box-sizing: border-box;">
            Aktualizováno: ${dText}
        </div>
        <div style="display: flex; flex-direction: column; gap: 14px; width: 100%; box-sizing: border-box; padding-bottom: 20px;">
            ${allCardsHtml}
        </div>
    `;
};

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

// =========================================================================
// 💡 DEDIKOVANÁ STRÁNKA: LIGOVÝ RADAR (EXTRÉMY, TRENDY, TÝMY)
// =========================================================================
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

window.toggleRadarHeroRow = (rowEl) => {
    const drawer = rowEl.nextElementSibling;
    const arrow = rowEl.querySelector('.strip-arrow');
    if (drawer && drawer.classList.contains('radar-hero-drawer')) {
        const isHidden = drawer.style.display === 'none';
        drawer.style.display = isHidden ? 'block' : 'none';
        if (arrow) arrow.innerText = isHidden ? '▲' : '▼';
    }
};

window.vykresliRadar = (centralDoc, contentArea, tab, leagueName) => {
    const myNick = Alpine.store('appState')?.nickname || '';
    const myNickClean = myNick.trim().toLowerCase();
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

    // 2. 💀 TOTÁLNÍ VÝBUCH
    const vybuchyRaw = radar.totalniVybuchy || [];
    const vybuchy = [...vybuchyRaw];
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

    // 3. 🐺 VLCI SAMOTÁŘI
    const vlciRaw = radar.vlciSamotari || [];
    const vlci = [...vlciRaw];
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
                    <span class="radar-item-meta">${window.escapeHTML(v.kolo)} • Trefil jediný <strong style="color: #34d399;">${window.escapeHTML(v.hrac)}</strong>${v.tip ? ` tip ${window.escapeHTML(String(v.tip).replace(/\s*:\s*/g, ':'))}` : ''} (+${v.body} b.)</span>
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
    const maHrdinu = radar.hrdinaSezony && radar.hrdinaSezony.pocet > 0;
    const maSmolare = radar.smolarSezony && radar.smolarSezony.pocet > 0;

    if (maHrdinu || maSmolare) {
        let hrdinaRowHtml = '';
        if (maHrdinu) {
            const rawNamesStr = radar.hrdinaSezony.names || radar.hrdinaSezony.nick || '';
            const namesArr = rawNamesStr.split(', ').map(n => n.trim()).filter(Boolean);

            const myIndex = myNickClean ? namesArr.findIndex(n => n.toLowerCase() === myNickClean) : -1;
            if (myIndex > 0) {
                const [me] = namesArr.splice(myIndex, 1);
                namesArr.unshift(me);
            }

            const isMulti = namesArr.length > 1;
            const leadName = namesArr[0] || '–';
            const leadIsMe = Boolean(myNickClean && leadName.toLowerCase() === myNickClean);

            const otherNamesFormatted = namesArr.slice(1).map(n => {
                const isThisMe = Boolean(myNickClean && n.toLowerCase() === myNickClean);
                return isThisMe ? `<strong style="color: #34d399;">${window.escapeHTML(n)}</strong>` : window.escapeHTML(n);
            }).join(', ');

            const leadDisplay = isMulti
                ? `${window.escapeHTML(leadName)} <span style="font-size:0.72rem; color:#9ca3af; font-weight:normal;">(a ${namesArr.length - 1} ${namesArr.length - 1 === 1 ? 'další' : (namesArr.length - 1 < 5 ? 'další' : 'dalších')})</span> <span class="strip-arrow" style="color:#fbbf24; font-size:0.65rem;">▼</span>`
                : window.escapeHTML(leadName);

            hrdinaRowHtml = `
                <div class="radar-hero-item-wrapper" style="display: flex; flex-direction: column; width: 100%;">
                    <div class="radar-hero-row ${isMulti ? 'is-expandable' : ''}" ${isMulti ? 'onclick="window.toggleRadarHeroRow(this)"' : ''}>
                        <span class="radar-hero-icon">🦸</span>
                        <div class="radar-hero-info">
                            <span class="radar-hero-title" style="color: #34d399;">HRDINA SEZÓNY</span>
                            <span class="radar-hero-sub">Bodoval v nejvíce zápasech v řadě za sebou</span>
                        </div>
                        <div class="radar-hero-badge">
                            <span class="radar-hero-name" style="color: ${leadIsMe ? '#34d399' : '#ffffff'};">${leadDisplay}</span>
                            <span class="radar-hero-val" style="color: #a7f3d0;">${radar.hrdinaSezony.pocet} záp. (+${radar.hrdinaSezony.body} b.)</span>
                        </div>
                    </div>
                    ${isMulti ? `<div class="radar-hero-drawer" style="display: none;">${otherNamesFormatted}</div>` : ''}
                </div>
            `;
        }

        let smolarRowHtml = '';
        if (maSmolare) {
            const rawNamesStr = radar.smolarSezony.names || radar.smolarSezony.nick || '';
            const namesArr = rawNamesStr.split(', ').map(n => n.trim()).filter(Boolean);

            const myIndex = myNickClean ? namesArr.findIndex(n => n.toLowerCase() === myNickClean) : -1;
            if (myIndex > 0) {
                const [me] = namesArr.splice(myIndex, 1);
                namesArr.unshift(me);
            }

            const isMulti = namesArr.length > 1;
            const leadName = namesArr[0] || '–';
            const leadIsMe = Boolean(myNickClean && leadName.toLowerCase() === myNickClean);

            const otherNamesFormatted = namesArr.slice(1).map(n => {
                const isThisMe = Boolean(myNickClean && n.toLowerCase() === myNickClean);
                return isThisMe ? `<strong style="color: #34d399;">${window.escapeHTML(n)}</strong>` : window.escapeHTML(n);
            }).join(', ');

            const leadDisplay = isMulti
                ? `${window.escapeHTML(leadName)} <span style="font-size:0.72rem; color:#9ca3af; font-weight:normal;">(a ${namesArr.length - 1} ${namesArr.length - 1 === 1 ? 'další' : (namesArr.length - 1 < 5 ? 'další' : 'dalších')})</span> <span class="strip-arrow" style="color:#fbbf24; font-size:0.65rem;">▼</span>`
                : window.escapeHTML(leadName);

            smolarRowHtml = `
                <div class="radar-hero-item-wrapper" style="display: flex; flex-direction: column; width: 100%;">
                    <div class="radar-hero-row ${isMulti ? 'is-expandable' : ''}" ${isMulti ? 'onclick="window.toggleRadarHeroRow(this)"' : ''}>
                        <span class="radar-hero-icon">🩹</span>
                        <div class="radar-hero-info">
                            <span class="radar-hero-title">SMOLAŘ SEZÓNY</span>
                            <span class="radar-hero-sub">Nejčastěji minul přesný výsledek o jediný gól</span>
                        </div>
                        <div class="radar-hero-badge">
                            <span class="radar-hero-name" style="color: ${leadIsMe ? '#34d399' : '#ffffff'};">${leadDisplay}</span>
                            <span class="radar-hero-val">${radar.smolarSezony.pocet}× těsně</span>
                        </div>
                    </div>
                    ${isMulti ? `<div class="radar-hero-drawer" style="display: none;">${otherNamesFormatted}</div>` : ''}
                </div>
            `;
        }

        smolarHtml = `
            <div class="radar-card">
                <div class="radar-card-header" style="color: #fbbf24;">🎭 HRDINOVÉ & SMOLAŘI SEZÓNY</div>
                <div class="radar-card-body" style="gap: 8px;">
                    ${hrdinaRowHtml}
                    ${smolarRowHtml}
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

    // 6. 🏟️ ŠTĚDROST KLUBŮ
    const kluby = radar.stedrostKlubu || [];
    let klubyHtml = '';
    if (kluby.length > 0) {
        const rows = kluby.map((k, idx) => {
            let tierClass = '';
            if (idx < 2) {
                tierClass = 'is-top-tier';
            } else if (idx >= kluby.length - 2) {
                tierClass = 'is-bottom-tier';
            }

            const prumerColor = k.prumerBodu >= 2.5 ? '#34d399' : (k.prumerBodu >= 1.5 ? '#fbbf24' : '#f87171');

            const isHockey = (leagueName || '').includes("hokej") || (leagueName || '').includes("Extraliga");
            const sportKlic = isHockey ? "ice-hockey" : "football";
            const tymSlug = String(k.tym || '').trim().toLowerCase().replace(/ /g, '_');
            const logoUrl = `${CONFIG.R2_BASE_URL}/teams/${sportKlic}/${encodeURIComponent(tymSlug)}.png`;

            return `
                <div class="radar-club-row ${tierClass}">
                    <div class="radar-club-left">
                        <span class="radar-club-rank">${idx + 1}.</span>
                        ${Alpine.store('appState')?.fanGraphics ? `<img src="${logoUrl}" class="radar-club-logo" alt="" onerror="this.style.display='none'">` : ''}
                        <span class="radar-club-name">${window.escapeHTML(k.tym)}</span>
                    </div>
                    <div class="radar-club-right">
                        <span class="radar-club-pts" style="color: ${prumerColor};">${k.prumerBodu} b. <small style="color:#9ca3af; font-size:0.68rem;">/ záp.</small></span>
                        <span class="radar-club-pct">${k.uspesnost} %</span>
                    </div>
                </div>
            `;
        }).join('');

        klubyHtml = `
            <div class="radar-card">
                <div class="radar-card-header" style="color: #34d399;">🏟️ ŠTĚDROST KLUBŮ (KDO SYPAL A KDO PÁLIL BODY)</div>
                <div class="radar-card-body" style="padding: 4px 0 0 0;">
                    <div class="radar-club-table-header">
                        <span># KLUB</span>
                        <div class="radar-club-header-right">
                            <span class="radar-th-pts">PRŮMĚR</span>
                            <span class="radar-th-pct">ÚSPĚŠNOST</span>
                        </div>
                    </div>
                    <div class="radar-club-list">
                        ${rows}
                    </div>
                    <div class="radar-club-legend">
                        <span><span class="legend-box is-top"></span> Nejštědřejší kluby (Bankomat)</span>
                        <span><span class="legend-box is-bottom"></span> Nejméně bodované (Hrobař)</span>
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

// =========================================================================
// 👁️ ŠPEHOVACÍ MODÁLY: PROHLÍŽENÍ TIPŮ HRÁČE & ZÁPASU (SPY MODALS)
// =========================================================================

window.showPlayerTipsModal = async (playerUid, leagueName) => {
    const store = Alpine.store('appState');
    const rozpisData = store?.rozpisData;
    const myUid = window.auth?.currentUser?.uid;
    const isMe = Boolean(myUid && playerUid === myUid);

    if (!rozpisData || !rozpisData.zapasyMapa) return;

    const hracSlozka = store.leaderboardData?.zebricek?.find(p => p.uid === playerUid) || store.leaderboardData?.zebricekLive?.find(p => p.uid === playerUid);
    const nickname = hracSlozka ? hracSlozka.nickname : (isMe ? (store.nickname || 'Já') : 'Hráč');

    let hracovyTipyData;

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

    const kolaMap = {};
    const roundTotalMatchesMap = {};

    serazeneZapasy.forEach(zap => {
        const koloNazev = window.prelozFaziTurnaje(zap.stage, zap.kolo, zap.isPlayoff) || '1. Kolo';
        roundTotalMatchesMap[koloNazev] = (roundTotalMatchesMap[koloNazev] || 0) + 1;

        const isEvaluated = (zap.vysledek_domaci !== undefined && zap.vysledek_hoste !== undefined && zap.apiStatus !== "IN_PLAY" && zap.apiStatus !== "PAUSED");
        const jeBeziciLive = (zap.apiStatus === "IN_PLAY" || zap.apiStatus === "PAUSED");

        if (!isEvaluated && !jeBeziciLive) return;

        if (!kolaMap[koloNazev]) kolaMap[koloNazev] = [];
        kolaMap[koloNazev].push(zap);
    });

    const unikatniKola = Object.keys(kolaMap);
    if (unikatniKola.length === 0) {
        alert("Hráč zatím nemá žádné vyhodnocené tipy k zobrazení.");
        return;
    }

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

        let resStr = isEvaluated 
            ? window.formatujZobrazeneSkore(prubDomaci, prubHoste, zap.postup, state.leagueName, zap.isPlayoff)
            : `<span class="modal-live-indicator"><span class="modal-live-dot"></span>${prubDomaci}:${prubHoste}</span>`;

        let exactClass = '';
        let ptsStr = '-';
        let ptsColor = '#9ca3af';
        let tipColor = '#9ca3af';
        let tipStr = '?:?';

        if (t) {
            tipStr = window.formatujZobrazeneSkore(t.tip_domaci, t.tip_hoste, t.postup, state.leagueName, zap.isPlayoff);
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

    const STANDARD_ZAPASU_LIGY = {
        "Tipsport Extraliga": 7,
        "Chance Liga": 8,
        "Premier League": 10
    };
    const expectedMatches = STANDARD_ZAPASU_LIGY[state.leagueName] || Math.max(totalScheduled, zapasyVKole.length);
    const totalMatches = Math.max(expectedMatches, totalScheduled, zapasyVKole.length);
    const inActionCount = evaluatedCount + liveCount;
    const waitingCount = Math.max(0, totalMatches - inActionCount);

    let statusText = '';
    let statusClass = '';
    let prefixLabel = '';

    const isFullyFinished = (totalMatches > 0 && evaluatedCount >= totalMatches);

    if (isFullyFinished) {
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
        const isWaitingForPostponed = (evaluatedCount > 0 && evaluatedCount < totalMatches);
        statusText = isWaitingForPostponed
            ? `⏳ ČEKÁ NA DOHRÁVKU (${evaluatedCount}/${totalMatches})`
            : `⏳ ROZEHRÁNO (${evaluatedCount}/${totalMatches}${waitingStr})`;
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

    const storeObj = Alpine.store('appState');
    const myNickName = storeObj?.nickname || '';
    const kolaSouhrn = storeObj?.leaderboardData?.kolaSouhrn || {};
    const souhrnKola = kolaSouhrn[currentRoundName] || null;

    let roundBannerHtml = '';
    if (souhrnKola) {
        const isLM = (state.leagueName === 'Liga mistrů');
        const formatNamesList = (namesArray) => {
            const arr = (namesArray || []).map(u => {
                const isMe = Boolean(myNickName && u.trim().toLowerCase() === myNickName.trim().toLowerCase());
                return isMe ? `<strong class="strip-val-me">${window.escapeHTML(u)}</strong>` : window.escapeHTML(u);
            });
            if (arr.length <= 1) return arr[0] || '';
            if (arr.length === 2) return `${arr[0]} & ${arr[1]}`;
            return `${arr.slice(0, -1).join(', ')} & ${arr[arr.length - 1]}`;
        };

        let rowWinnerHtml = '';
        if (!isLM && souhrnKola.hracKola && souhrnKola.hracKola.names) {
            const hk = souhrnKola.hracKola;
            const winnersArr = hk.names.split(', ').map(n => n.trim()).filter(Boolean);
            const isMulti = winnersArr.length > 1;
            const fullNamesHtml = formatNamesList(winnersArr);

            rowWinnerHtml = `
                <div class="strip-item ${isMulti ? 'is-expandable' : ''}" ${isMulti ? 'onclick="window.toggleStripRow(this)"' : ''}>
                    <div class="strip-left">
                        <span class="strip-icon">👑</span>
                        <span class="strip-label">Hráč kola</span>
                    </div>
                    <div class="strip-right">
                        <span class="strip-val">${isMulti ? `${winnersArr.length} hráči (+${hk.points} b.)` : `${fullNamesHtml} (+${hk.points} b.)`}</span>
                        ${isMulti ? '<span class="strip-arrow">▼</span>' : ''}
                    </div>
                </div>
                ${isMulti ? `<div class="strip-sub-drawer" style="display: none;">${fullNamesHtml}</div>` : ''}
            `;
        }

        let rowExactHtml = '';
        if (souhrnKola.nejvicPresnych && souhrnKola.nejvicPresnych.names) {
            const ne = souhrnKola.nejvicPresnych;
            const exactArr = ne.names.split(', ').map(n => n.trim()).filter(Boolean);
            const isMulti = exactArr.length > 1;
            const fullNamesHtml = formatNamesList(exactArr);

            rowExactHtml = `
                <div class="strip-item ${isMulti ? 'is-expandable' : ''}" ${isMulti ? 'onclick="window.toggleStripRow(this)"' : ''}>
                    <div class="strip-left">
                        <span class="strip-icon">🎯</span>
                        <span class="strip-label">Nejvíc přesných</span>
                    </div>
                    <div class="strip-right">
                        <span class="strip-val">${isMulti ? `${exactArr.length} hráči (${ne.count}×)` : `${fullNamesHtml} (${ne.count}×)`}</span>
                        ${isMulti ? '<span class="strip-arrow">▼</span>' : ''}
                    </div>
                </div>
                ${isMulti ? `<div class="strip-sub-drawer" style="display: none;">${fullNamesHtml}</div>` : ''}
            `;
        }

        let rowTopHtml = '';
        if (souhrnKola.topMatch && souhrnKola.topMatch.hasTopMatch && souhrnKola.topMatch.isStarted) {
            const tm = souhrnKola.topMatch;
            const users = tm.exactUsers || [];
            const cnt = tm.exactCount || 0;
            const isMulti = cnt > 1;
            const fullNamesHtml = formatNamesList(users);

            let rightText = '';
            if (cnt === 0) rightText = 'Nikdo netrefil';
            else if (cnt === 1) rightText = fullNamesHtml;
            else rightText = `${cnt} hráči`;

            rowTopHtml = `
                <div class="strip-item ${isMulti ? 'is-expandable' : ''}" ${isMulti ? 'onclick="window.toggleStripRow(this)"' : ''}>
                    <div class="strip-left">
                        <span class="strip-icon">🔥</span>
                        <span class="strip-label">TOP zápas</span>
                    </div>
                    <div class="strip-right">
                        <span class="strip-val ${cnt > 0 ? 'is-orange' : 'is-muted'}">${rightText}</span>
                        ${isMulti ? '<span class="strip-arrow">▼</span>' : ''}
                    </div>
                </div>
                ${isMulti ? `<div class="strip-sub-drawer" style="display: none;">${fullNamesHtml}</div>` : ''}
            `;
        }

        const itemsCombined = [rowWinnerHtml, rowExactHtml, rowTopHtml].filter(Boolean).join('');
        if (itemsCombined) {
            roundBannerHtml = `
                <div class="player-modal-summary-section">
                    <div class="player-modal-section-title">📊 STATISTIKY KOLA</div>
                    <div class="player-modal-card-strip">
                        ${itemsCombined}
                    </div>
                </div>
            `;
        }
    }

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

            <div class="player-modal-sticky-footer">
                <div class="player-modal-footer-status ${statusClass}">
                    <span>${statusText}</span>
                </div>
                <div class="player-modal-footer-pts">
                    <span class="footer-pts-label">${prefixLabel}</span>
                    <span class="footer-pts-value ${ptsValueClass}">${ptsFormatted}</span>
                </div>
            </div>

            ${roundBannerHtml}
        </div>
    `;

    window.openGlobalUiModal(`Tipy hráče: ${state.nickname}`, fullModalHtml);
};

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

window.toggleStripRow = (rowEl) => {
    const drawer = rowEl.nextElementSibling;
    const arrow = rowEl.querySelector('.strip-arrow');
    if (drawer && drawer.classList.contains('strip-sub-drawer')) {
        const isHidden = drawer.style.display === 'none';
        drawer.style.display = isHidden ? 'block' : 'none';
        if (arrow) arrow.innerText = isHidden ? '▲' : '▼';
    }
};

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

    if (vsichniHraciUids.length === 0 && tipyProZapas.length > 0) {
        vsichniHraciUids = tipyProZapas.map(tip => tip.uid || tip.userEmail).filter(Boolean);
    }

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
            tipStr = window.formatujZobrazeneSkore(t.tip_domaci, t.tip_hoste, t.postup, leagueName, matchData.isPlayoff);
        } else {
            nenatipovaloPocet++;
            tipStr = '?:?';
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
    if (matchData.apiStatus === "POSTPONED") {
        scorePillHtml = `<div class="match-spy-score-pill is-postponed">⏳ ODLOŽENO</div>`;
    } else if (isEvaluated) {
        const finalScore = window.formatujZobrazeneSkore(matchData.vysledek_domaci, matchData.vysledek_hoste, matchData.postup, leagueName, matchData.isPlayoff);
        scorePillHtml = `<div class="match-spy-score-pill">${finalScore}</div>`;
    } else if (matchData.apiStatus === "IN_PLAY" || matchData.apiStatus === "PAUSED") {
        let prubD = matchData.vysledek_domaci !== undefined ? matchData.vysledek_domaci : 0;
        let prubH = matchData.vysledek_hoste !== undefined ? matchData.vysledek_hoste : 0;
        scorePillHtml = `<div class="match-spy-score-pill is-live"><span class="match-spy-live-dot"></span>LIVE ${prubD}:${prubH}</div>`;
    }

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

// =========================================================================
// 🏛️ SÍŇ SLÁVY (SERVER-VALIDATED MULTI-LEAGUE KARUSEL + SMART FAB ENGINE)
// =========================================================================
window.posunHofLeague = (smer) => {
    const store = Alpine.store('appState');
    const sezId = store?.activeSeason || window.SEZONA_ID || "2026_2027";
    let hofData = store?.hallOfFameData;
    if (!hofData) {
        try {
            const cached = localStorage.getItem(`tipni_cache_hof_${sezId}`);
            if (cached) hofData = JSON.parse(cached);
        } catch(e) {}
    }
    const availableLeagues = Object.keys(hofData?.byLeague || {});
    const keys = ['ALL', ...availableLeagues];
    const curFilter = window.hofActiveFilter || 'ALL';
    let idx = keys.indexOf(curFilter);
    if (idx === -1) idx = 0;
    let newIdx = idx + smer;
    if (newIdx < 0) newIdx = keys.length - 1;
    if (newIdx >= keys.length) newIdx = 0;
    window.renderHallOfFame(keys[newIdx]);
};

window.scrollToMyHofRank = () => {
    const hofScreen = document.getElementById('hallOfFameScreen');
    const myRow = hofScreen?.querySelector('.hof-player-row.is-current-user');
    if (!hofScreen || !myRow) return;

    const targetTop = myRow.offsetTop - (hofScreen.clientHeight / 2) + (myRow.clientHeight / 2);
    hofScreen.scrollTo({
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

window.renderHallOfFame = (leagueFilter = 'ALL') => {
    const container = document.getElementById('hallOfFameContainer');
    const carouselContainer = document.getElementById('hallOfFameCarousel') || document.getElementById('hallOfFamePills');
    if (!container) return;
    const store = Alpine.store('appState');
    const sezId = store?.activeSeason || window.SEZONA_ID || "2026_2027";
    const currentUid = window.auth?.currentUser?.uid || store?.userUid;
    const currentNick = (store?.nickname || '').trim().toLowerCase();

    window.hofActiveFilter = leagueFilter;

    let hofData = store?.hallOfFameData;
    if (!hofData) {
        try {
            const cached = localStorage.getItem(`tipni_cache_hof_${sezId}`);
            if (cached) hofData = JSON.parse(cached);
        } catch(e) {}
    }

    const availableLeagues = Object.keys(hofData?.byLeague || {});

    if (carouselContainer) {
        const options = [
            { key: 'ALL', label: '🏛️ VŠECHNY LIGY' },
            ...availableLeagues.map(l => ({ key: l, label: l.toUpperCase() }))
        ];

        const curIdx = options.findIndex(o => o.key === leagueFilter);
        const activeOpt = curIdx !== -1 ? options[curIdx] : options[0];

        const optionsHtml = options.map(opt => `
            <div class="custom-dropdown-item ${opt.key === leagueFilter ? 'is-active' : ''}" onclick="window.renderHallOfFame('${opt.key}')">
                ${opt.label}
            </div>
        `).join('');

        carouselContainer.innerHTML = `
            <div class="carousel-container" style="margin: 0 0 12px 0;">
                <button class="nav-btn-leaderboard carousel-btn" onclick="window.posunHofLeague(-1)">◀</button>
                <div class="custom-dropdown-wrapper">
                    <div class="custom-dropdown-trigger" onclick="const m = this.nextElementSibling; const isVis = m.style.display === 'flex'; m.style.display = isVis ? 'none' : 'flex';">
                        <span>${activeOpt.label}</span>
                        <span class="custom-dropdown-arrow">▼</span>
                    </div>
                    <div class="custom-dropdown-menu" style="display: none;">
                        ${optionsHtml}
                    </div>
                </div>
                <button class="nav-btn-leaderboard carousel-btn" onclick="window.posunHofLeague(1)">▶</button>
            </div>
        `;
    }

    let playersList = [];
    const isAll = (leagueFilter === 'ALL');

    if (isAll) {
        playersList = hofData?.all || hofData?.players || [];
    } else {
        playersList = hofData?.byLeague?.[leagueFilter] || [];
    }

    if (playersList.length === 0) {
        container.innerHTML = `
            <div class="db-empty-msg" style="padding: 40px 15px; text-align: center; color: #9ca3af; line-height: 1.5;">
                🏛️ <strong>V této kategorii zatím nejsou žádní aktivní hráči!</strong><br>
                Žebříček se naplní po odehrání zápasů v této soutěži.
            </div>
        `;
        return;
    }

    let rowsHtml = '';
    let currentRank = 1;
    let myDisplayRank = null;

    playersList.forEach((p, idx) => {
        const ratingVal = isAll ? p.masterOvr : p.ovr;
        const prevRatingVal = idx > 0 ? (isAll ? playersList[idx - 1].masterOvr : playersList[idx - 1].ovr) : null;

        if (idx > 0 && ratingVal < prevRatingVal) {
            currentRank = idx + 1;
        }

        const medal = currentRank === 1 ? '🥇' : (currentRank === 2 ? '🥈' : (currentRank === 3 ? '🥉' : `${currentRank}.`));
        const isMe = Boolean(
            (currentUid && p.uid === currentUid) ||
            (currentNick && p.nickname && p.nickname.trim().toLowerCase() === currentNick)
        );

        if (isMe) {
            myDisplayRank = currentRank;
        }

        const metaSub = isAll ? `${p.archetypeName} • ${p.bestLeague}` : `${p.archetypeName} • ${p.points} b.`;

        rowsHtml += `
            <div class="hof-player-row ${isMe ? 'is-current-user' : ''}" onclick="window.openPlayerProfile('${p.uid}', '${isAll ? 'ALL' : leagueFilter}')">
                <div class="hof-player-left">
                    <span class="hof-player-rank">${medal}</span>
                    <div class="hof-player-info">
                        <span class="hof-player-nick">${window.escapeHTML(p.nickname)}</span>
                        <div class="hof-player-meta">
                            <span class="hof-archetype-tag">${p.archetype}</span>
                            <span>${metaSub}</span>
                        </div>
                    </div>
                </div>
                <div class="hof-player-right">
                    <span class="hof-ovr-pill tier-${p.tier}">${ratingVal}</span>
                    <span style="color: #6b7280; font-size: 0.8rem;">➔</span>
                </div>
            </div>
        `;
    });

    container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 8px; width: 100%; box-sizing: border-box;">
            ${rowsHtml}
        </div>
        <button id="myHofRankFab" class="my-rank-fab" style="display: none;" onclick="window.scrollToMyHofRank()"></button>
    `;

    const myRow = container.querySelector('.hof-player-row.is-current-user');
    const myFab = document.getElementById('myHofRankFab');

    if (window.myHofRankObserver) {
        window.myHofRankObserver.disconnect();
        window.myHofRankObserver = null;
    }

    if (myRow && myFab) {
        const myRankObj = playersList.find(p => 
            (currentUid && p.uid === currentUid) ||
            (currentNick && p.nickname && p.nickname.trim().toLowerCase() === currentNick)
        );
        if (myRankObj && myDisplayRank !== null) {
            const val = isAll ? myRankObj.masterOvr : myRankObj.ovr;
            myFab.innerHTML = `🎯 MOJE POZICE • ${myDisplayRank}. (${val} OVR)`;
        }

        const scrollRoot = document.getElementById('hallOfFameScreen');
        window.myHofRankObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                myFab.style.display = entry.isIntersecting ? 'none' : 'inline-flex';
            });
        }, { root: scrollRoot, threshold: 0.1 });

        window.myHofRankObserver.observe(myRow);
    } else if (myFab) {
        myFab.style.display = 'none';
    }
};