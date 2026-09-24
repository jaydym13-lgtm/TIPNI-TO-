// =========================================================================
// 📜 TIPNI TO! - CENTRÁLNÍ BODOVACÍ PRAVIDLA PRO BACKEND (rules.js)
// =========================================================================

const PRAVIDLA_LIG = {
    "MS ve fotbale": {
        presnyVysledek: 6,
        chytraTendence: 3,
        zakladniTendence: 2,
        golUtechy: 1,
        playoffBonus: 1,
        penaltyNenatipovano: -1,
        bonusVitez: 8,
        bonusStrelec: 8,
        hasTopMatch: false,
        topMatchMultiplier: 1,
        roundBonus: 0
    },
    "Chance Liga": {
        presnyVysledek: 5,
        chytraTendence: 0,
        zakladniTendence: 2,
        golUtechy: 0,
        playoffBonus: 0,
        penaltyNenatipovano: -1,
        bonusVitez: 0,
        bonusStrelec: 10,
        hasTopMatch: true,
        topMatchMultiplier: 2,
        roundBonus: 5
    },
    "Premier League": {
        presnyVysledek: 6,
        chytraTendence: 3,
        zakladniTendence: 2,
        golUtechy: 1,
        playoffBonus: 0,
        penaltyNenatipovano: -1,
        bonusVitez: 10,
        bonusStrelec: 10,
        hasTopMatch: true,
        topMatchMultiplier: 2,
        roundBonus: 0
    },
    "Liga mistrů": {
        presnyVysledek: 6,
        chytraTendence: 3,
        zakladniTendence: 2,
        golUtechy: 1,
        playoffBonus: 0,
        penaltyNenatipovano: -1,
        bonusVitez: 0,
        bonusStrelec: 0,
        hasTopMatch: false,
        topMatchMultiplier: 1,
        roundBonus: 0
    },
    "MS v hokeji": {
        presnyVysledek: 3,
        chytraTendence: 0,
        zakladniTendence: 1,
        golUtechy: 0,
        playoffBonus: 0,
        penaltyNenatipovano: 0,
        bonusVitez: 10,
        bonusStrelec: 10,
        hasTopMatch: false,
        topMatchMultiplier: 1,
        roundBonus: 0
    },
    "Tipsport Extraliga": {
        presnyVysledek: 5,
        chytraTendence: 3,
        presnaRemiza: 6,
        zakladniTendence: 2,
        golUtechy: 0,
        playoffBonus: 1,
        penaltyNenatipovano: -1,
        bonusVitez: 10,
        bonusStrelec: 8,
        bonusKanadskeBodovani: 8,
        hasTopMatch: true,
        topMatchMultiplier: 2,
        roundBonus: 5
    },
    "DEFAULT": {
        presnyVysledek: 3,
        chytraTendence: 0,
        zakladniTendence: 1,
        golUtechy: 0,
        playoffBonus: 0,
        penaltyNenatipovano: 0,
        bonusVitez: 10,
        bonusStrelec: 10,
        hasTopMatch: false,
        topMatchMultiplier: 1,
        roundBonus: 0
    }
};

module.exports = {
    PRAVIDLA_LIG
};