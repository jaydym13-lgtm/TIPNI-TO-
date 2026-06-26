// =========================================================================
// 🤖 TIPNI TO! - ULTRA-FAST EDGE BACKGROUND API & LEADERBOARD WORKER (index.js)
// =========================================================================

const LEAGUE_NAME = "MS ve fotbale"; // Název ligy ve Firestore
const LEAGUE_ID = "WC";              // Kód ligy ve fotbalovém API (World Cup)
const SEZONA_ID = "2025_2026";
const LIGA_KLIC = LEAGUE_NAME.replace(/ /g, "_");

// 🇨🇿 KOMPLETNÍ OSVĚDČENÝ SLOVNÍK TÝMŮ VČETNĚ USA A OSTATNÍCH
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

// 🧮 POSVÁTNÁ MATEMATIKA BODŮ
const vypocitejBodyZapasu = (tipDomaci, tipHoste, realDomaci, realHoste, tipPostup, realPostup, isPlayoff) => {
    const tDom = parseInt(tipDomaci); const tHos = parseInt(tipHoste);
    const rDom = parseInt(realDomaci); const rHos = parseInt(realHoste);
    if (isNaN(tDom) || isNaN(tHos)) return 0;

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

// 🔐 GOOGLE OAUTH2 GENERÁTOR
async function getGoogleAuthToken(serviceAccountJson) {
    const sa = JSON.parse(serviceAccountJson);
    const pemContents = sa.private_key
        .replace("-----BEGIN PRIVATE KEY-----", "")
        .replace("-----END PRIVATE KEY-----", "")
        .replace(/[^A-Za-z0-9+/=]/g, "");

    const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
        "pkcs8", binaryKey,
        { name: "RSASSA-PKCS1-v1_5", hash: { name: "SHA-256" } },
        false, ["sign"]
    );

    const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" })).replace(/=+$/, "");
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 3600;
    
    const payload = btoa(JSON.stringify({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/datastore",
        aud: "https://www.googleapis.com/oauth2/v4/token",
        exp: exp, iat: iat
    })).replace(/=+$/, "");

    const textEncoder = new TextEncoder();
    const signatureBuffer = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5", cryptoKey,
        textEncoder.encode(`${header}.${payload}`)
    );
    const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer))).replace(/=+$/, "");

    const tokenRes = await fetch("https://www.googleapis.com/oauth2/v4/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${header}.${payload}.${signature}`
    });
    const tokenData = await tokenRes.json();
    return tokenData.access_token;
}

// 🏢 POMOCNÝ REST PARSER PRO FIRESTORE
function parseFirestoreFields(fields) {
    const res = {};
    if (!fields) return res;
    for (const key of Object.keys(fields)) {
        const valObj = fields[key];
        if ('stringValue' in valObj) res[key] = valObj.stringValue;
        else if ('integerValue' in valObj) res[key] = parseInt(valObj.integerValue);
        else if ('booleanValue' in valObj) res[key] = valObj.booleanValue;
        else if ('mapValue' in valObj) res[key] = parseFirestoreFields(valObj.mapValue.fields);
        else if ('arrayValue' in valObj) {
            const arr = valObj.arrayValue.values || [];
            res[key] = arr.map(v => v.stringValue || parseFirestoreFields(v.mapValue?.fields));
        }
    }
    return res;
}

export default {
    async scheduled(event, env, ctx) {
        ctx.waitUntil(runEngine(env, ctx));
    }
};

