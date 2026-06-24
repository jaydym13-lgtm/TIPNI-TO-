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

    // ⚽ MATEMATICKÝ APARÁT PRO MS VE FOTBALE (Balíček 2 - Striktní fix na 90 minut + Play-off bonus)
    if (aktivniLiga === "MS ve fotbale") {
        // A. Uhodnutý přesný výsledek utkání po 90. minutě = 6 bodů
        if (tDom === rDom && tHos === rHos) {
            let body = 6;
            if (isPlayoff && rDom === rHos && realPostup && tipPostup && tipPostup === realPostup) {
                body += 1; // +1b za trefeného postupujícího v prodloužení/penaltách
            }
            return body;
        }

        // B. Uhodnutá remíza po 90. minutě (když tipneš remízu a skončí to jinou remízou) = 3 body
        if (rDom === rHos && tDom === tHos) {
            let body = 3;
            if (isPlayoff && realPostup && tipPostup && tipPostup === realPostup) {
                body += 1; // +1b za trefeného postupujícího v prodloužení/penaltách
            }
            return body;
        }

        // Výpočet tendencí pro standardní výhry / prohry po 90. minutě
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
    
    // 🏒 STANDARDNÍ MATEMATIKA PRO OSTATNÍ SOUTĚŽE (Hokej, Extraliga)
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

    if (liga === "MS ve fotbale") {
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