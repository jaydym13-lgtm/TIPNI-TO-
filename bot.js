// =========================================================================
// 🤖 TIPNI TO! - AUTONOMNÍ BACKGROUND API & LEADERBOARD BOT (bot.js)
// =========================================================================
const admin = require('firebase-admin');

// 1. INICIALIZACE FIREBASE POMOCÍ TAJNÉHO KLÍČE Z ENV
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

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
        let aktualizovanoZapasu = 0;

        for (const match of matches) {
            const apiId = match.id;
            const maVysledek = match.status === "FINISHED" && match.score?.fullTime?.home !== null;

            if (maVysledek) {
                const golyDomaci = parseInt(match.score.fullTime.home);
                const golyHoste = parseInt(match.score.fullTime.away);

                const snapshot = await db.collection('ligy').doc(LEAGUE_NAME).collection('zapasy')
                    .where('apiMatchId', '==', apiId).get();

                if (!snapshot.empty) {
                    const docId = snapshot.docs[0].id;
                    const fbData = snapshot.docs[0].data();

                    if (fbData.vysledek_domaci !== golyDomaci || fbData.vysledek_hoste !== golyHoste) {
                        let postupVal = "";
                        if (fbData.isPlayoff && golyDomaci === golyHoste) {
                            if (match.score.winner === "HOME_TEAM") postupVal = "domaci";
                            if (match.score.winner === "AWAY_TEAM") postupVal = "hoste";
                        }

                        await db.collection('ligy').doc(LEAGUE_NAME).collection('zapasy').doc(docId).update({
                            vysledek_domaci: golyDomaci,
                            vysledek_hoste: golyHoste,
                            postup: postupVal
                        });
                        console.log(`🎯 Zapsán výsledek: ${fbData.domaci} ${golyDomaci}:${golyHoste} ${fbData.hoste}`);
                        aktualizovanoZapasu++;
                    }
                }
            }
        }

        if (aktualizovanoZapasu > 0) {
            console.log(`🧠 Detekovány změny (${aktualizovanoZapasu} zápasů). Spouštím přepočet žebříčku...`);
            await aktualizujCentralniZebricek();
        } else {
            console.log("😴 Žádné nové dohrané zápasy v API nenalezeny.");
        }

    } catch (e) {
        console.error("❌ Kritická chyba bota:", e);
        process.exit(1);
    }
}

