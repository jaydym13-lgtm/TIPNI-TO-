// =========================================================================
// 🤖 TIPNI TO! - AUTONOMNÍ BACKGROUND API & LEADERBOARD BOT (bot.mjs)
// =========================================================================
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import process from 'process';

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
    "Australia": "Austrálie", "Panama": "Panama", "Paraguay": "Paraguay", "Turkey": "Turecko", "Türkiye": "Turecko",
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
    "Ghana": "Ghana"
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
        
        // Načteme aktuální stav zápasů z Firestore do mezipaměti
        const currentMatchesSnap = await db.collection('ligy').doc(LEAGUE_NAME).collection('zapasy').get();
        const firestoreMatches = {};
        currentMatchesSnap.forEach(doc => { firestoreMatches[doc.id] = doc.data(); });

        const zapasyMapa = {}; 

        for (const match of matches) {
            const apiId = String(match.id);
            const status = match.status;
            
            const rawDomaci = match.homeTeam?.name || "Neznámý";
            const rawHoste = match.awayTeam?.name || "Neznámý";
            const domaci = slovnikTymu[rawDomaci] || rawDomaci;
            const hoste = slovnikTymu[rawHoste] || rawHoste;
            
            const isPlayoff = match.stage !== "GROUP_STAGE";
            const kolo = match.matchday ? `Kolo ${match.matchday}` : (match.stage ? match.stage.replace(/_/g, ' ') : "Šampionát");
            const datumTimestamp = Timestamp.fromDate(new Date(match.utcDate));

            let golyDomaci = undefined;
            let golyHoste = undefined;
            let postupVal = "";

            const jeZapasAktivni = status === "FINISHED" || status === "IN_PLAY" || status === "PAUSED";
            const maNacteneGoly = match.score?.fullTime?.home !== null && match.score?.fullTime?.away !== null;

            if (jeZapasAktivni && maNacteneGoly) {
                golyDomaci = parseInt(match.score.fullTime.home);
                golyHoste = parseInt(match.score.fullTime.away);
                if (isPlayoff && golyDomaci === golyHoste) {
                    if (match.score.winner === "HOME_TEAM") postupVal = "domaci";
                    if (match.score.winner === "AWAY_TEAM") postupVal = "hoste";
                }
            }

            const existujiciZapas = firestoreMatches[apiId];

            if (!existujiciZapas) {
                const novyZapas = {
                    domaci, hoste, datum: datumTimestamp, isPlayoff, kolo
                };
                if (golyDomaci !== undefined) {
                    novyZapas.vysledek_domaci = golyDomaci;
                    novyZapas.vysledek_hoste = golyHoste;
                    novyZapas.apiStatus = status;
                    novyZapas.postup = postupVal;
                }
                await db.collection('ligy').doc(LEAGUE_NAME).collection('zapasy').doc(apiId).set(novyZapas);
                zapasyMapa[apiId] = novyZapas;
                console.log(`➕ Importován nový zápas: ${domaci} – ${hoste}`);
            } else {
                if (existujiciZapas.apiStatus === "FINISHED" && status === "IN_PLAY") {
                    zapasyMapa[apiId] = existujiciZapas;
                    continue; 
                }

                let rDom = existujiciZapas.vysledek_domaci;
                let rHos = existujiciZapas.vysledek_hoste;
                let rStatus = existujiciZapas.apiStatus;

                let zmena = false;
                const updatovanyObjekt = {};

                if (golyDomaci !== undefined && (rDom !== golyDomaci || rHos !== golyHoste)) {
                    updatovanyObjekt.vysledek_domaci = golyDomaci;
                    updatovanyObjekt.vysledek_hoste = golyHoste;
                    updatovanyObjekt.postup = postupVal;
                    zmena = true;
                }
                if (rStatus !== status) {
                    updatovanyObjekt.apiStatus = status;
                    zmena = true;
                }

                if (zmena) {
                    await db.collection('ligy').doc(LEAGUE_NAME).collection('zapasy').doc(apiId).update(updatovanyObjekt);
                    zapasyMapa[apiId] = { ...existujiciZapas, ...updatovanyObjekt };
                } else {
                    zapasyMapa[apiId] = existujiciZapas;
                }
            }
        }

        // Spustíme kompletní přepočet žebříčku a zapíšeme hromadný zkomprimovaný stav
        await aktualizujCentralniZebricek(zapasyMapa);

    } catch (e) {
        console.error("❌ Kritická chyba bota:", e);
        process.exit(1);
    }
}

