// =========================================================================
// 🧮 TIPNI TO! - MATEMATIKA A POČÍTÁNÍ BODŮ (compare.js)
// =========================================================================

window.vypocitejBodyZapasu = (tipDomaci, tipHoste, realDomaci, realHoste, liga, tipPostup, realPostup, isPlayoff) => {
    if (realDomaci === undefined || realDomaci === null || realHoste === undefined || realHoste === null) {
        return 0;
    }

    // 🔧 STRIKTNÍ BEZPEČNOSTNÍ KONTROLA: Přetypujeme text na čistá čísla
    const tDom = parseInt(tipDomaci);
    const tHos = parseInt(tipHoste);
    const rDom = parseInt(realDomaci);
    const rHos = parseInt(realHoste);

    // 🧭 INTELIGENTNÍ FALLBACK: Pokud liga chybí, vytáhneme ji z Alpine store sami
    const aktivniLiga = liga || Alpine.store('appState')?.selectedLeague || '';

    // ⚽ MATEMATICKÝ APARÁT PRO MS VE FOTBALE 2026
    if (aktivniLiga === "MS ve fotbale" || aktivniLiga === "MS ve fotbale 2026") {
        // A. Uhodnutý přesný výsledek utkání = 6 bodů
        if (tDom === rDom && tHos === rHos) {
            let body = 6;
            if (isPlayoff && rDom === rHos && realPostup && tipPostup && tipPostup === realPostup) {
                body += 1; // +1b za trefeného postupujícího v prodloužení/penaltách
            }
            return body;
        }

        // B. Remíza (když tipneš remízu a skončí to jinou remízou) = 3 body
        if (rDom === rHos && tDom === tHos) {
            let body = 3;
            if (isPlayoff && realPostup && tipPostup && tipPostup === realPostup) {
                body += 1;
            }
            return body;
        }

        // Výpočet tendencí pro standardní výhry / prohry
        const tipRozdil = tDom - tHos;
        const realRozdil = rDom - rHos;
        const spravnaTendence = (tipRozdil > 0 && realRozdil > 0) || (tipRozdil < 0 && realRozdil < 0);

        if (spravnaTendence) {
            // C. Správná tendence + přesný gól jednoho z týmů NEBO přesný rozdíl branek = 3 body
            const trefilGolyJednoho = (tDom === rDom || tHos === rHos);
            const trefilRozdil = (tipRozdil === realRozdil);

            if (trefilGolyJednoho || trefilRozdil) {
                return 3;
            }
            // D. Uhodnutý pouze základní výsledek zápasu (čistý vítěz) = 2 body
            return 2;
        }

        // E. Úplně vedle výsledek, ale uhodnutý přesný počet vstřelených branek jednoho z týmů = 1 bod
        if (tDom === rDom || tHos === rHos) {
            return 1;
        }

        return 0;
    } 
    
    // 🏒 STANDARDNÍ MATEMATIKA PRO OSTATNÍ SOUTÊŽE (Hokej, Extraliga)
    else {
        if (tDom === rDom && tHos === rHos) {
            return 3;
        }
        const tipRozdil = tDom - tHos;
        const realRozdil = rDom - rHos;
        if ((tipRozdil > 0 && realRozdil > 0) || (tipRozdil < 0 && realRozdil < 0) || (tipRozdil === 0 && realRozdil === 0)) {
            return 1;
        }
        return 0;
    }
};

window.vypocitejBonusy = (tipVitez, tipStrelec, realVitez, realStrelec, liga) => {
    let bonusoveBody = 0;
    let hodnotaBonus = 10; // Výchozí hodnota pro hokej / extraligu

    if (liga === "MS ve fotbale" || liga === "MS ve fotbale 2026") {
        hodnotaBonus = 8; // Specifická hodnota pro fotbal podle tvého zadání
    }

    if (realVitez && tipVitez && tipVitez.trim().toLowerCase() === realVitez.trim().toLowerCase()) {
        bonusoveBody += hodnotaBonus;
    }
    if (realStrelec && tipStrelec && tipStrelec.trim().toLowerCase() === realStrelec.trim().toLowerCase()) {
        bonusoveBody += hodnotaBonus;
    }

    return bonusoveBody;
};