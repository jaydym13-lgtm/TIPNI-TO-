// =========================================================================
// 🤖 TIPNI TO! - AUTONOMNÍ BACKGROUND API & LEADERBOARD BOT (bot.mjs)
// =========================================================================
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// 1. INICIALIZACE FIREBASE POMOCÍ ČISTÝCH ES IMPORTŮ PRO NODE 24
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({
    credential: cert(serviceAccount)
});
const db = getFirestore();

// Globální konfigurace bota z GitHub prostředí
const LEAGUE_ID = process.env.LEAGUE_ID || "WC";
const LEAGUE_NAME = process.env.LEAGUE_NAME || "MS ve fotbale";
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;

// Slovník pro překlad týmů z API do tvé appky
const slovnikTymu = {
    "Czech Republic": "Česko", "Czechia": "Česko", "Mexico": "Mexiko",
    "South Korea": "Jižní Korea", "Korea Republic": "Jižní Korea", "South Africa": "JAR",
    "Bosnia and Herzegovina": "Bosna", "Bosnia": "Bosna", "Bosnia-Herzegovina": "Bosna",
    "Canada": "Kanada", "Qatar": "Katar", "Switzerland": "Švýcarsko",
    "Brazil": "Brazílie", "Haiti": "Haiti", "Morocco": "Maroko", "Scotland": "Skotsko",
    "Australia": "Austrálie", "Paraguay": "Paraguay", "Turkey": "Turecko", "Türkiye": "Turecko",
    "USA": "USA", "United States": "USA", "Curaçao": "Curaçao", "Curacao": "Curaçao",
    "Ecuador": "Ekvádor", "Germany": "Německo", "Ivory Coast": "Pob. slonoviny", "Côte d'Ivoire": "Pob. slonoviny",
    "Japan": "Japonsko", "Netherlands": "Nizozemsko", "Sweden": "Švédsko", "Tunisia": "Tunisko",
    "Belgium": "Belgie", "Egypt": "Egypt", "Iran": "Írán", "New Zealand": "Nový Zéland",
    "Cape Verde": "Kapverdy", "Cabo Verde": "Kapverdy", "Cape Verde Islands": "Kapverdy",
    "Saudi Arabia": "Saúdská Arábie", "Spain": "Španělsko", "Uruguay": "Uruguay",
    "France": "Francie", "Iraq": "Irák", "Norway": "Norsko", "Senegal": "Senegal",
    "Algeria": "Alžírsko", "Argentina": "Argentina", "Austria": "Rakousko", "Jordan": "Jordánsko",
    "Portugal": "Portugalsko", "Uzbekistan": "Uzbekistán", "Colombia": "Kolumbie",
    "DR Congo": "Kongo", "Congo DR": "Kongo", "Croatia": "Chorvatsko", "England": "Anglie",
    "Ghana": "Ghana", "Panama": "Panama"
};

// Pomocná funkce pro výpočet bodů (přepsaná tvoje logika z compare.js)
const vypocitejBodyZapasu = (tipDomaci, tipHoste, realDomaci, realHoste, tipPostup, realPostup, isPlayoff) => {
    const tDom = parseInt(tipDomaci); const tHos = parseInt(tipHoste);
    const rDom = parseInt(realDomaci); const rHos = parseInt(realHoste);

    if (tDom === rDom && tHos === rHos) {
        let body = 6;
        if (isPlayoff && rDom === rHos && realPostup && tipPostup && tipPostup === realPostup) body += 1;
        return body;
    }
    if (rDom === rHos && tDom === tHos) {
        let body = 3;
        if (isPlayoff && realPostup && tipPostup && tipPostup === realPostup) body += 1;
        return body;
    }
    const tipRozdil = tDom - tHos; const realRozdil = rDom - rHos;
    const spravnaTendence = (tipRozdil > 0 && realRozdil > 0) || (tipRozdil < 0 && realRozdil < 0);
    if (spravnaTendence) {
        if ((tDom === rDom || tHos === rHos) || (tipRozdil === realRozdil)) return 3;
        return 2;
    }
    if (tDom === rDom || tHos === rHos) return 1;
    return 0;
};