async function runEngine(env, ctx) {
    const nyni = new Date();
    const timestampNow = nyni.toISOString();
    console.log(`⏱️ Worker startuje cyklus pro ligu: ${LEAGUE_NAME}`);

    // --- 📡 1. SBĚR DAT Z EXTERNNÍHO SPORT-API ---
    console.log("📡 Volám sportovní API pro čerstvá skóre...");
    const apiResponse = await fetch(`https://api.football-data.org/v4/competitions/${LEAGUE_ID}/matches`, {
        headers: { "X-Auth-Token": env.FOOTBALL_DATA_API_KEY }
    });
    if (!apiResponse.ok) throw new Error(`API chyba: ${apiResponse.status}`);
    const apiData = await apiResponse.json();
    const matches = apiData.matches || [];

    // --- 🔐 2. AUTENTIKACE DO FIRESTORE ---
    const fbToken = await getGoogleAuthToken(env.FIREBASE_SERVICE_ACCOUNT);
    const fbBaseUrl = `https://firestore.googleapis.com/v1/projects/tipni-to/databases/(default)/documents`;
    const fbHeaders = { "Authorization": `Bearer ${fbToken}`, "Content-Type": "application/json" };

    // --- 👥 3.STAHNUTÍ VŠECH UŽIVATELŮ (PŘESNĚ JAKO STARÝ BOT.MJS) ---
    const usersSnapshot = [];
    const sezonaSnaps = {};

    const usersRes = await fetch(`${fbBaseUrl}/users`, { headers: fbHeaders });
    if (usersRes.ok) {
        const usersData = await usersRes.json();
        const docs = usersData.documents || [];
        for (const docObj of docs) {
            const uid = docObj.name.split('/').pop();
            const fields = parseFirestoreFields(docObj.fields);
            
            // Filtrujeme superadmina z výpočtů
            if (fields.isSuperAdmin === true) continue;

            usersSnapshot.push({ id: uid, data: fields });

            // Stáhneme sezónu pro každého nalezeného uživatele
            const sRes = await fetch(`${fbBaseUrl}/users/${uid}/sezony/${SEZONA_ID}`, { headers: fbHeaders });
            if (sRes.ok) {
                const sDoc = await sRes.json();
                sezonaSnaps[uid] = parseFirestoreFields(sDoc.fields);
            }
        }
    }

    const ligaDocRes = await fetch(`${fbBaseUrl}/ligy/${encodeURIComponent(LEAGUE_NAME)}`, { headers: fbHeaders });
    const realLeagueData = ligaDocRes.ok ? parseFirestoreFields((await ligaDocRes.json()).fields) : null;

    // --- 👥 4. PŘÍPRAVA STRUKTUR PRO HRÁČE ---
    const mapaPrezdivek = {}; const hracStats = {};
    usersSnapshot.forEach(u => {
        const email = u.data.email?.trim().toLowerCase();
        if (email) {
            const nick = u.data.nickname || email.split('@')[0];
            mapaPrezdivek[email] = nick;
            hracStats[email] = {
                uid: u.id, nickname: nick, celkemBodu: 0, natipovaneVyhodnocene: 0, nenatipovaneVyhodnocene: 0, presneVysledkyCount: 0,
                celkemBoduLive: 0, natipovaneVyhodnoceneLive: 0, nenatipovaneVyhodnoceneLive: 0, presneVysledkyCountLive: 0,
                bodyPoKolech: {}, nejStrelec: '–', vitezMs: '–', nejviceBoduVKole: 0, mapaTipuLocal: {}
            };

            const sData = sezonaSnaps[u.id] || {};
            const souteze = sData.souteze || {};
            const soutezData = souteze[LIGA_KLIC] || {};
            const bTip = soutezData.bonusy || {};
            
            hracStats[email].nejStrelec = bTip.strelec || '–';
            hracStats[email].vitezMs = bTip.vitez || '–';
            hracStats[email].mapaTipuLocal = soutezData.tipy || {};
        }
    });

    // Zapečení dlouhodobých bonusů
    if (realLeagueData && (realLeagueData.vitez || realLeagueData.strelec)) {
        Object.keys(hracStats).forEach(email => {
            let bonusBody = (LEAGUE_NAME === "MS ve fotbale") ? 8 : 10;
            if (realLeagueData.vitez && hracStats[email].vitezMs && hracStats[email].vitezMs.toLowerCase() === realLeagueData.vitez.toLowerCase()) {
                hracStats[email].celkemBodu += bonusBody; hracStats[email].celkemBoduLive += bonusBody;
            }
            if (realLeagueData.strelec && hracStats[email].nejStrelec && hracStats[email].nejStrelec.toLowerCase() === realLeagueData.strelec.toLowerCase()) {
                hracStats[email].celkemBodu += bonusBody; hracStats[email].celkemBoduLive += bonusBody;
            }
        });
    }

    // --- 🧮 5. AGREGACE ZÁPASŮ, VÝPOČET PROCENT A OKA ---
    const zapasyMapa = {};
    const liveMatchIds = [];

    for (const match of matches) {
        const apiId = String(match.id);
        const status = match.status;
        const rawDomaci = match.homeTeam?.name || "Neznámý";
        const rawHoste = match.awayTeam?.name || "Neznámý";
        const domaci = slovnikTymu[rawDomaci] || rawDomaci;
        const hoste = slovnikTymu[rawHoste] || rawHoste;
        const isPlayoff = match.stage !== "GROUP_STAGE";
        const kolo = match.matchday ? `Kolo ${match.matchday}` : (match.stage ? match.stage.replace(/_/g, ' ') : "Šampionát");

        let golyDomaci = undefined; let golyHoste = undefined; let postupVal = "";
        const jeZapasAktivni = status === "FINISHED" || status === "IN_PLAY" || status === "PAUSED";
        
        if (jeZapasAktivni && match.score?.fullTime?.home !== null) {
            if (isPlayoff && match.score.regularTime?.home !== null) {
                golyDomaci = parseInt(match.score.regularTime.home);
                golyHoste = parseInt(match.score.regularTime.away);
            } else {
                golyDomaci = parseInt(match.score.fullTime.home);
                golyHoste = parseInt(match.score.fullTime.away);
            }
            if (isPlayoff) {
                if (match.score.winner === "HOME_TEAM") postupVal = "domaci";
                if (match.score.winner === "AWAY_TEAM") postupVal = "hoste";
            }
        }

        const matchStarted = new Date(match.utcDate) <= nyni;
        if (status === "IN_PLAY" || status === "PAUSED" || (matchStarted && status !== "FINISHED")) {
            liveMatchIds.push(apiId);
        }

        zapasyMapa[apiId] = {
            domaci, hoste, datum: match.utcDate, isPlayoff, kolo,
            vysledek_domaci: golyDomaci, vysledek_hoste: golyHoste,
            apiStatus: status, postup: postupVal,
            procentaDomaci: 0, procentaRemiza: 0, procentaHoste: 0
        };

        let domaciWins = 0; let remizy = 0; let hosteWins = 0;
        const tipyProZapasPole = [];

        Object.keys(hracStats).forEach(email => {
            const uTip = hracStats[email].mapaTipuLocal[apiId];
            if (uTip && uTip.tip_domaci !== undefined && uTip.tip_hoste !== undefined && uTip.tip_domaci !== '' && uTip.tip_hoste !== '') {
                const tDom = parseInt(uTip.tip_domaci);
                const tHos = parseInt(uTip.tip_hoste);
                if (!isNaN(tDom) && !isNaN(tHos)) {
                    if (tDom > tHos) domaciWins++;
                    else if (tDom === tHos) remizy++;
                    else if (tDom < tHos) hosteWins++;

                    if (matchStarted || jeZapasAktivni) {
                        tipyProZapasPole.push({
                            userEmail: email,
                            nickname: hracStats[email].nickname,
                            tip_domaci: tDom,
                            tip_hoste: tHos,
                            postup: uTip.postup || ''
                        });
                    }
                }
            }
        });

        let celkemTipu = domaciWins + remizy + hosteWins;
        if (celkemTipu > 0) {
            let pDom = Math.round((domaciWins / celkemTipu) * 100);
            let pRem = Math.round((remizy / celkemTipu) * 100);
            let pHos = Math.round((hosteWins / celkemTipu) * 100);
            let soucet = pDom + pRem + pHos;
            if (soucet !== 100) {
                let rozdil = 100 - soucet;
                if (domaciWins >= remizy && domaciWins >= hosteWins) pDom += rozdil;
                else if (remizy >= domaciWins && remizy >= hosteWins) pRem += rozdil;
                else pHos += rozdil;
            }
            zapasyMapa[apiId].procentaDomaci = pDom;
            zapasyMapa[apiId].procentaRemiza = pRem;
            zapasyMapa[apiId].procentaHoste = pHos;
        }

        // 💾 SOUBORY PRO OKO (Zapisujeme hned, bez ohledu na stáří zápasu)
        const filename = `spy_zapas_${apiId}.json`;
        const spyJson = { tipy: tipyProZapasPole, aktualizovano: timestampNow };
        ctx.waitUntil(env.DATA_BUCKET.put(filename, JSON.stringify(spyJson, null, 2), {
            customMetadata: { "Content-Type": "application/json" }
        }));
    }

    // --- 🏆 6. PROPOČÍTÁNÍ STRUKTURY BODŮ ---
    Object.keys(hracStats).forEach(email => {
        Object.keys(zapasyMapa).forEach(matchId => {
            const zapas = zapasyMapa[matchId];
            const jeVyhodnoceny = (zapas.vysledek_domaci !== undefined && zapas.apiStatus !== "IN_PLAY" && zapas.apiStatus !== "PAUSED");
            const jeLiveNeboVyhodnoceny = (zapas.vysledek_domaci !== undefined);
            const uTip = hracStats[email].mapaTipuLocal[matchId];

            if (jeVyhodnoceny) {
                let body = 0;
                if (uTip) {
                    body = vypocitejBodyZapasu(uTip.tip_domaci, uTip.tip_hoste, zapas.vysledek_domaci, zapas.vysledek_hoste, uTip.postup, zapas.postup, zapas.isPlayoff);
                    hracStats[email].celkemBodu += body; hracStats[email].natipovaneVyhodnocene++;
                    if (parseInt(uTip.tip_domaci) === zapas.vysledek_domaci && parseInt(uTip.tip_hoste) === zapas.vysledek_hoste) hracStats[email].presneVysledkyCount++;
                } else {
                    if (LEAGUE_NAME === "MS ve fotbale") { body = -1; hracStats[email].celkemBodu += body; }
                    hracStats[email].nenatipovaneVyhodnocene++;
                }
                if (zapas.kolo) {
                    const klic = String(zapas.kolo).trim();
                    hracStats[email].bodyPoKolech[klic] = (hracStats[email].bodyPoKolech[klic] || 0) + body;
                }
            }

            if (jeLiveNeboVyhodnoceny) {
                if (uTip) {
                    const bodyL = vypocitejBodyZapasu(uTip.tip_domaci, uTip.tip_hoste, zapas.vysledek_domaci || 0, zapas.vysledek_hoste || 0, uTip.postup, zapas.postup, zapas.isPlayoff);
                    hracStats[email].celkemBoduLive += bodyL; hracStats[email].natipovaneVyhodnoceneLive++;
                } else {
                    if (LEAGUE_NAME === "MS ve fotbale") hracStats[email].celkemBoduLive += -1;
                    hracStats[email].nenatipovaneVyhodnoceneLive++;
                }
            }
        });
        const kolaBodove = Object.values(hracStats[email].bodyPoKolech);
        hracStats[email].nejviceBoduVKole = kolaBodove.length > 0 ? Math.max(...kolaBodove) : 0;
    });

    let maxPresnychGlobal = 0; let maxBoduKoloGlobal = 0;
    Object.keys(hracStats).forEach(em => {
        if (hracStats[em].presneVysledkyCount > maxPresnychGlobal) maxPresnychGlobal = hracStats[em].presneVysledkyCount;
        if (hracStats[em].nejviceBoduVKole > maxBoduKoloGlobal) maxBoduKoloGlobal = hracStats[em].nejviceBoduVKole;
    });
    let kraliPresnosti = []; let rekordmaniKola = [];
    Object.keys(hracStats).forEach(em => {
        if (hracStats[em].presneVysledkyCount === maxPresnychGlobal && maxPresnychGlobal > 0) kraliPresnosti.push(hracStats[em].nickname);
        if (hracStats[em].nejviceBoduVKole === maxBoduKoloGlobal && maxBoduKoloGlobal > 0) rekordmaniKola.push(hracStats[em].nickname);
    });

    const zebricekPole = Object.keys(hracStats).map(em => ({
        uid: hracStats[em].uid, email: em, nickname: hracStats[em].nickname, celkemBodu: hracStats[em].celkemBodu,
        natipovaneVyhodnocene: hracStats[em].natipovaneVyhodnocene, nenatipovaneVyhodnocene: hracStats[em].nenatipovaneVyhodnocene,
        presneVysledkyCount: hracStats[em].presneVysledkyCount, nejviceBoduVKole: hracStats[em].nejviceBoduVKole,
        vitezMs: hracStats[em].vitezMs, nejStrelec: hracStats[em].nejStrelec
    })).sort((a, b) => b.celkemBodu - a.celkemBodu);

    const zebricekLivePole = Object.keys(hracStats).map(em => ({
        uid: hracStats[em].uid, email: em, nickname: hracStats[em].nickname, celkemBodu: hracStats[em].celkemBoduLive,
        natipovaneVyhodnocene: hracStats[em].natipovaneVyhodnoceneLive, nenatipovaneVyhodnocene: hracStats[em].nenatipovaneVyhodnoceneLive,
        presneVysledkyCount: hracStats[em].presneVysledkyCountLive, nejviceBoduVKole: hracStats[em].nejviceBoduVKole,
        vitezMs: hracStats[em].vitezMs, nejStrelec: hracStats[em].nejStrelec
    })).sort((a, b) => b.celkemBodu - a.celkemBodu);

    // --- 💾 7. FINÁLNÍ ZÁPIS AGREGÁTŮ DO R2 ---
    console.log("💾 Zapisuji hotové agregáty do R2 úložiště...");

    const leaderboardJson = {
        zebricek: zebricekPole, zebricekLive: zebricekLivePole, isLive: liveMatchIds.length > 0, mapaPrezdivek: mapaPrezdivek,
        textKraliPresnosti: kraliPresnosti.length > 0 ? `${kraliPresnosti.join(', ')} (${maxPresnychGlobal}x)` : '–',
        textRekordmaniKola: rekordmaniKola.length > 0 ? `${rekordmaniKola.join(', ')} (${maxBoduKoloGlobal} b.)` : '–',
        aktualizovano: timestampNow
    };
    await env.DATA_BUCKET.put("leaderboard.json", JSON.stringify(leaderboardJson, null, 2), {
        customMetadata: { "Content-Type": "application/json" }
    });

    const rozpisJson = { zapasyMapa: zapasyMapa, aktualizovano: timestampNow };
    await env.DATA_BUCKET.put("rozpis.json", JSON.stringify(rozpisJson, null, 2), {
        customMetadata: { "Content-Type": "application/json" }
    });

    // Zapečení osobních historií hráčů do R2
    for (const em of Object.keys(hracStats)) {
        const hracovyTipyVsechny = hracStats[em].mapaTipuLocal || {};
        const hracovyTipyOdemcene = {};

        Object.keys(hracovyTipyVsechny).forEach(mId => {
            const zapas = zapasyMapa[mId];
            if (zapas && new Date(zapas.datum) <= nyni) {
                hracovyTipyOdemcene[mId] = hracovyTipyVsechny[mId];
            }
        });

        const historieJson = { mapaTipu: hracovyTipyOdemcene, vytvoreno: timestampNow };
        await env.DATA_BUCKET.put(`historie_hrace_${hracStats[em].uid}.json`, JSON.stringify(historieJson, null, 2));
    }

    console.log("✅ Celý cyklus úspěšně a bleskově dokončen na Edge serveru!");
}