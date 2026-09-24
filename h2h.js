// =========================================================================
// ⚔️ TIPNI TO! - H2H DUEL ARENA ENGINE (h2h.js)
// =========================================================================

import { CONFIG } from "./config.js";
import { PRAVIDLA_LIG } from "./rules.js";

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
            title: `${z.domaci} vs.${z.hoste}`,
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
        kanadske: { ja: mojeStats.nejKanadske || mojeStats.kanadske || '–', on: souperStats.nejKanadske || souperStats.kanadske || '–' },
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
                    <span class="h2h-spy-op-tip">${data.souperNickname}:${item.souperTipStr}</span>
                </div>
            </div>
        `).join('');
    };

    const showKanadske = (pravidla?.bonusKanadskeBodovani || 0) > 0;

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

    const kanadskeRowHtml = showKanadske ? `
        <div class="h2h-grid-row">
            <span class="h2h-cell-val" style="font-size:0.8rem; color:#fff;">${data.kanadske.ja}</span>
            <span class="h2h-cell-metric">🍁 Kanadské bodování</span>
            <span class="h2h-cell-val" style="font-size:0.8rem; color:#fff;">${data.kanadske.on}</span>
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
                    <span class="h2h-cell-val ${cEfekt.ja}">${data.efektivita.ja} \%${cEfekt.crownJa}</span>
                    <span class="h2h-cell-metric">📊 Úspěšnost</span>
                    <span class="h2h-cell-val ${cEfekt.on}">${data.efektivita.on} \%${cEfekt.crownOn}</span>
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
                    <span class="h2h-cell-metric">🌟 Hráč kola</span>
                    <span class="h2h-cell-val ${cHracK.on}">${data.hracKola.on}×${cHracK.crownOn}</span>
                </div>
                <div class="h2h-grid-row">
                    <span class="h2h-cell-val ${cMaxK.ja}">${data.maxBoduVKole.ja} b.${cMaxK.crownJa}</span>
                    <span class="h2h-cell-metric">⚡ Max bodů v kole</span>
                    <span class="h2h-cell-val ${cMaxK.on}">${data.maxBoduVKole.on} b.${cMaxK.crownOn}</span>
                </div>
                <div class="h2h-grid-row">
                    <span class="h2h-cell-val ${cPerfK.ja}">${data.perfektniKola.ja}×${cPerfK.crownJa}</span>
                    <span class="h2h-cell-metric">💎 Perfektní kola</span>
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
                ${strelecRowHtml}${kanadskeRowHtml}

                <!-- FUN & STYL TIPOVÁNÍ -->
                <div class="h2h-grid-row">
                    <span class="h2h-cell-val" style="color:#38bdf8; font-size: ${data.isLeagueStarted ? '0.9rem' : '0.75rem'};">${data.isLeagueStarted ? (cGoly.ja > cGoly.on ? data.prumerGolu.ja + ' 🔥' : data.prumerGolu.ja) : '🔒 SKRYTO DO STARTU'}</span>
                    <span class="h2h-cell-metric">⚽ Průměr gólů / tip</span>
                    <span class="h2h-cell-val" style="color:#38bdf8; font-size: ${data.isLeagueStarted ? '0.9rem' : '0.75rem'};">${data.isLeagueStarted ? (cGoly.on > cGoly.ja ? data.prumerGolu.on + ' 🔥' : data.prumerGolu.on) : '🔒 SKRYTO DO STARTU'}</span>
                </div>

            </div>
        </div>
    `;

    window.openGlobalUiModal(`⚔️ H2H DUEL: ${data.mojeNickname} vs.${data.souperNickname}`, fullModalHtml);
};