// HLAVNÍ EXECUTION FUNKCE BOTA
async function runBot() {
    console.log(`📡 Bot startuje kontrolu API pro ligu: ${LEAGUE_NAME}...`);
    if (!API_KEY) throw new Error("Chybí API Klíč!");

    try {
        const response = await fetch(`https://api.football-data.org/v4/competitions/${LEAGUE_ID}/matches`, {
            method: "GET",
            headers: { "X-Auth-Token": API_KEY }
        });
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        
        const data = await response.json();
        const matches = data.matches || [];
        
        let detekovanNovyKonecZapasu = false;

        for (const match of matches) {
            const apiId = match.id;
            
            // CHYTRÁ ÚPRAVA: Reagujeme jak na konečné výsledky, tak na zápasy, které se právě hrají naživo
            const jeZapasAktivni = match.status === "FINISHED" || match.status === "IN_PLAY";
            const maNacteneGoly = match.score?.fullTime?.home !== null && match.score?.fullTime?.away !== null;

            if (jeZapasAktivni && maNacteneGoly) {
                const golyDomaci = parseInt(match.score.fullTime.home);
                const golyHoste = parseInt(match.score.fullTime.away);

                // 🚀 OPTIMALIZACE BOTA: Bot už nebombarduje indexy, ale letí přímo pro konkrétní ID dokumentu
                const docSnap = await db.collection('ligy').doc(LEAGUE_NAME).collection('zapasy').doc(String(apiId)).get();

                if (docSnap.exists) {
                    const fbData = docSnap.data();

                    // 🔒 JEDNOSMĚRNÝ ZÁMEK: Pokud zápas v DB už jednou skončil (FINISHED), nenecháme ho přepsat zpět na LIVE (IN_PLAY)
                    if (fbData.apiStatus === "FINISHED" && match.status === "IN_PLAY") {
                        continue;
                    }

                    // Zkontrolujeme, jestli se skóre na hřišti od minulé kontroly posunulo
                    if (fbData.vysledek_domaci !== golyDomaci || fbData.vysledek_hoste !== golyHoste || fbData.apiStatus !== match.status) {
                        let postupVal = "";
                        if (fbData.isPlayoff && golyDomaci === golyHoste) {
                            if (match.score.winner === "HOME_TEAM") postupVal = "domaci";
                            if (match.score.winner === "AWAY_TEAM") postupVal = "hoste";
                        }

                        // Aktualizaci zacílíme přímo na ID dokumentu z API
                        await db.collection('ligy').doc(LEAGUE_NAME).collection('zapasy').doc(String(apiId)).update({
                            vysledek_domaci: golyDomaci,
                            vysledek_hoste: golyHoste,
                            postup: postupVal,
                            apiStatus: match.status // Tady si uložíme buď "IN_PLAY" nebo "FINISHED"
                        });
                        
                        const emojiStavu = match.status === "IN_PLAY" ? "🔴 LIVE GÓL" : "🎯 FINÁLNÍ VÝSLEDEK";
                        console.log(`${emojiStavu}: ${fbData.domaci} ${golyDomaci}:${golyHoste} ${fbData.hoste}`);
                        
                        detekovanNovyKonecZapasu = true;
                    }
                } // 🔒 Končí podmínka if (docSnap.exists)
            }
        }

        const zapasyKInkrementalnimuUpdatu = [];

        for (const match of matches) {
            if (match.status === "FINISHED") {
                zapasyKInkrementalnimuUpdatu.push(String(match.id));
            }
        }

        if (detekovanNovyKonecZapasu && zapasyKInkrementalnimuUpdatu.length > 0) {
            console.log(`🧠 Detekovány nově dohrané zápasy. Spouštím úsporné přírůstkové přičítání bodů...`);
            for (const mId of zapasyKInkrementalnimuUpdatu) {
                await aktualizujZapasInkrementalne(mId);
            }
        } else {
            console.log("😴 Žádný nový finální výsledek k zápisu bodů nebyl detekován.");
        }

    } catch (e) {
        console.error("❌ Kritická chyba bota:", e);
        process.exit(1);
    }
}

