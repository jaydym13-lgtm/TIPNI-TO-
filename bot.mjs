// =========================================================================
// 🤖 TIPNI TO! - AUTONOMNÍ BACKGROUND API & LEADERBOARD BOT (bot.mjs)
// =========================================================================
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import process from 'process';

import fs from 'fs';
import path from 'path';

// Konfigurace úložiště pro Netlify CDN harddisk
const OUTPUT_DIR = './public/data';

// Pomocná funkce pro vyčištění Firestore Timestamp objektů na obyčejný ISO text pro standardní JSON
const sanitizeForJson = (obj) => {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj.toDate === 'function') return obj.toDate().toISOString();
    if (typeof obj.seconds === 'number') return new Date(obj.seconds * 1000).toISOString();
    if (typeof obj === 'object') {
        if (Array.isArray(obj)) return obj.map(sanitizeForJson);
        const newObj = {};
        for (const key of Object.keys(obj)) {
            newObj[key] = sanitizeForJson(obj[key]);
        }
        return newObj;
    }
    return obj;
};

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
        
        // SENIORNÍ FILTR: Vybereme z API payloadu pouze zápasy, které nejsou odehrané před více než 48h
        const relevantniApiIds = matches
            .filter(m => !(m.status === "FINISHED" && (new Date() - new Date(m.utcDate)) > 48 * 60 * 60 * 1000))
            .map(m => String(m.id));

        const firestoreMatches = {};
        if (relevantniApiIds.length > 0) {
            // Načteme z databáze POUZE tyto aktivní/nedávné zápasy (drastické snížení Reads operací!)
            const chunks = [];
            for (let i = 0; i < relevantniApiIds.length; i += 30) {
                chunks.push(relevantniApiIds.slice(i, i + 30));
            }
            for (const chunk of chunks) {
                const snap = await db.collection('ligy').doc(LEAGUE_NAME).collection('zapasy').where('__name__', 'in', chunk).get();
                snap.forEach(doc => { firestoreMatches[doc.id] = doc.data(); });
            }
        }

        const zapasyMapa = {}; 
        let zmenaVZapasech = false;
        let InsertHistoryFlag = false;
        const zmeneneMatchIds = new Set();
        const liveMatchIds = [];
        const nyniCheck = new Date();

        for (const match of matches) {
            const apiId = String(match.id);
            const status = match.status;
            
            // Pokud je zápas starší než 24 hodin a je kompletně hotový, bot ho s ledovým klidem přeskočí
            if (status === "FINISHED" && (nyniCheck - new Date(match.utcDate)) > 24 * 60 * 60 * 1000) {
                continue;
            }

            const rawDomaci = match.homeTeam?.name || "Neznámý";
            const rawHoste = match.awayTeam?.name || "Neznámý";
            const domaci = slovnikTymu[rawDomaci] || rawDomaci;
            const hoste = slovnikTymu[rawHoste] || rawHoste;
            
            const isPlayoff = match.stage !== "GROUP_STAGE";
            const kolo = match.matchday ? `Kolo ${match.matchday}` : (match.stage ? match.stage.replace(/_/g, ' ') : "Šampionát");
            const datumTimestamp = Timestamp.fromDate(new Date(match.utcDate));
            const datumObjCheck = datumTimestamp.toDate();

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

            // Zachytíme zápasy, které zrovna reálně běží, nebo překonaly časový zámek a čekají na spuštění
            if (status === "IN_PLAY" || status === "PAUSED" || (datumObjCheck <= nyniCheck && status !== "FINISHED")) {
                liveMatchIds.push(apiId);
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
            zmenaVZapasech = true;
            InsertHistoryFlag = true; // Nový zápas v systému vyžaduje přepis historií
            zmeneneMatchIds.add(apiId);
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
                InsertHistoryFlag = true; // Změna stavu utkání (např. odstartování) odemyká tipy pro Spy Modal!
            }

                if (zmena) {
                    await db.collection('ligy').doc(LEAGUE_NAME).collection('zapasy').doc(apiId).update(updatovanyObjekt);
                    zapasyMapa[apiId] = { ...existujiciZapas, ...updatovanyObjekt };
                    zmenaVZapasech = true;
                    zmeneneMatchIds.add(apiId);
                } else {
                    zapasyMapa[apiId] = existujiciZapas;
                }
            }
        }

        // Předáme nasbírané metriky a stavy do výpočetního jádra včetně nového jističe
    await aktualizujCentralniZebricek(zapasyMapa, zmenaVZapasech, zmeneneMatchIds, liveMatchIds, InsertHistoryFlag);

    } catch (e) {
        console.error("❌ Kritická chyba bota:", e);
        process.exit(1);
    }
}

