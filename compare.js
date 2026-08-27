// =========================================================================
// 🧮 TIPNI TO! - MATEMATIKA A POČÍTÁNÍ BODŮ (compare.js)
// =========================================================================
import { PRAVIDLA_LIG, vypocitejBodyZapasu } from './rules.js';

if (typeof window !== 'undefined') {
    window.vypocitejBodyZapasu = vypocitejBodyZapasu;
}

// 🏆 KOLO BONUS: +5 Bodů za 100% trefené tendence všech zápasů v jednom kole
window.vypocitejBonusKola = (mapaTipuKola, mapaZapasuKola, liga) => {
    const aktivniLiga = liga || window.Alpine?.store('appState')?.selectedLeague || '';
    const pravidla = (window.PRAVIDLA_LIG || PRAVIDLA_LIG)?.[aktivniLiga] || (window.PRAVIDLA_LIG || PRAVIDLA_LIG)?.["DEFAULT"];

    if (!pravidla.roundBonus || pravidla.roundBonus <= 0) return 0;

    const zapasyList = Object.values(mapaZapasuKola || {});
    if (zapasyList.length === 0) return 0;

    for (const zapas of zapasyList) {
        if (zapas.vysledek_domaci === undefined || zapas.vysledek_hoste === undefined || zapas.vysledek_domaci === null || zapas.vysledek_hoste === null) {
            return 0;
        }

        const matchId = zapas.id || zapas.matchId;
        const tip = mapaTipuKola ? mapaTipuKola[matchId] : null;
        if (!tip) return 0;

        const rDom = parseInt(zapas.vysledek_domaci);
        const rHos = parseInt(zapas.vysledek_hoste);
        const tDom = parseInt(tip.tip_domaci);
        const tHos = parseInt(tip.tip_hoste);

        if (isNaN(tDom) || isNaN(tHos) || isNaN(rDom) || isNaN(rHos)) return 0;

        const tipRozdil = tDom - tHos;
        const realRozdil = rDom - rHos;

        const spravnaTendence = (tipRozdil > 0 && realRozdil > 0) || 
                                (tipRozdil < 0 && realRozdil < 0) || 
                                (tipRozdil === 0 && realRozdil === 0);

        if (!spravnaTendence) return 0;
    }

    return pravidla.roundBonus;
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