// 🤖 BEZPEČNÝ SAMO-LÉČIVÝ BACKENDOVÝ PŘEPOČET S GIGA OPTIMALIZACÍ PROCENT A SPY MODALŮ
async function aktualizujCentralniZebricek(lZapasy) {
    try {
        const leagueDoc = await db.collection('ligy').doc(LEAGUE_NAME).get();
        const realLeagueData = leagueDoc.exists ? leagueDoc.data() : null;

        const tipsSnapshot = await db.collection('ligy').doc(LEAGUE_NAME).collection('tipy').get();
        const bonusTipsSnapshot = await db.collection('ligy').doc(LEAGUE_NAME).collection('bonusy').get();

        const usersSnapshot = await db.collection('users').get();
        const mapaPrezdivek = {}; 
        const mapaUidToEmail = {}; 
        const mapaEmailToUid = {}; 
        const vsichniHraciUids = new Set();

        usersSnapshot.forEach(uDoc => {
            const uid = uDoc.id; 
            const data = uDoc.data();
            const email = data.email ? data.email.trim().toLowerCase() : '';
            if (email) {
                mapaPrezdivek[email] = data.nickname || email.split('@')[0];
                mapaUidToEmail[uid] = email;
                mapaEmailToUid[email] = uid;
                vsichniHraciUids.add(uid);
            }
        });

        const hracStats = {};
        Object.keys(mapaPrezdivek).forEach(email => {
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
        const nyni = new Date();

        // 🧠 GIGA-TUNING: Spočítáme procentuální tendence skupiny a vygenerujeme balíčky pro zápasové oko (stav/tipy_zapasu_*)
        Object.keys(lZapasy).forEach(matchId => {
            const zapas = lZapasy[matchId];
            let domaciWins = 0; let remizy = 0; let hosteWins = 0;
            const tipyProZapasPole = [];

            Object.keys(mapaPrezdivek).forEach(email => {
                const uživatelůvTip = mapaTipu[email] ? mapaTipu[email][matchId] : null;
                if (uživatelůvTip && uživatelůvTip.tip_domaci !== undefined && uživatelůvTip.tip_domaci !== null && uživatelůvTip.tip_domaci !== '') {
                    const tDom = parseInt(uživatelůvTip.tip_domaci);
                    const tHos = parseInt(uživatelůvTip.tip_hoste);
                    
                    if (tDom > tHos) domaciWins++;
                    else if (tDom === tHos) remizy++;
                    else if (tDom < tHos) hosteWins++;

                    tipyProZapasPole.push({
                        userEmail: email,
                        tip_domaci: tDom,
                        tip_hoste: tHos,
                        postup: uživatelůvTip.postup || ''
                    });
                }
            });

            let celkemTipu = domaciWins + remizy + hosteWins;
            if (celkemTipu > 0) {
                zapas.procentaDomaci = Math.round((domaciWins / celkemTipu) * 100);
                zapas.procentaRemiza = Math.round((remizy / celkemTipu) * 100);
                zapas.procentaHoste = Math.round((hosteWins / celkemTipu) * 100);
            } else {
                zapas.procentaDomaci = 0; zapas.procentaRemiza = 0; zapas.procentaHoste = 0;
            }

            // Pokud zápas už odstartoval, uložíme všechny tipy do jednoho souboru v sekci 'stav' pro úsporu Reads!
            let datumObj = zapas.datum?.toDate ? zapas.datum.toDate() : (zapas.datum?.seconds ? new Date(zapas.datum.seconds * 1000) : new Date(zapas.datum));
            if (datumObj <= nyni || zapas.apiStatus === "IN_PLAY" || zapas.apiStatus === "PAUSED" || zapas.apiStatus === "FINISHED") {
                db.collection('ligy').doc(LEAGUE_NAME).collection('stav').doc(`tipy_zapasu_${matchId}`).set({
                    tipy: tipyProZapasPole,
                    aktualizovano: Timestamp.now()
                }).catch(err => console.error(err));
            }
        });

        // Nyní propočítáme celkové body hráčů pro žebříček
        Object.keys(hracStats).forEach(email => {
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

        const zebricekPole = Object.keys(hracStats).map(email => {
            const uid = mapaEmailToUid[email] || "unknown";
            return {
                uid: uid, email: email, nickname: mapaPrezdivek[email] || email.split('@')[0],
                celkemBodu: hracStats[email].celkemBodu,
                natipovaneVyhodnocene: hracStats[email].natipovaneVyhodnocene,
                nenatipovaneVyhodnocene: hracStats[email].nenatipovaneVyhodnocene,
                presneVysledkyCount: hracStats[email].presneVysledkyCount,
                nejviceBoduVKole: hracStats[email].nejviceBoduVKole,
                vitezMs: hracStats[email].vitezMs, nejStrelec: hracStats[email].nejStrelec
            };
        });

        zebricekPole.sort((a, b) => b.celkemBodu - a.celkemBodu);

        // Zápis odlehčeného žebříčku
        await db.collection('ligy').doc(LEAGUE_NAME).collection('stav').doc('leaderboard').set({
            zebricek: zebricekPole,
            textKraliPresnosti: kraliPresnosti.length > 0 ? `${kraliPresnosti.join(', ')} (${maxPresnychGlobal}x)` : '–',
            textRekordmaniKola: rekordmaniKola.length > 0 ? `${rekordmaniKola.join(', ')} (${maxBoduKoloGlobal} b.)` : '–',
            aktualizovano: Timestamp.now()
        });

        // Zápis centrálního rozpisu včetně našich nových procent! (Ušetří 100 % čtení z hlavní plochy!)
        await db.collection('ligy').doc(LEAGUE_NAME).collection('stav').doc('rozpis').set({
            zapasyMapa: lZapasy,
            aktualizovano: Timestamp.now()
        });

        // 📡 TUNING BOD 3: Aktualizujeme pulsní mikro-dokument, frontend se dozví o změnách okamžitě
        await db.collection('ligy').doc(LEAGUE_NAME).collection('stav').doc('puls').set({
            verzeRozpisu: Date.now(),
            verzeZebricku: Date.now(),
            aktualizovano: Timestamp.now()
        }, { merge: true });

        // Vygenerování individuálních odemčených historií pro Spy Modal žebříčku
        for (const uid of vsichniHraciUids) {
            const email = mapaUidToEmail[uid];
            const hracovyTipyVsechny = mapaTipu[email] || {};
            const hracovyTipyOdemcene = {};

            Object.keys(hracovyTipyVsechny).forEach(matchId => {
                const zapas = lZapasy[matchId];
                if (zapas && zapas.datum) {
                    let dObj = zapas.datum.toDate ? zapas.datum.toDate() : (zapas.datum.seconds ? new Date(zapas.datum.seconds * 1000) : new Date(zapas.datum));
                    if (dObj <= nyni) {
                        hracovyTipyOdemcene[matchId] = hracovyTipyVsechny[matchId];
                    }
                }
            });

            await db.collection('ligy').doc(LEAGUE_NAME).collection('stav').doc(`historie_${uid}`).set({
                mapaTipu: hracovyTipyOdemcene, vytvoreno: Timestamp.now()
            });
        }

        console.log(`✅ Nová agregovaná data s nula-read tendencemi úspěšně zapsána.`);
    } catch (e) {
        console.error("Chyba bota:", e);
    }
}

runBot();