// 🤖 BEZPEČNÝ SAMO-LÉČIVÝ BACKENDOVÝ PŘEPOČET S GIGA OPTIMALIZACÍ PROCENT A SPY MODALŮ
async function aktualizujCentralniZebricek(lZapasy, zmenaVZapasech, zmeneneMatchIds, liveMatchIds, InsertHistoryFlag = false) {
    try {
// Automaticky vytvoříme složku na disku, pokud ještě neexistuje
        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }
        const nyni = new Date();
    const pouzitBaseline = false; // Fix: Definujeme chybějící příznak baseline synchronizace

        // 🚪 PROFI SENIORNÍ JISTIČ PENĚŽENKY: Pokud nedošlo k žádné reálné změně skóre ani stavu,
        // okamžitě bota vypneme dřív, než začne stahovat lidi, přepočítávat body a přepisovat puls!
        if (!zmenaVZapasech) {
            console.log("💤 Žádná změna reality v zápasech. Končím předčasně (Ušetřeno 100 % operací žebříčku, uživatelů a pulsu).");
            return;
        }

        const leagueDoc = await db.collection('ligy').doc(LEAGUE_NAME).get();
        const realLeagueData = leagueDoc.exists ? leagueDoc.data() : null;

        const usersSnapshot = await db.collection('users').get();
        const mapaPrezdivek = {}; 
        const mapaUidToEmail = {}; 
        const mapaEmailToUid = {}; 
        const vsichniHraciUids = []; // Čisté pole pro spolehlivý ES6 .map()

        usersSnapshot.forEach(uDoc => {
            const uid = uDoc.id; 
            const data = uDoc.data();
            const email = data.email ? data.email.trim().toLowerCase() : '';
            if (email) {
                mapaPrezdivek[email] = data.nickname || email.split('@')[0];
                mapaUidToEmail[uid] = email;
                mapaEmailToUid[email] = uid;
                vsichniHraciUids.push(uid); // Plníme indexované pole UIDs
            }
        });

        // 🪐 PARALELNÍ EXKAVÁTOR SEZÓN: Bot bleskově synchronous vytáhne šuplíky všech registrovaných lidí (0 reads z kolekce tipy!)
        const SEZONA_ID = "2025_2026";
        const ligaKlic = LEAGUE_NAME.replace(/ /g, "_");
        
        console.log(`📡 BOT SYNC: Tahám herní monolity ze subkolekce sezóny: ${SEZONA_ID}...`);
        const sezonaSliby = vsichniHraciUids.map(uid => db.collection('users').doc(uid).collection('sezony').doc(SEZONA_ID).get());
        const sezonaSnaps = await Promise.all(sezonaSliby);

        const hracStats = {};
        Object.keys(mapaPrezdivek).forEach(email => {
            hracStats[email] = {
                celkemBodu: 0, natipovaneVyhodnocene: 0, nenatipovaneVyhodnocene: 0, presneVysledkyCount: 0,
                celkemBoduLive: 0, natipovaneVyhodnoceneLive: 0, nenatipovaneVyhodnoceneLive: 0, presneVysledkyCountLive: 0,
                bodyPoKolech: {}, nejStrelec: '–', vitezMs: '–', nejviceBoduVKole: 0
            };
        });

        const mapaTipu = {};

        sezonaSnaps.forEach(sSnap => {

            if (!sSnap.exists) return;
            const uid = sSnap.ref.parent.parent.id;
            const email = mapaUidToEmail[uid];
            if (!email || !hracStats[email]) return;

            const sData = sSnap.data() || {};
            const souteze = sData.souteze || {};
            const soutezData = souteze[ligaKlic] || {};

            // Synchronní rekonstrukce dlouhodobých bonusů
            const bTip = soutezData.bonusy || {};
            hracStats[email].nejStrelec = bTip.strelec || '–';
            hracStats[email].vitezMs = bTip.vitez || '–';

            // Synchronní rekonstrukce zápasových tipů
            mapaTipu[email] = soutezData.tipy || {};
        });

        // 👑 BACKENDOVÉ AUTOMATICKÉ VYHODNOCENÍ MISTRŮ: Pokud admin vypsal mistry, bot automaticky propočte a zapeče +8b / +10b do výsledků
        if (realLeagueData && (realLeagueData.vitez || realLeagueData.strelec)) {
            Object.keys(hracStats).forEach(email => {
                let bonusBody = 0;
                let hodnotaBonus = (LEAGUE_NAME === "MS ve fotbale") ? 8 : 10;
                
                if (realLeagueData.vitez && hracStats[email].vitezMs && hracStats[email].vitezMs.trim().toLowerCase() === realLeagueData.vitez.trim().toLowerCase()) {
                    bonusBody += hodnotaBonus;
                }
                if (realLeagueData.strelec && hracStats[email].nejStrelec && hracStats[email].nejStrelec.trim().toLowerCase() === realLeagueData.strelec.trim().toLowerCase()) {
                    bonusBody += hodnotaBonus;
                }
                
                hracStats[email].celkemBodu += bonusBody;
                hracStats[email].celkemBoduLive += bonusBody;
            });
            console.log("🏆 Výsledky šampionátu porovnány. Bonusové body byly úspěšně zapečeny do tabulky.");
        }

        const jeFotbaloveMS = (LEAGUE_NAME === "MS ve fotbale");

        // 🧠 GIGA-TUNING: Procenta tendencí a zápis Spy Modalu (stav/tipy_zapasu_*)
        for (const matchId of Object.keys(lZapasy)) {
            const zapas = lZapasy[matchId];
            let datumObj = zapas.datum?.toDate ? zapas.datum.toDate() : (zapas.datum?.seconds ? new Date(zapas.datum.seconds * 1000) : new Date(zapas.datum));
            
            // 🔒 IMUTABILNÍ ZMRAZENÍ (Řeší Past 3): Zpětný zápis dat oka provádíme pouze tehdy, pokud zápas zrovna běží, nebo se právě teď změnil
            const jeZapasAktivniNeboZmeneny = liveMatchIds.includes(matchId) || zmeneneMatchIds.has(matchId);
            
            if (jeZapasAktivniNeboZmeneny && (datumObj <= nyni || zapas.apiStatus === "IN_PLAY" || zapas.apiStatus === "PAUSED" || zapas.apiStatus === "FINISHED")) {
                let domaciWins = 0; let remizy = 0; let hosteWins = 0;
                const tipyProZapasPole = [];

                Object.keys(mapaPrezdivek).forEach(email => {
                    const uživatelůvTip = mapaTipu[email] ? mapaTipu[email][matchId] : null;
                    // Striktně ověříme kompletní přítomnost obou složek tipu
                    if (uživatelůvTip && 
                        uživatelůvTip.tip_domaci !== undefined && uživatelůvTip.tip_domaci !== null && uživatelůvTip.tip_domaci !== '' &&
                        uživatelůvTip.tip_hoste !== undefined && uživatelůvTip.tip_hoste !== null && uživatelůvTip.tip_hoste !== '') {
                        
                        const tDom = parseInt(uživatelůvTip.tip_domaci);
                        const tHos = parseInt(uživatelůvTip.tip_hoste);
                        
                        // Imunita proti NaN: Pokud selhal převod čísla, vyhodíme z matematiky ven a nepočítáme do remíz
                        if (!isNaN(tDom) && !isNaN(tHos)) {
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
                    }
                });

                let celkemTipu = domaciWins + remizy + hosteWins;
                if (celkemTipu > 0) {
                    let pDom = Math.round((domaciWins / celkemTipu) * 100);
                    let pRem = Math.round((remizy / celkemTipu) * 100);
                    let pHos = Math.round((hosteWins / celkemTipu) * 100);

                    // 👑 VYROVNÁVACÍ MATEMATICKÝ DRÁT: Zlikviduje odchylky zaokrouhlování a dorovná součet na fixních 100 %
                    let soucet = pDom + pRem + pHos;
                    if (soucet !== 100) {
                        let rozdil = 100 - soucet;
                        if (domaciWins >= remizy && domaciWins >= hosteWins) pDom += rozdil;
                        else if (remizy >= domaciWins && remizy >= hosteWins) pRem += rozdil;
                        else pHos += rozdil;
                    }

                    zapas.procentaDomaci = pDom;
                    zapas.procentaRemiza = pRem;
                    zapas.procentaHoste = pHos;
                }

                try {
                    await db.collection('ligy').doc(LEAGUE_NAME).collection('stav').doc(`tipy_zapasu_${matchId}`).set({
                        tipy: tipyProZapasPole,
                        aktualizovano: Timestamp.now()
                    });
                } catch (err) {
                    console.error(`Chyba zápisu tipů pro zápas ${matchId}:`, err);
            }

            // [FÁZE 1] ZÁPIS NA DISK: Tipy všech lidí pro Spy Modal jednoho konkrétního zápasu
            const spyJsonData = sanitizeForJson({
                tipy: tipyProZapasPole,
                aktualizovano: Timestamp.now()
            });
            fs.writeFileSync(path.join(OUTPUT_DIR, `spy_zapas_${matchId}.json`), JSON.stringify(spyJsonData, null, 2));
            }
        }

        // 🧮 HYBRIDNÍ SMYČKA: Procházíme buď všechna utkání, nebo pouze přírůstkové živé zápasy (podle stavu baseline)
        const maciKeProhlidce = pouzitBaseline ? liveMatchIds : Object.keys(lZapasy);

        Object.keys(hracStats).forEach(email => {
            maciKeProhlidce.forEach(matchId => {
                const zapas = lZapasy[matchId];
                if (!zapas) return;

                const jeVyhodnoceny = (zapas.vysledek_domaci !== undefined && zapas.vysledek_hoste !== undefined && zapas.apiStatus !== "IN_PLAY" && zapas.apiStatus !== "PAUSED");
                const jeLiveNeboVyhodnoceny = (zapas.vysledek_domaci !== undefined && zapas.vysledek_hoste !== undefined);

                // 1. STATICKÝ PROUD (Klasický žebříček) - Při Delta synchronizaci je bezpečně přeskočen, data drží baseline
                if (jeVyhodnoceny && !pouzitBaseline) {
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
                        if (jeFotbaloveMS) { bodyZapasu = -1; hracStats[email].celkemBodu += bodyZapasu; }
                        hracStats[email].nenatipovaneVyhodnocene++;
                    }

                    if (zapas.kolo) {
                        const klicKola = String(zapas.kolo).trim();
                        if (hracStats[email].bodyPoKolech[klicKola] === undefined) hracStats[email].bodyPoKolech[klicKola] = 0;
                        hracStats[email].bodyPoKolech[klicKola] += bodyZapasu;
                    }
                }

                // 2. LIVE PROUD (Průběžná live simulace bodů)
                if (jeLiveNeboVyhodnoceny) {
                    const uživatelůvTip = mapaTipu[email] ? mapaTipu[email][matchId] : null;
                    let bodyZapasuLive = 0;

                    if (uživatelůvTip) {
                        bodyZapasuLive = vypocitejBodyZapasu(
                            uživatelůvTip.tip_domaci, uživatelůvTip.tip_hoste,
                            zapas.vysledek_domaci, zapas.vysledek_hoste,
                            uživatelůvTip.postup, zapas.postup, zapas.isPlayoff
                        );
                        hracStats[email].celkemBoduLive += bodyZapasuLive;
                        hracStats[email].natipovaneVyhodnoceneLive++;
                        
                        if (parseInt(uživatelůvTip.tip_domaci) === parseInt(zapas.vysledek_domaci) && 
                            parseInt(uživatelůvTip.tip_hoste) === parseInt(zapas.vysledek_hoste)) {
                            hracStats[email].presneVysledkyCountLive++;
                        }
                    } else {
                        if (jeFotbaloveMS) { bodyZapasuLive = -1; hracStats[email].celkemBoduLive += bodyZapasuLive; }
                        hracStats[email].nenatipovaneVyhodnoceneLive++;
                    }
                }
            });

            if (!pouzitBaseline) {
                const kolaBodove = Object.values(hracStats[email].bodyPoKolech);
                hracStats[email].nejviceBoduVKole = kolaBodove.length > 0 ? Math.max(...kolaBodove) : 0;
            }
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

        const zebricekLivePole = Object.keys(hracStats).map(email => {
            const uid = mapaEmailToUid[email] || "unknown";
            return {
                uid: uid, email: email, nickname: mapaPrezdivek[email] || email.split('@')[0],
                celkemBodu: hracStats[email].celkemBoduLive,
                natipovaneVyhodnocene: hracStats[email].natipovaneVyhodnoceneLive,
                nenatipovaneVyhodnocene: hracStats[email].nenatipovaneVyhodnoceneLive,
                presneVysledkyCount: hracStats[email].presneVysledkyCountLive,
                nejviceBoduVKole: hracStats[email].nejviceBoduVKole,
                vitezMs: hracStats[email].vitezMs, nejStrelec: hracStats[email].nejStrelec
            };
        });
        zebricekLivePole.sort((a, b) => b.celkemBodu - a.celkemBodu);

        let isLiveGlobal = liveMatchIds.length > 0;

        // 📊 ZÁPIS AKTUALIZOVANÉHO ŽEBŘÍČKU DO STRUKTURY
        await db.collection('ligy').doc(LEAGUE_NAME).collection('stav').doc('leaderboard').set({
            zebricek: zebricekPole,
            zebricekLive: zebricekLivePole,
            isLive: isLiveGlobal,
            mapaPrezdivek: mapaPrezdivek,
            textKraliPresnosti: kraliPresnosti.length > 0 ? `${kraliPresnosti.join(', ')} (${maxPresnychGlobal}x)` : '–',
            textRekordmaniKola: rekordmaniKola.length > 0 ? `${rekordmaniKola.join(', ')} (${maxBoduKoloGlobal} b.)` : '–',
            aktualizovano: Timestamp.now()
        });

        // ⚽ CENTRALIZOVANÝ ZÁPIS ROZPISU: Bot zapeče celou novou mapu zápasů (včetně live skóre a procent) do stav/rozpis, odkud sosá frontend RAM
        await db.collection('ligy').doc(LEAGUE_NAME).collection('stav').doc('rozpis').set({
            zapasyMapa: lZapasy,
            aktualizovano: Timestamp.now()
        });

        // 📡 ODPÁLENÍ PULSNÍHO SIGNÁLU: Zvýšíme verze v dokumentu puls, aby se klientské telefony okamžitě reaktivně probraly z letargie
        const pulsRef = db.collection('ligy').doc(LEAGUE_NAME).collection('stav').doc('puls');
        const pulsDoc = await pulsRef.get();
        let novaVerzeRozpisu = 1;
        let novaVerzeZebricku = 1;

        if (pulsDoc.exists) {
            const pData = pulsDoc.data();
            novaVerzeRozpisu = (pData.verzeRozpisu || 0) + 1;
            novaVerzeZebricku = (pData.verzeZebricku || 0) + 1;
        }

        await pulsRef.set({
            verzeRozpisu: novaVerzeRozpisu,
            verzeZebricku: novaVerzeZebricku,
            aktualizovano: Timestamp.now()
        }, { merge: true });
        console.log(`📡 PULS ACTIVE: Verze navýšeny (Rozpis: ${novaVerzeRozpisu}, Žebříček: ${novaVerzeZebricku}). Signál letí do telefonů hráčů!`);

// [FÁZE 1] ZÁPIS NA DISK: Hlavní žebříček turnaje (oficiální i live)
    const leaderboardJsonData = sanitizeForJson({
        zebricek: zebricekPole,
        zebricekLive: zebricekLivePole,
        isLive: isLiveGlobal,
        mapaPrezdivek: mapaPrezdivek,
        textKraliPresnosti: kraliPresnosti.length > 0 ? `${kraliPresnosti.join(', ')} (${maxPresnychGlobal}x)` : '–',
        textRekordmaniKola: rekordmaniKola.length > 0 ? `${rekordmaniKola.join(', ')} (${maxBoduKoloGlobal} b.)` : '–',
        aktualizovano: Timestamp.now()
    });
    fs.writeFileSync(path.join(OUTPUT_DIR, 'leaderboard.json'), JSON.stringify(leaderboardJsonData, null, 2));

    // [FÁZE 1] ZÁPIS NA DISK: Centrální rozpis, výsledky a procenta tendencí
    const rozpisJsonData = sanitizeForJson({
        zapasyMapa: lZapasy,
        aktualizovano: Timestamp.now()
    });
    fs.writeFileSync(path.join(OUTPUT_DIR, 'rozpis.json'), JSON.stringify(rozpisJsonData, null, 2));

    // [FÁZE 1] ZÁPIS NA DISK: Mikro radar puls pro klientské časovače
    const pulsJsonData = sanitizeForJson({
        verzeRozpisu: novaVerzeRozpisu,
        verzeZebricku: novaVerzeZebricku,
        aktualizovano: Timestamp.now()
    });
    fs.writeFileSync(path.join(OUTPUT_DIR, 'puls.json'), JSON.stringify(pulsJsonData, null, 2));

        // 📝 OPTIMALIZOVANÝ ZÁPIS HISTORIE: Generujeme uzavřené historie výhradně pro AKTIVNÍ tipující hráče
        if (InsertHistoryFlag) {
            for (const uid of vsichniHraciUids) {
                const email = mapaUidToEmail[uid];
                if (!email || !hracStats[email]) continue;

                const hracovyTipyVsechny = mapaTipu[email] || {};
                const maNatipovanouBonusMs = hracStats[email].vitezMs !== '–' || hracStats[email].nejStrelec !== '–';

                // 🚨 AUTOMATICKÝ JISTIČ PENĚŽENKY: Pokud účet v této lize vůbec nehraje, zápis bez milosti přeskočíme.
                // Tím ušetříš tisíce prázdných zápisů (Writes) denně a free tier nikdy nepřeteče!
                if (Object.keys(hracovyTipyVsechny).length === 0 && !maNatipovanouBonusMs) {
                    continue;
                }

                const hracovyTipyOdemcene = {};
                Object.keys(hracovyTipyVsechny).forEach(matchId => {
                    const zapas = lZapasy[matchId];
                    if (zapas && zapas.datum) {
                        let dObj = zapas.datum.toDate ? zapas.datum.toDate() : (zapas.datum?.seconds ? new Date(zapas.datum.seconds * 1000) : new Date(zapas.datum));
                        if (dObj <= nyni) {
                            hracovyTipyOdemcene[matchId] = hracovyTipyVsechny[matchId];
                        }
                    }
                });

                await db.collection('ligy').doc(LEAGUE_NAME).collection('stav').doc(`historie_${uid}`).set({
                    mapaTipu: hracovyTipyOdemcene, vytvoreno: Timestamp.now()
                });
            // [FÁZE 1] ZÁPIS NA DISK: Celková uzavřená historie tipů jednoho konkrétního hráče
            const historieJsonData = sanitizeForJson({
                mapaTipu: hracovyTipyOdemcene,
                vytvoreno: Timestamp.now()
            });
            fs.writeFileSync(path.join(OUTPUT_DIR, `historie_hrace_${uid}.json`), JSON.stringify(historieJsonData, null, 2));
            }
            console.log("✨ Historie aktivních tipérů byly úspěšně přegenerovány a uloženy na disk.");
        } else {
            console.log("❄️ Historie hráčů zmrazeny (zápasy jsou stabilní, live skóre nemá vliv na uzavřenou historii).");
        }

        console.log(`✅ Nová agregovaná data s nula-read tendencemi úspěšně zapsána.`);
    } catch (e) {
        console.error("Chyba bota:", e);
    }
}

runBot();