// 🤖 AUTONOMNÍ BACKENDOVÝ PŘÍRŮSTKOVÝ MANAŽER BODŮ (ČISTÝ ENGINE)
async function aktualizujZapasInkrementalne(matchId) {
    try {
        console.log(`🚀 Startuji backendový inkrementální update pro zápas ${matchId}...`);
        const { FieldValue } = await import('firebase-admin/firestore');

        const zapasDoc = await db.collection('ligy').doc(LEAGUE_NAME).collection('zapasy').doc(matchId).get();
        if (!zapasDoc.exists) return;
        const zapas = zapasDoc.data();

        const jeVyhodnoceny = (zapas.vysledek_domaci !== undefined && zapas.vysledek_hoste !== undefined && zapas.apiStatus === "FINISHED");
        if (!jeVyhodnoceny) return;

        const zebricekRef = db.collection('ligy').doc(LEAGUE_NAME).collection('stav').doc('zebricek');
        let zebricekDoc = await zebricekRef.get();
        let zebricekData = zebricekDoc.exists ? zebricekDoc.data() : null;

        // 🧼 AUTO-INICIALIZACE: Pokud je žebříček v prázdné DB čistý, sestavíme kostru z kluků
        if (!zebricekData) {
            console.log("🧼 Žebříček neexistuje. Provádím čistou inicializaci z registrovaných uživatelů...");
            const usersSnapshot = await db.collection('users').get();
            zebricekData = {
                hracStats: {}, mapaTipu: {}, lZapasy: {}, realLeagueData: null, mapaPrezdivek: {},
                textKraliPresnosti: '–', textRekordmaniKola: '–'
            };
            usersSnapshot.forEach(uDoc => {
                const email = uDoc.id.trim().toLowerCase();
                zebricekData.mapaPrezdivek[email] = uDoc.data().nickname || uDoc.id;
                zebricekData.hracStats[email] = {
                    celkemBodu: 0, natipovaneVyhodnocene: 0, nenatipovaneVyhodnocene: 0, presneVysledkyCount: 0,
                    bodyPoKolech: {}, nejStrelec: '–', vitezMs: '–', nejviceBoduVKole: 0
                };
            });
            await zebricekRef.set(zebricekData);
        }
        
        const hracStats = zebricekData.hracStats || {};
        const mapaPrezdivek = zebricekData.mapaPrezdivek || {};
        const vsichniHraciEmaily = Object.keys(hracStats);
        if (vsichniHraciEmaily.length === 0) return;

        const tipsSnapshot = await db.collection('ligy').doc(LEAGUE_NAME).collection('tipy').where('matchId', '==', matchId).get();
        const mapaTipuZapasu = {};
        tipsSnapshot.forEach(doc => {
            const t = doc.data();
            if (t.userEmail) mapaTipuZapasu[t.userEmail.trim().toLowerCase()] = t;
        });

        const jeFotbaloveMS = (LEAGUE_NAME === "MS ve fotbale" || LEAGUE_NAME === "MS ve fotbale 2026");
        const updateBalik = {};
        const docasneStatsProRekordy = JSON.parse(JSON.stringify(hracStats));

        vsichniHraciEmaily.forEach(email => {
            const uživatelůvTip = mapaTipuZapasu[email];
            let bodyZapasu = 0;
            let jePresny = false;

            if (uživatelůvTip) {
                bodyZapasu = vypocitejBodyZapasu(
                    uživatelůvTip.tip_domaci, uživatelůvTip.tip_hoste,
                    zapas.vysledek_domaci, zapas.vysledek_hoste,
                    uživatelůvTip.postup, zapas.postup, zapas.isPlayoff
                );
                
                updateBalik[`hracStats.${email}.celkemBodu`] = FieldValue.increment(bodyZapasu);
                updateBalik[`hracStats.${email}.natipovaneVyhodnocene`] = FieldValue.increment(1);
                
                if (parseInt(uživatelůvTip.tip_domaci) === parseInt(zapas.vysledek_domaci) && 
                    parseInt(uživatelůvTip.tip_hoste) === parseInt(zapas.vysledek_hoste)) {
                    updateBalik[`hracStats.${email}.presneVysledkyCount`] = FieldValue.increment(1);
                    jePresny = true;
                }
                updateBalik[`mapaTipu.${email}.${matchId}`] = uživatelůvTip;
            } else {
                if (jeFotbaloveMS) {
                    bodyZapasu = -1;
                    updateBalik[`hracStats.${email}.celkemBodu`] = FieldValue.increment(bodyZapasu);
                }
                updateBalik[`hracStats.${email}.nenatipovaneVyhodnocene`] = FieldValue.increment(1);
            }

            if (zapas.kolo) {
                const klicKola = String(zapas.kolo).trim();
                updateBalik[`hracStats.${email}.bodyPoKolech.${klicKola}`] = FieldValue.increment(bodyZapasu);
                if (!docasneStatsProRekordy[email].bodyPoKolech) docasneStatsProRekordy[email].bodyPoKolech = {};
                if (docasneStatsProRekordy[email].bodyPoKolech[klicKola] === undefined) docasneStatsProRekordy[email].bodyPoKolech[klicKola] = 0;
                docasneStatsProRekordy[email].bodyPoKolech[klicKola] += bodyZapasu;
            }
            docasneStatsProRekordy[email].celkemBodu += bodyZapasu;
            docasneStatsProRekordy[email].presneVysledkyCount += (jePresny ? 1 : 0);
        });

        updateBalik[`lZapasy.${matchId}`] = zapas;

        let maxPresnychGlobal = 0;
        let maxBoduKoloGlobal = 0;

        vsichniHraciEmaily.forEach(email => {
            const s = docasneStatsProRekordy[email];
            const kolaBodove = Object.values(s.bodyPoKolech || {});
            const maxHraceVKole = kolaBodove.length > 0 ? Math.max(...kolaBodove) : 0;
            if (s.presneVysledkyCount > maxPresnychGlobal) maxPresnychGlobal = s.presneVysledkyCount;
            if (maxHraceVKole > maxBoduKoloGlobal) maxBoduKoloGlobal = maxHraceVKole;
        });

        let kraliPresnosti = [];
        let rekordmaniKola = [];

        vsichniHraciEmaily.forEach(email => {
            const s = docasneStatsProRekordy[email];
            const nick = mapaPrezdivek[email] || email;
            const kolaBodove = Object.values(s.bodyPoKolech || {});
            const maxHraceVKole = kolaBodove.length > 0 ? Math.max(...kolaBodove) : 0;
            if (s.presneVysledkyCount === maxPresnychGlobal && maxPresnychGlobal > 0) kraliPresnosti.push(nick);
            if (maxHraceVKole === maxBoduKoloGlobal && maxBoduKoloGlobal > 0) rekordmaniKola.push(nick);
        });

        updateBalik["textKraliPresnosti"] = kraliPresnosti.length > 0 ? `${kraliPresnosti.join(', ')} (${maxPresnychGlobal}x)` : '–';
        updateBalik["textRekordmaniKola"] = rekordmaniKola.length > 0 ? `${rekordmaniKola.join(', ')} (${maxBoduKoloGlobal} b.)` : '–';

        await zebricekRef.update(updateBalik);
        console.log(`✅ Inkrementální update z bota pro zápas ${matchId} byl úspěšně zapsán.`);
    } catch (e) {
        console.error("Chyba inkrementálního updatu na backendu bota:", e);
    }
}

runBot();