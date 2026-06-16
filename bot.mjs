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
                        }
                    }
                }
            }
        }

        if (detekovanNovyKonecZapasu) {
            console.log(`🧠 Detekována finální změna zápasu. Spouštím bezpečný přepočet žebříčku...`);
            await aktualizujCentralniZebricek();
        } else {
            console.log("😴 Žádný nový finální výsledek k zápisu nebyl detekován.");
        }

    } catch (e) {
        console.error("❌ Kritická chyba bota:", e);
        process.exit(1);
    }
}

// 🤖 BEZPEČNÝ SAMO-LÉČIVÝ BACKENDOVÝ PŘEPOČET ŽEBŘÍČKU (0 PATH CONFLICTS)
async function aktualizujCentralniZebricek() {
    try {
        const matchesSnapshot = await db.collection('ligy').doc(LEAGUE_NAME).collection('zapasy').get();
        const lZapasy = {};
        matchesSnapshot.forEach(doc => { lZapasy[doc.id] = doc.data(); });

        const leagueDoc = await db.collection('ligy').doc(LEAGUE_NAME).get();
        const realLeagueData = leagueDoc.exists ? leagueDoc.data() : null;

        const tipsSnapshot = await db.collection('ligy').doc(LEAGUE_NAME).collection('tipy').get();
        const bonusTipsSnapshot = await db.collection('ligy').doc(LEAGUE_NAME).collection('bonusy').get();

        const usersSnapshot = await db.collection('users').get();
        const mapaPrezdivek = {};
        usersSnapshot.forEach(uDoc => {
            const kl = uDoc.id.trim().toLowerCase();
            if (kl.includes('@')) mapaPrezdivek[kl] = uDoc.data().nickname || uDoc.id;
        });

        const vsichniHraciEmaily = new Set();
        tipsSnapshot.forEach(doc => { if (doc.data().userEmail) vsichniHraciEmaily.add(doc.data().userEmail.trim().toLowerCase()); });
        bonusTipsSnapshot.forEach(doc => { if (doc.data().userEmail) vsichniHraciEmaily.add(doc.data().userEmail.trim().toLowerCase()); });
        Object.keys(mapaPrezdivek).forEach(email => vsichniHraciEmaily.add(email));

        const hracStats = {};
        vsichniHraciEmaily.forEach(email => {
            if (!email.includes('@')) return;
            hracStats[email] = {
                celkemBodu: 0, natipovaneVyhodnocene: 0, nenatipovaneVyhodnocene: 0, presneVysledkyCount: 0,
                bodyPoKolech: {}, nejStrelec: '–', vitezMs: '–', nejviceBoduVKole: 0
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

        const jeFotbaloveMS = (LEAGUE_NAME === "MS ve fotbale" || LEAGUE_NAME === "MS ve fotbale 2026");

        vsichniHraciEmaily.forEach(email => {
            if (!email.includes('@')) return;

            Object.keys(lZapasy).forEach(matchId => {
                const zapas = lZapasy[matchId];
                const jeVyhodnoceny = (zapas.vysledek_domaci !== undefined && zapas.vysledek_hoste !== undefined && zapas.apiStatus !== "IN_PLAY" && zapas.apiStatus !== "PAUSED");

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
                        if (jeFotbaloveMS) { 
                            bodyZapasu = -1; hracStats[email].celkemBodu += bodyZapasu; 
                        }
                        hracStats[email].nenatipovaneVyhodnocene++;
                    }

                    if (zapas.kolo) {
                        const klicKola = String(zapas.kolo).trim();
                        if (hracStats[email].bodyPoKolech[klicKola] === undefined) hracStats[email].bodyPoKolech[klicKola] = 0;
                        hracStats[email].bodyPoKolech[klicKola] += bodyZapasu;
                    }
                }
            });

            const kolaBodove = Object.values(hracStats[email].bodyPoKolech);
            hracStats[email].nejviceBoduVKole = kolaBodove.length > 0 ? Math.max(...kolaBodove) : 0;
        });

        let maxPresnychGlobal = 0; let maxBoduKoloGlobal = 0;
        Object.keys(hracStats).forEach(email => {
            if (hracStats[email].presneVysledkyCount > maxPresnychGlobal) maxPresnychGlobal = hracStats[email].presneVysledkyCount;
            if (hracStats[email].nejviceBoduVKole > maxBoduKoloGlobal) maxBoduKoloGlobal = hracStats[email].nejviceBoduVKole;
        });

        let kraliPresnosti = []; let rekordmaniKola = [];
        Object.keys(hracStats).forEach(email => {
            const nick = mapaPrezdivek[email] || email.split('@')[0];
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
        console.log(`✅ Žebříček na backendu bota úspěšně přegenerován a vyčištěn.`);
    } catch (e) {
        console.error("Chyba přepočtu na bota:", e);
    }
}

runBot();