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

        let detekovanNovyKonecZapasu = false;
        const zapasyKInkrementalnimuUpdatu = [];

        for (const match of matches) {
            const apiId = match.id;
            
            const jeZapasAktivni = match.status === "FINISHED" || match.status === "IN_PLAY";
            const maNacteneGoly = match.score?.fullTime?.home !== null && match.score?.fullTime?.away !== null;

            if (jeZapasAktivni && maNacteneGoly) {
                const golyDomaci = parseInt(match.score.fullTime.home);
                const golyHoste = parseInt(match.score.fullTime.away);

                const docSnap = await db.collection('ligy').doc(LEAGUE_NAME).collection('zapasy').doc(String(apiId)).get();

                if (docSnap.exists) {
                    const fbData = docSnap.data();

                    if (fbData.apiStatus === "FINISHED" && match.status === "IN_PLAY") {
                        continue;
                    }

                    if (fbData.vysledek_domaci !== golyDomaci || fbData.vysledek_hoste !== golyHoste || fbData.apiStatus !== match.status) {
                        let postupVal = "";
                        if (fbData.isPlayoff && golyDomaci === golyHoste) {
                            if (match.score.winner === "HOME_TEAM") postupVal = "domaci";
                            if (match.score.winner === "AWAY_TEAM") postupVal = "hoste";
                        }

                        await db.collection('ligy').doc(LEAGUE_NAME).collection('zapasy').doc(String(apiId)).update({
                            vysledek_domaci: golyDomaci,
                            vysledek_hoste: golyHoste,
                            postup: postupVal,
                            apiStatus: match.status
                        });
                        
                        const emojiStavu = match.status === "IN_PLAY" ? "🔴 LIVE GÓL" : "🎯 FINÁLNÍ VÝSLEDEK";
                        console.log(`${emojiStavu}: ${fbData.domaci} ${golyDomaci}:${golyHoste} ${fbData.hoste}`);
                        
                        if (match.status === "FINISHED") {
                            detekovanNovyKonecZapasu = true;
                            zapasyKInkrementalnimuUpdatu.push(String(apiId));
                        }
                    }
                }
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

// 🤖 AUTONOMNÍ BACKENDOVÝ PŘÍRŮSTKOVÝ MANAŽER BODŮ (PAMĚŤOVÝ ENFORCER)
async function aktualizujZapasInkrementalne(matchId) {
    try {
        console.log(`🚀 Startuji backendový update pro zápas ${matchId}...`);

        const zapasDoc = await db.collection('ligy').doc(LEAGUE_NAME).collection('zapasy').doc(matchId).get();
        if (!zapasDoc.exists) return;
        const zapas = zapasDoc.data();

        if (zapas.vysledek_domaci === undefined || zapas.vysledek_hoste === undefined || zapas.apiStatus !== "FINISHED") {
            return;
        }

        const zebricekRef = db.collection('ligy').doc(LEAGUE_NAME).collection('stav').doc('zebricek');
        let zebricekDoc = await zebricekRef.get();
        let zebricekData = zebricekDoc.exists ? zebricekDoc.data() : null;

        if (!zebricekData) {
            console.log("🧼 Žebříček neexistuje. Inicializuji základní strukturu účastníků...");
            zebricekData = {
                hracStats: {}, mapaTipu: {}, lZapasy: {}, realLeagueData: null, mapaPrezdivek: {},
                textKraliPresnosti: '–', textRekordmaniKola: '–'
            };
            const usersSnapshot = await db.collection('users').get();
            usersSnapshot.forEach(uDoc => {
                const email = uDoc.id.trim().toLowerCase();
                zebricekData.mapaPrezdivek[email] = uDoc.data().nickname || uDoc.id;
                zebricekData.hracStats[email] = {
                    celkemBodu: 0, natipovaneVyhodnocene: 0, nenatipovaneVyhodnocene: 0, presneVysledkyCount: 0,
                    bodyPoKolech: {}, nejStrelec: '–', vitezMs: '–', nejviceBoduVKole: 0
                };
            });
        }

        if (zebricekData.lZapasy && zebricekData.lZapasy[matchId] && zebricekData.lZapasy[matchId].apiStatus === "FINISHED") {
            console.log(`⚠️ Zápas ${matchId} už v žebříčku jednou skončil. Přeskakuji zápis bota.`);
            return;
        }

        const tipsSnapshot = await db.collection('ligy').doc(LEAGUE_NAME).collection('tipy').where('matchId', '==', matchId).get();
        const mapaTipuZapasu = {};
        tipsSnapshot.forEach(doc => {
            const t = doc.data();
            if (t.userEmail) mapaTipuZapasu[t.userEmail.trim().toLowerCase()] = t;
        });

        const jeFotbaloveMS = (LEAGUE_NAME === "MS ve fotbale" || LEAGUE_NAME === "MS ve fotbale 2026");
        const vsichniHraciEmaily = new Set([
            ...Object.keys(zebricekData.hracStats),
            ...Object.keys(mapaTipuZapasu)
        ]);

        vsichniHraciEmaily.forEach(email => {
            if (!zebricekData.hracStats[email]) {
                zebricekData.mapaPrezdivek[email] = email.split('@')[0];
                zebricekData.hracStats[email] = {
                    celkemBodu: 0, natipovaneVyhodnocene: 0, nenatipovaneVyhodnocene: 0, presneVysledkyCount: 0,
                    bodyPoKolech: {}, nejStrelec: '–', vitezMs: '–', nejviceBoduVKole: 0
                };
            }

            const stats = zebricekData.hracStats[email];
            const uživatelůvTip = mapaTipuZapasu[email];
            let bodyZapasu = 0;

            if (uživatelůvTip) {
                bodyZapasu = vypocitejBodyZapasu(
                    uživatelůvTip.tip_domaci, uživatelůvTip.tip_hoste,
                    zapas.vysledek_domaci, zapas.vysledek_hoste,
                    uživatelůvTip.postup, zapas.postup, zapas.isPlayoff
                );
                stats.celkemBodu += bodyZapasu;
                stats.natipovaneVyhodnocene += 1;
                
                if (parseInt(uživatelůvTip.tip_domaci) === parseInt(zapas.vysledek_domaci) && 
                    parseInt(uživatelůvTip.tip_hoste) === parseInt(zapas.vysledek_hoste)) {
                    stats.presneVysledkyCount += 1;
                }

                if (!zebricekData.mapaTipu[email]) zebricekData.mapaTipu[email] = {};
                zebricekData.mapaTipu[email][matchId] = uživatelůvTip;
            } else {
                if (jeFotbaloveMS) {
                    bodyZapasu = -1;
                    stats.celkemBodu += bodyZapasu;
                }
                stats.nenatipovaneVyhodnocene += 1;
            }

            if (zapas.kolo) {
                const klicKola = String(zapas.kolo).trim();
                if (stats.bodyPoKolech[klicKola] === undefined) stats.bodyPoKolech[klicKola] = 0;
                stats.bodyPoKolech[klicKola] += bodyZapasu;
            }

            const kolaBodove = Object.values(stats.bodyPoKolech || {});
            stats.nejviceBoduVKole = kolaBodove.length > 0 ? Math.max(...kolaBodove) : 0;
        });

        if (!zebricekData.lZapasy) zebricekData.lZapasy = {};
        zebricekData.lZapasy[matchId] = zapas;

        let maxPresnychGlobal = 0;
        let maxBoduKoloGlobal = 0;

        Object.values(zebricekData.hracStats).forEach(s => {
            if (s.presneVysledkyCount > maxPresnychGlobal) maxPresnychGlobal = s.presneVysledkyCount;
            if (s.nejviceBoduVKole > maxBoduKoloGlobal) maxBoduKoloGlobal = s.nejviceBoduVKole;
        });

        let kraliPresnosti = [];
        let rekordmaniKola = [];

        Object.keys(zebricekData.hracStats).forEach(email => {
            const s = zebricekData.hracStats[email];
            const nick = zebricekData.mapaPrezdivek[email] || email;
            if (s.presneVysledkyCount === maxPresnychGlobal && maxPresnychGlobal > 0) kraliPresnosti.push(nick);
            if (s.nejviceBoduVKole === maxBoduKoloGlobal && maxBoduKoloGlobal > 0) rekordmaniKola.push(nick);
        });

        zebricekData.textKraliPresnosti = kraliPresnosti.length > 0 ? `${kraliPresnosti.join(', ')} (${maxPresnychGlobal}x)` : '–';
        zebricekData.textRekordmaniKola = rekordmaniKola.length > 0 ? `${rekordmaniKola.join(', ')} (${maxBoduKoloGlobal} b.)` : '–';

        await zebricekRef.set(zebricekData);
        console.log(`✅ Žebříček úspěšně kompletně zaktualizován botem pro zápas ${matchId}.`);
    } catch (e) {
        console.error("Chyba inkrementálního updatu na backendu bota:", e);
    }
}

runBot();