// PŘEPSANÁ LOGIKA PŘEPOČTU ŽEBŘÍČKU PRO BACKEND NODE.JS ENVIRONMENT
async function aktualizujCentralniZebricek() {
    const matchesSnapshot = await db.collection('ligy').doc(LEAGUE_NAME).collection('zapasy').get();
    const lZapasy = {};
    matchesSnapshot.forEach(doc => { lZapasy[doc.id] = doc.data(); });

    const leagueDoc = await db.collection('ligy').doc(LEAGUE_NAME).get();
    const realLeagueData = leagueDoc.exists ? leagueDoc.data() : null;

    const tipsSnapshot = await db.collection('ligy').doc(LEAGUE_NAME).collection('tipy').get();
    const bonusTipsSnapshot = await db.collection('ligy').doc(LEAGUE_NAME).collection('bonusy').get();

    const vsichniHraciEmaily = new Set();
    tipsSnapshot.forEach(doc => { if (doc.data().userEmail) vsichniHraciEmaily.add(doc.data().userEmail.trim().toLowerCase()); });
    bonusTipsSnapshot.forEach(doc => { if (doc.data().userEmail) vsichniHraciEmaily.add(doc.data().userEmail.trim().toLowerCase()); });

    const hracStats = {};
    vsichniHraciEmaily.forEach(email => {
        hracStats[email] = {
            celkemBodu: 0, natipovaneVyhodnocene: 0, nenatipovaneVyhodnocene: 0, presneVysledkyCount: 0,
            bodyPoKolech: { 1: 0, 2: 0, 3: 0, 4: 0 }, nejStrelec: '–', vitezMs: '–', nejviceBoduVKole: 0
        };
    });

    const mapaTipu = {};
    tipsSnapshot.forEach(doc => {
        const tip = doc.data();
        if (tip.userEmail) {
            const emailKey = tip.userEmail.trim().toLowerCase();
            if (!mapaTipu[emailKey]) mapaTipu[emailKey] = {};
            mapaTipu[emailKey][tip.matchId] = tip;
        }
    });

    vsichniHraciEmaily.forEach(email => {
        Object.keys(lZapasy).forEach(matchId => {
            const zapas = lZapasy[matchId];
            const jeVyhodnoceny = (zapas.vysledek_domaci !== undefined && zapas.vysledek_hoste !== undefined);

            if (jeVyhodnoceny) {
                const uživatelůvTip = mapaTipu[email] ? mapaTipu[email][matchId] : null;
                let bodyZapasu = 0;

                if (uživatelůvTip) {
                    bodyZapasu = vypocitejBodyZapasu(
                        uživatelůvTip.tip_domaci, uživatelůvTip.tip_hoste,
                        zapas.vysledek_domaci, zapas.vysledek_hoste,
                        uživatelůvTip.postup, zapas.postup, zapas.isPlayoff
                    );
                    hracStats[email].celkemBodu += bodyZapasu;
                    hracStats[email].natipovaneVyhodnocene++;
                    
                    if (parseInt(uživatelůvTip.tip_domaci) === parseInt(zapas.vysledek_domaci) && 
                        parseInt(uživatelůvTip.tip_hoste) === parseInt(zapas.vysledek_hoste)) {
                        hracStats[email].presneVysledkyCount++;
                    }
                } else {
                    hracStats[email].celkemBodu -= 1; // Penalizace za nenatipování na MS
                    hracStats[email].nenatipovaneVyhodnocene++;
                }

                if (zapas.kolo && hracStats[email].bodyPoKolech[zapas.kolo] !== undefined) {
                    hracStats[email].bodyPoKolech[zapas.kolo] += bodyZapasu;
                }
            }
        });
    });

    bonusTipsSnapshot.forEach(doc => {
        const bTip = doc.data();
        if (bTip.userEmail) {
            const emailKey = bTip.userEmail.trim().toLowerCase();
            if (hracStats[emailKey]) {
                hracStats[emailKey].nejStrelec = bTip.strelec || '–';
                hracStats[emailKey].vitezMs = bTip.vitez || '–';
            }
        }
    });

    let maxPresnychGlobal = 0; let maxBoduKoloGlobal = 0;
    vsichniHraciEmaily.forEach(email => {
        const kolaBodove = [hracStats[email].bodyPoKolech[1], hracStats[email].bodyPoKolech[2], hracStats[email].bodyPoKolech[3], hracStats[email].bodyPoKolech[4]];
        hracStats[email].nejviceBoduVKole = Math.max(...kolaBodove);
        if (hracStats[email].presneVysledkyCount > maxPresnychGlobal) maxPresnychGlobal = hracStats[email].presneVysledkyCount;
        if (hracStats[email].nejviceBoduVKole > maxBoduKoloGlobal) maxBoduKoloGlobal = hracStats[email].nejviceBoduVKole;
    });

    const usersSnapshot = await db.collection('users').get();
    const mapaPrezdivek = {};
    usersSnapshot.forEach(uDoc => { mapaPrezdivek[uDoc.id.trim().toLowerCase()] = uDoc.data().nickname || uDoc.id; });

    let kraliPresnosti = []; let rekordmaniKola = [];
    vsichniHraciEmaily.forEach(email => {
        const nick = mapaPrezdivek[email] || email;
        if (hracStats[email].presneVysledkyCount === maxPresnychGlobal && maxPresnychGlobal > 0) kraliPresnosti.push(nick);
        if (hracStats[email].nejviceBoduVKole === maxBoduKoloGlobal && maxBoduKoloGlobal > 0) rekordmaniKola.push(nick);
    });

    await db.collection('ligy').doc(LEAGUE_NAME).collection('stav').doc('zebricek').set({
        hracStats: hracStats,
        mapaTipu: mapaTipu,
        lZapasy: lZapasy,
        realLeagueData: realLeagueData,
        mapaPrezdivek: mapaPrezdivek,
        textKraliPresnosti: kraliPresnosti.length > 0 ? `${kraliPresnosti.join(', ')} (${maxPresnychGlobal}x)` : '–',
        textRekordmaniKola: rekordmaniKola.length > 0 ? `${rekordmaniKola.join(', ')} (${maxBoduKoloGlobal} b.)` : '–'
    });
    console.log(`✅ Centralizovaná tabulka pro "${LEAGUE_NAME}" byla kompletně přepočítána bitem.`);
}

runBot();