// =========================================================================
// 🧮 TIPNI TO! - MATEMATIKA A POČÍTÁNÍ BODŮ (compare.js)
// =========================================================================
import { PRAVIDLA_LIG } from './rules.js';

window.vypocitejBodyZapasu = (tipDomaci, tipHoste, realDomaci, realHoste, liga, tipPostup, realPostup, isPlayoff, isTopMatch = false) => {
    if (realDomaci === undefined || realDomaci === null || realHoste === undefined || realHoste === null) {
        return 0;
    }

    const tDom = parseInt(tipDomaci);
    const tHos = parseInt(tipHoste);
    const rDom = parseInt(realDomaci);
    const rHos = parseInt(realHoste);

    if (isNaN(tDom) || isNaN(tHos) || isNaN(rDom) || isNaN(rHos)) {
        return 0;
    }

    const aktivniLiga = liga || window.Alpine?.store('appState')?.selectedLeague || '';
    const pravidla = (window.PRAVIDLA_LIG || PRAVIDLA_LIG)?.[aktivniLiga] || (window.PRAVIDLA_LIG || PRAVIDLA_LIG)?.["DEFAULT"];

    let ziskaneBody = 0;

    // A. Přesný výsledek
    if (tDom === rDom && tHos === rHos) {
        ziskaneBody = pravidla.presnyVysledek;
        if (isPlayoff && rDom === rHos && realPostup && tipPostup && tipPostup === realPostup) {
            ziskaneBody += pravidla.playoffBonus;
        }
    } 
    // B. Uhodnutá remíza (jiné skóre remízy)
    else if (rDom === rHos && tDom === tHos) {
        ziskaneBody = pravidla.chytraTendence > 0 ? pravidla.chytraTendence : pravidla.zakladniTendence;
        if (isPlayoff && realPostup && tipPostup && tipPostup === realPostup) {
            ziskaneBody += pravidla.playoffBonus;
        }
    } 
    // C. Tendence výhry / prohry
    else {
        const tipRozdil = tDom - tHos;
        const realRozdil = rDom - rHos;
        const spravnaTendence = (tipRozdil > 0 && realRozdil > 0) || (tipRozdil < 0 && realRozdil < 0);

        if (spravnaTendence) {
            const trefilGoly = (tDom === rDom || tHos === rHos);
            const trefilRozdil = (tipRozdil === realRozdil);

            if ((trefilGoly || trefilRozdil) && pravidla.chytraTendence > 0) {
                ziskaneBody = pravidla.chytraTendence;
            } else {
                ziskaneBody = pravidla.zakladniTendence;
            }
        } else if (pravidla.golUtechy > 0 && (tDom === rDom || tHos === rHos)) {
            ziskaneBody = pravidla.golUtechy;
        }
    }

    // 💥 APLIKACE NÁSOBIČE PRO TOP ZÁPAS (Násobíme výhradně kladné body!)
    if (isTopMatch && pravidla.hasTopMatch && ziskaneBody > 0) {
        ziskaneBody *= (pravidla.topMatchMultiplier || 1);
    }

    return ziskaneBody;
};

// 🏆 KOLO BONUS: +5 Bodu za 100% trefené tendence všech zápasů v jednom kole
window.vypocitejBonusKola = (mapaTipuKola, mapaZapasuKola, liga) => {
    const aktivniLiga = liga || window.Alpine?.store('appState')?.selectedLeague || '';
    const pravidla = (window.PRAVIDLA_LIG || PRAVIDLA_LIG)?.[aktivniLiga] || (window.PRAVIDLA_LIG || PRAVIDLA_LIG)?.["DEFAULT"];

    if (!pravidla.roundBonus || pravidla.roundBonus <= 0) return 0;

    const zapasyList = Object.values(mapaZapasuKola || {});
    if (zapasyList.length === 0) return 0;

    for (const zapas of zapasyList) {
        // Pokud alespoň jeden zápas kola ještě neskončil, bonus zatím nelze udělit
        if (zapas.vysledek_domaci === undefined || zapas.vysledek_hoste === undefined || zapas.vysledek_domaci === null || zapas.vysledek_hoste === null) {
            return 0;
        }

        const matchId = zapas.id || zapas.matchId;
        const tip = mapaTipuKola ? mapaTipuKola[matchId] : null;
        if (!tip) return 0; // Hráč nenatipoval některý zápas v kole -> bonus ztrácí

        const rDom = parseInt(zapas.vysledek_domaci);
        const rHos = parseInt(zapas.vysledek_hoste);
        const tDom = parseInt(tip.tip_domaci);
        const tHos = parseInt(tip.tip_hoste);

        if (isNaN(tDom) || isNaN(tHos) || isNaN(rDom) || isNaN(rHos)) return 0;

        const tipRozdil = tDom - tHos;
        const realRozdil = rDom - rHos;

        // Trefená základní tendence (1, X, 2)
        const spravnaTendence = (tipRozdil > 0 && realRozdil > 0) || 
                                (tipRozdil < 0 && realRozdil < 0) || 
                                (tipRozdil === 0 && realRozdil === 0);

        if (!spravnaTendence) return 0; // Vedle u jakéhokoliv zápasu = 0 bonusových bodů za kolo
    }

    return pravidla.roundBonus; // 🎯 100% ÚSPĚŠNOST KOLA = +5 BODŮ!
};

window.vypocitejBonusy = (tipVitez, tipStrelec, realVitez, realStrelec, liga) => {
    let bonusoveBody = 0;
    const aktivniLiga = liga || window.Alpine?.store('appState')?.selectedLeague || '';
    const pravidla = (window.PRAVIDLA_LIG || PRAVIDLA_LIG)?.[aktivniLiga] || (window.PRAVIDLA_LIG || PRAVIDLA_LIG)?.["DEFAULT"];

    if (pravidla.bonusVitez > 0 && realVitez && tipVitez && tipVitez.trim().toLowerCase() === realVitez.trim().toLowerCase()) {
        bonusoveBody += pravidla.bonusVitez;
    }
    if (pravidla.bonusStrelec > 0 && realStrelec && tipStrelec && tipStrelec.trim().toLowerCase() === realStrelec.trim().toLowerCase()) {
        bonusoveBody += pravidla.bonusStrelec;
    }

    return bonusoveBody;
};