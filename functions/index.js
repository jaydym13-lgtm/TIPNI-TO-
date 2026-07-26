const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler"); // 🪐 Importujeme nativní Google Scheduler plánovač
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

// 📜 CENTRÁLNÍ MATICE PRAVIDEL PRO CLOUD FUNKCE
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

// 👑 FUNKCE 1: Bezpečné vypálení cejchů (Claims) a zápis do Firestore + Registr lig (Balíček 1)
exports.manageUserPermissionsCF = onCall(async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze prověřený admin smí měnit ligy a práva!");
  }

  const { targetUid, isAdminRole, leagues } = request.data;

  try {
    // 1. Vypálení cejchů přímo do šifrovaného JWT tokenu uživatele (Nejprve náchylná externí akce)
    await auth.setCustomUserClaims(targetUid, {
      isAdmin: isAdminRole,
      leagues: leagues
    });

    // 2. Zápis do Firestore pro potřeby UI (Teprve po 100% úspěchu zápisu Claims tokenu)
    await db.collection("users").doc(targetUid).update({
      isAdmin: isAdminRole,
      leagues: leagues
    });

    // 3. Aktualizace centrálního in-monolith registru schválených uživatelů pod konkrétní ligou (Giga-úspora)
    const vsechnyDostupneLigy = ['MS v hokeji', 'MS ve fotbale', 'Tipsport Extraliga', 'Chance Liga'];
    const registrPromises = vsechnyDostupneLigy.map(async (liga) => {
      const registrRef = db.collection("ligy").doc(liga).collection("stav").doc("registrovani");
      if (leagues.includes(liga)) {
        await registrRef.set({ [targetUid]: true }, { merge: true });
      } else {
        await registrRef.set({ [targetUid]: admin.firestore.FieldValue.delete() }, { merge: true });
      }
    });
    await Promise.all(registrPromises);

    return { success: true, message: "Cejchy a ligové přístupy bezpečně aktualizovány!" };
  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});

// 🌪️ FUNKCE 2: Nuclear Purge - Totální vymazání uživatele z celého vesmíru (Sezónní upgrade)
exports.purgeUserAbsoluteCF = onCall(async (request) => {
  if (!request.auth || !request.auth.token.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Tento demoliční spínač smí zmáčknout pouze Super Admin!");
  }

  const { targetUid } = request.data;

  try {
    const batch = db.batch();
    const sezonaId = request.data.sezonaId || "2026_2027";

    // 1. Odstraníme sezónní monolit, online příznak i základní profil
    batch.delete(db.collection("users").doc(targetUid).collection("sezony").doc(sezonaId));
    batch.delete(db.collection("uzivatele_online").doc(targetUid));
    batch.delete(db.collection("users").doc(targetUid));

    await batch.commit();

    // 2. 🚨 Smažeme uživatele natvrdo z Firebase Authentication
    await auth.deleteUser(targetUid);

    return { success: true, message: "Uživatel byl kompletně vymazán ze vesmíru!" };
  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});

// 👑 FUNKCE 3: Loutkovodič - Zpětný zápis do Sezónního monolitu přes čistou stromovou strukturu
exports.saveProxyDataCF = onCall({ cors: true }, async (request) => {
  if (!request.auth || !request.auth.token.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Tento vládní spínač smí mačkat pouze Super Admin!");
  }

  const { targetUid, targetEmail, leagueName, vitez, strelec, tipyMapa } = request.data;
  const sezonaId = request.data.sezonaId || "2026_2027";

  try {
    const userSezonaRef = db.collection("users").doc(targetUid).collection("sezony").doc(sezonaId);
    const ligaKlic = leagueName.replace(/ /g, "_");
    
    // Inicializujeme hluboce strukturovaný objekt pro vnořené mapy
    const updateObj = {
      souteze: {
        [ligaKlic]: {}
      }
    };

    // Ukládáme dlouhodobé bonusy do schovaného šuplíku ligy
    if (vitez !== undefined || strelec !== undefined) {
      updateObj.souteze[ligaKlic].bonusy = {
        userId: targetUid,
        userEmail: targetEmail,
        vitez: vitez ? vitez.trim() : "",
        strelec: strelec ? strelec.trim() : ""
      };
    }

    // Ukládáme jednotlivé opožděné zápasy přes čistý stromový zápis
    if (tipyMapa && Object.keys(tipyMapa).length > 0) {
      updateObj.souteze[ligaKlic].tipy = {};
      for (const matchId of Object.keys(tipyMapa)) {
        const tipData = tipyMapa[matchId];
        updateObj.souteze[ligaKlic].tipy[matchId] = {
          userId: targetUid,
          userEmail: targetEmail,
          matchId: matchId,
          tip_domaci: parseInt(tipData.tip_domaci),
          tip_hoste: parseInt(tipData.tip_hoste),
          postup: tipData.postup || ""
        };
      }
    }

    await userSezonaRef.set(updateObj, { merge: true });
    return { success: true, message: "Data byla přes loutkovodiče úspěšně naočkována do sezóny!" };
  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});

// 👑 FUNKCE 4: Generální rekalulace žebříčku čtoucí ze sezónních šuplíků (Giga-úsporná)
exports.recalculateLeaderboardCF = onCall({ 
  cors: true,
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (request) => {
  console.log("🚀 FORSÁŽ CLOUDU: Aktivuji bleskový přepočet a otevírám trezor s klíči k R2.");
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze prověřený administrátor smí vynutit rekalulaci žebříčku!");
  }

  // 🛡️ ULTRA NEPRŮSTŘELNÝ DEKÓDÉR PARAMETRŮ: Kompletní imunita vůči formátu z frontendu
  const rawData = request.data || {};
  let leagueName = "";
  let sezonaId = "2026_2027";

  if (typeof rawData === 'string') {
    leagueName = rawData;
  } else if (typeof rawData === 'object') {
    leagueName = rawData.leagueName || "";
    sezonaId = rawData.sezonaId || "2026_2027";
  }

  if (!leagueName || typeof leagueName !== 'string') {
    throw new HttpsError("invalid-argument", "Chybí validní textový název soutěže k přepočtení!");
  }

  try {
    const nyni = new Date();
    const ligaKlic = leagueName.replace(/ /g, "_");

    // 1. Stáhneme základní profily a konfiguraci ligy z Firestore + Autonomní rozpis zápasů z Cloudflare R2!
    const [usersSnapshot, leagueDoc] = await Promise.all([
      db.collection("users").get(),
      db.collection("ligy").doc(leagueName).get()
    ]);

    const realLeagueData = leagueDoc.exists ? leagueDoc.data() : null;

    const mapaPrezdivek = {};
    const mapaUidToEmail = {};
    const mapaEmailToUid = {};
    const vsichniHraciUids = [];

    usersSnapshot.forEach(uDoc => {
      const uid = uDoc.id;
      const data = uDoc.data();
      const email = data.email ? data.email.trim().toLowerCase() : '';
      if (email) {
        mapaPrezdivek[email] = data.nickname || email.split('@')[0];
        mapaUidToEmail[uid] = email;
        mapaEmailToUid[email] = uid;
        vsichniHraciUids.push(uid);
      }
    });

    // 🪐 ULTRA-PROFI COLLECTION GROUP: Vyhmátneme všechny herní indexy bezpečně jedním síťovým requestem
    const sezonaSnaps = await db.collectionGroup("sezony").get();

    // 🧠 SENIORNÍ DETEKCE ROZPISU: Namísto ořezaného Firestore načteme kompletní API data z rozpis.json přímo z R2!
    let lZapasy = {};
    try {
      const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
      const r2Reader = new S3Client({
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
        region: "auto",
      });
      const r2Response = await r2Reader.send(new GetObjectCommand({
        Bucket: "tipni-to-data",
        Key: `sezony/${sezonaId}/${ligaKlic}/rozpis.json`
      }));
      const rozpisRaw = await r2Response.Body.transformToString();
      const rozpisParsed = JSON.parse(rozpisRaw);
      lZapasy = rozpisParsed.zapasyMapa || {};
      console.log(`🤖 SEZNAM ZÁPASŮ ÚSPĚŠNĚ STÁHNUT Z R2: Načteno ${Object.keys(lZapasy).length} zápasů.`);
    } catch (r2Err) {
      console.error("⚠️ Nepodařilo se stáhnout rozpis.json z R2, padám zpět na prázdný objekt:", r2Err);
    }

    const hracStats = {};
    Object.keys(mapaPrezdivek).forEach(email => {
      hracStats[email] = {
        celkemBodu: 0, natipovaneVyhodnocene: 0, nenatipovaneVyhodnocene: 0, presneVysledkyCount: 0,
        celkemBoduLive: 0, natipovaneVyhodnoceneLive: 0, nenatipovaneVyhodnoceneLive: 0, presneVysledkyCountLive: 0,
        bodyPoKolech: {}, nejStrelec: '–', vitezMs: '–', nejviceBoduVKole: 0
      };
    });

    // 2. REKONSTRUKCE TIPŮ A BONUSŮ Z NAČTENÝCH SEZÓNNÍCH MONOLITŮ
    sezonaSnaps.forEach(sSnap => {
     // 🧠 RAM JISTIČ: Odfiltrujeme pouze dokumenty, které reálně odpovídají naší aktivní sezóně
      if (sSnap.id !== sezonaId) return;
      const uid = sSnap.ref.parent.parent.id;
      const email = mapaUidToEmail[uid];
      if (!email || !hracStats[email]) return;

      const sData = sSnap.data() || {};
      const souteze = sData.souteze || {};
      const soutezData = souteze[ligaKlic] || {};
      
      const bTip = soutezData.bonusy || {};
      hracStats[email].nejStrelec = bTip.strelec || '–';
      hracStats[email].vitezMs = bTip.vitez || '–';

      const hracovyTipy = soutezData.tipy || {};
      hracStats[email].mapaTipuLocal = hracovyTipy;
    });

    const pravidlaLigi = PRAVIDLA_LIG[leagueName] || PRAVIDLA_LIG["DEFAULT"];

    const vypocitejBodyZapasuLocal = (tipDomaci, tipHoste, realDomaci, realHoste, tipPostup, realPostup, isPlayoff, isTopMatch = false) => {
      const tDom = parseInt(tipDomaci); const tHos = parseInt(tipHoste);
      const rDom = parseInt(realDomaci); const rHos = parseInt(realHoste);
      if (isNaN(tDom) || isNaN(tHos) || isNaN(rDom) || isNaN(rHos)) return 0;

      let ziskaneBody = 0;

      if (tDom === rDom && tHos === rHos) {
        ziskaneBody = pravidlaLigi.presnyVysledek;
        if (isPlayoff && rDom === rHos && realPostup && tipPostup && tipPostup === realPostup) {
          ziskaneBody += pravidlaLigi.playoffBonus;
        }
      } else if (rDom === rHos && tDom === tHos) {
        ziskaneBody = pravidlaLigi.chytraTendence > 0 ? pravidlaLigi.chytraTendence : pravidlaLigi.zakladniTendence;
        if (isPlayoff && realPostup && tipPostup && tipPostup === realPostup) {
          ziskaneBody += pravidlaLigi.playoffBonus;
        }
      } else {
        const tipRozdil = tDom - tHos; const realRozdil = rDom - rHos;
        const spravnaTendence = (tipRozdil > 0 && realRozdil > 0) || (tipRozdil < 0 && realRozdil < 0);
        if (spravnaTendence) {
          const trefilGoly = (tDom === rDom || tHos === rHos);
          const trefilRozdil = (tipRozdil === realRozdil);
          if ((trefilGoly || trefilRozdil) && pravidlaLigi.chytraTendence > 0) {
            ziskaneBody = pravidlaLigi.chytraTendence;
          } else {
            ziskaneBody = pravidlaLigi.zakladniTendence;
          }
        } else if (pravidlaLigi.golUtechy > 0 && (tDom === rDom || tHos === rHos)) {
          ziskaneBody = pravidlaLigi.golUtechy;
        }
      }

      if (isTopMatch && pravidlaLigi.hasTopMatch && ziskaneBody > 0) {
        ziskaneBody *= (pravidlaLigi.topMatchMultiplier || 1);
      }

      return ziskaneBody;
    };

    if (realLeagueData && (realLeagueData.vitez || realLeagueData.strelec)) {
      Object.keys(hracStats).forEach(email => {
        let bonusBody = 0;
        if (pravidlaLigi.bonusVitez > 0 && realLeagueData.vitez && hracStats[email].vitezMs && hracStats[email].vitezMs.trim().toLowerCase() === realLeagueData.vitez.trim().toLowerCase()) {
          bonusBody += pravidlaLigi.bonusVitez;
        }
        if (pravidlaLigi.bonusStrelec > 0 && realLeagueData.strelec && hracStats[email].nejStrelec && hracStats[email].nejStrelec.trim().toLowerCase() === realLeagueData.strelec.trim().toLowerCase()) {
          bonusBody += pravidlaLigi.bonusStrelec;
        }
        hracStats[email].celkemBodu += bonusBody;
        hracStats[email].celkemBoduLive += bonusBody;
      });
    }

    const liveMatchIds = [];

    // 3. GENERUJEME TLAČÍTKA A PROCENTA PRO SPY MODAL UTKÁNÍ
    for (const matchId of Object.keys(lZapasy)) {
      const zapas = lZapasy[matchId];
      let datumObj = zapas.datum?.toDate ? zapas.datum.toDate() : (zapas.datum?.seconds ? new Date(zapas.datum.seconds * 1000) : new Date(zapas.datum));
      
      if (zapas.apiStatus === "IN_PLAY" || zapas.apiStatus === "PAUSED" || (zapas.datum && new Date(zapas.datum.seconds ? zapas.datum.seconds * 1000 : zapas.datum) <= nyni && zapas.apiStatus !== "FINISHED")) {
        liveMatchIds.push(matchId);
      }

      if (datumObj <= nyni || zapas.apiStatus === "FINISHED" || zapas.apiStatus === "IN_PLAY" || zapas.apiStatus === "PAUSED") {
        let domaciWins = 0; let remizy = 0; let hosteWins = 0;
        const tipyProZapasPole = [];

        Object.keys(mapaPrezdivek).forEach(email => {
          const uživatelůvTip = hracStats[email].mapaTipuLocal ? hracStats[email].mapaTipuLocal[matchId] : null;
          if (uživatelůvTip && 
              uživatelůvTip.tip_domaci !== undefined && uživatelůvTip.tip_domaci !== null && uživatelůvTip.tip_domaci !== '' &&
              uživatelůvTip.tip_hoste !== undefined && uživatelůvTip.tip_hoste !== null && uživatelůvTip.tip_hoste !== '') {
            
            const tDom = parseInt(uživatelůvTip.tip_domaci);
            const tHos = parseInt(uživatelůvTip.tip_hoste);
            
            if (!isNaN(tDom) && !isNaN(tHos)) {
              if (tDom > tHos) domaciWins++; 
              else if (tDom === tHos) remizy++; 
              else if (tDom < tHos) hosteWins++;
              
              tipyProZapasPole.push({ userEmail: email, tip_domaci: tDom, tip_hoste: tHos, postup: uživatelůvTip.postup || '' });
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

          zapas.procentaDomaci = pDom;
          zapas.procentaRemiza = pRem;
          zapas.procentaHoste = pHos;
        }

        await db.collection('ligy').doc(leagueName).collection('stav').doc(`tipy_zapasu_${matchId}`).set({
          tipy: tipyProZapasPole, aktualizovano: admin.firestore.Timestamp.now()
        });
      }
    }

    // 🧠 DETEKCE AKTUÁLNÍHO PROBÍHAJÍCÍHO KOLA
    let aktivniKolo = "1";
    const zapasySerazene = Object.values(lZapasy).sort((a, b) => {
      const dA = a.datum?.toDate ? a.datum.toDate() : new Date(a.datum);
      const dB = b.datum?.toDate ? b.datum.toDate() : new Date(b.datum);
      return dA - dB;
    });
    const liveNeboBudouci = zapasySerazene.find(z => z.apiStatus === "IN_PLAY" || z.apiStatus === "PAUSED" || (z.datum && new Date(z.datum.seconds ? z.datum.seconds * 1000 : z.datum) > new Date()));
    if (liveNeboBudouci && liveNeboBudouci.kolo) {
      aktivniKolo = String(liveNeboBudouci.kolo).trim();
    } else if (zapasySerazene.length > 0) {
      aktivniKolo = String(zapasySerazene[zapasySerazene.length - 1].kolo || "1").trim();
    }

    // 🧮 VÝPOČET MAXIMÁLNÍCH MOŽNÝCH BODŮ PRO EFEKTIVITU
    let maxMoznychBoduZapasu = 0;
    Object.values(lZapasy).forEach(zapas => {
      const jeVyhodnoceny = (zapas.vysledek_domaci !== undefined && zapas.vysledek_hoste !== undefined && zapas.apiStatus !== "IN_PLAY" && zapas.apiStatus !== "PAUSED");
      const jeBežícíLive = (zapas.apiStatus === "IN_PLAY" || zapas.apiStatus === "PAUSED");
      if (jeVyhodnoceny || jeBežícíLive) {
        let maxB = pravidlaLigi.presnyVysledek;
        if (zapas.isPlayoff && zapas.vysledek_domaci === zapas.vysledek_hoste) maxB += pravidlaLigi.playoffBonus;
        if (zapas.isTopMatch && pravidlaLigi.hasTopMatch) maxB *= pravidlaLigi.topMatchMultiplier;
        maxMoznychBoduZapasu += maxB;
      }
    });

    // 4. KONEČNÁ MATEMATICKÁ SMYČKA HODNOCENÍ HRÁČE
    Object.keys(hracStats).forEach(email => {
      hracStats[email].bodyPoKolechLive = {};
      hracStats[email].bodyZapasuCelkem = 0;
      hracStats[email].bodyZapasuCelkemLive = 0;

      Object.keys(lZapasy).forEach(matchId => {
        const zapas = lZapasy[matchId];
        const jeVyhodnoceny = (zapas.vysledek_domaci !== undefined && zapas.vysledek_hoste !== undefined && zapas.apiStatus !== "IN_PLAY" && zapas.apiStatus !== "PAUSED");
        const jeBežícíLive = (zapas.apiStatus === "IN_PLAY" || zapas.apiStatus === "PAUSED");
        const jeLiveNeboVyhodnoceny = (zapas.vysledek_domaci !== undefined && zapas.vysledek_hoste !== undefined) || jeBežícíLive;

        const vDomaci = zapas.vysledek_domaci !== undefined && zapas.vysledek_domaci !== null ? zapas.vysledek_domaci : 0;
        const vHoste = zapas.vysledek_hoste !== undefined && zapas.vysledek_hoste !== null ? zapas.vysledek_hoste : 0;

        const uživatelůvTip = hracStats[email].mapaTipuLocal ? hracStats[email].mapaTipuLocal[matchId] : null;

        if (jeVyhodnoceny) {
          let bodyZapasu = 0;
          if (uživatelůvTip) {
            bodyZapasu = vypocitejBodyZapasuLocal(uživatelůvTip.tip_domaci, uživatelůvTip.tip_hoste, zapas.vysledek_domaci, zapas.vysledek_hoste, uživatelůvTip.postup, zapas.postup, zapas.isPlayoff, zapas.isTopMatch);
            hracStats[email].celkemBodu += bodyZapasu; hracStats[email].natipovaneVyhodnocene++;
            if (parseInt(uživatelůvTip.tip_domaci) === parseInt(zapas.vysledek_domaci) && parseInt(uživatelůvTip.tip_hoste) === parseInt(zapas.vysledek_hoste)) hracStats[email].presneVysledkyCount++;
          } else {
            bodyZapasu = pravidlaLigi.penaltyNenatipovano || 0;
            hracStats[email].celkemBodu += bodyZapasu;
            hracStats[email].nenatipovaneVyhodnocene++;
          }
          hracStats[email].bodyZapasuCelkem += bodyZapasu;
          if (zapas.kolo) {
            const klicKola = String(zapas.kolo).trim();
            if (hracStats[email].bodyPoKolech[klicKola] === undefined) hracStats[email].bodyPoKolech[klicKola] = 0;
            hracStats[email].bodyPoKolech[klicKola] += bodyZapasu;
          }
        }

        if (jeLiveNeboVyhodnoceny) {
          let bodyZapasuLive = 0;
          if (uživatelůvTip) {
            bodyZapasuLive = vypocitejBodyZapasuLocal(uživatelůvTip.tip_domaci, uživatelůvTip.tip_hoste, vDomaci, vHoste, uživatelůvTip.postup, zapas.postup, zapas.isPlayoff, zapas.isTopMatch);
            hracStats[email].celkemBoduLive += bodyZapasuLive; hracStats[email].natipovaneVyhodnoceneLive++;
            if (parseInt(uživatelůvTip.tip_domaci) === parseInt(vDomaci) && parseInt(uživatelůvTip.tip_hoste) === parseInt(vHoste)) hracStats[email].presneVysledkyCountLive++;
          } else {
            bodyZapasuLive = pravidlaLigi.penaltyNenatipovano || 0;
            hracStats[email].celkemBoduLive += bodyZapasuLive;
            hracStats[email].nenatipovaneVyhodnoceneLive++;
          }
          hracStats[email].bodyZapasuCelkemLive += bodyZapasuLive;
          if (zapas.kolo) {
            const klicKola = String(zapas.kolo).trim();
            if (hracStats[email].bodyPoKolechLive[klicKola] === undefined) hracStats[email].bodyPoKolechLive[klicKola] = 0;
            hracStats[email].bodyPoKolechLive[klicKola] += bodyZapasuLive;
          }
        }
      });
    });

    // ⚡ VÝPOČET BONUSU ZA CELÉ KOLO (+5b) IN-MEMORY PRO KAŽDÉHO HRÁČE
    if (pravidlaLigi.roundBonus && pravidlaLigi.roundBonus > 0) {
      const kolaZapasyMap = {};
      Object.values(lZapasy).forEach(z => {
        if (z.kolo) {
          const k = String(z.kolo).trim();
          if (!kolaZapasyMap[k]) kolaZapasyMap[k] = [];
          kolaZapasyMap[k].push(z);
        }
      });

      Object.keys(kolaZapasyMap).forEach(klicKola => {
        const zapasyVKole = kolaZapasyMap[klicKola];
        const vsetkoDohrano = zapasyVKole.length > 0 && zapasyVKole.every(z => z.vysledek_domaci !== undefined && z.vysledek_domaci !== null && z.apiStatus !== "IN_PLAY" && z.apiStatus !== "PAUSED");

        if (vsetkoDohrano) {
          Object.keys(hracStats).forEach(email => {
            const uTips = hracStats[email].mapaTipuLocal || {};
            let maVsechnySpravne = true;

            for (const zap of zapasyVKole) {
              const tip = uTips[zap.id || zap.matchId];
              if (!tip) { maVsechnySpravne = false; break; }
              const tipRozdil = parseInt(tip.tip_domaci) - parseInt(tip.tip_hoste);
              const realRozdil = parseInt(zap.vysledek_domaci) - parseInt(zap.vysledek_hoste);
              const spravna = (tipRozdil > 0 && realRozdil > 0) || (tipRozdil < 0 && realRozdil < 0) || (tipRozdil === 0 && realRozdil === 0);
              if (!spravna) { maVsechnySpravne = false; break; }
            }

            if (maVsechnySpravne) {
              hracStats[email].celkemBodu += pravidlaLigi.roundBonus;
              hracStats[email].celkemBoduLive += pravidlaLigi.roundBonus;
              if (hracStats[email].bodyPoKolech[klicKola] !== undefined) hracStats[email].bodyPoKolech[klicKola] += pravidlaLigi.roundBonus;
              if (hracStats[email].bodyPoKolechLive[klicKola] !== undefined) hracStats[email].bodyPoKolechLive[klicKola] += pravidlaLigi.roundBonus;
            }
          });
        }
      });
    }

    Object.keys(hracStats).forEach(email => {
      const kolaBodove = Object.values(hracStats[email].bodyPoKolech);
      hracStats[email].nejviceBoduVKole = kolaBodove.length > 0 ? Math.max(...kolaBodove) : 0;
    });

    // 🏆 GENERATOR STRUKTUROVANÝCH TOP 3 REKORDŮ PRO TURNAJ
    const vsechnyPresne = Object.keys(hracStats).map(email => ({
      nickname: mapaPrezdivek[email] || email.split('@')[0],
      count: hracStats[email].presneVysledkyCount
    })).filter(p => p.count > 0);
    const unikatniPresneBadges = [...new Set(vsechnyPresne.map(p => p.count))].sort((a, b) => b - a).slice(0, 3);
    const top3Presne = unikatniPresneBadges.map(count => {
      const nicks = vsechnyPresne.filter(p => p.count === count).map(p => p.nickname);
      return { count, names: nicks.join(', ') };
    });

    const vsechnyKolaZisky = [];
    Object.keys(hracStats).forEach(email => {
      const nickname = mapaPrezdivek[email] || email.split('@')[0];
      Object.keys(hracStats[email].bodyPoKolech).forEach(klicKola => {
        const pts = hracStats[email].bodyPoKolech[klicKola];
        if (pts > 0) {
          vsechnyKolaZisky.push({ nickname, points: pts, round: klicKola });
        }
      });
    });
    const unikatniKolaZisky = [...new Set(vsechnyKolaZisky.map(p => p.points))].sort((a, b) => b - a).slice(0, 3);
    const top3Kola = unikatniKolaZisky.map(points => {
      const entries = vsechnyKolaZisky.filter(p => p.points === points);
      const formattedArr = entries.map(e => `${e.nickname} (${e.round})`);
      return { points, text: formattedArr.join(', ') };
    });

    // 📊 GENERÁTOR TOP 3 PRO AKTUÁLNÍ PRŮBĚŽNÉ KOLO
    const vsechnyAktualniKolo = Object.keys(hracStats).map(email => {
      const stats = hracStats[email];
      const pts = stats.bodyPoKolechLive?.[aktivniKolo] !== undefined ? stats.bodyPoKolechLive[aktivniKolo] : (stats.bodyPoKolech[aktivniKolo] || 0);
      return {
        nickname: mapaPrezdivek[email] || email.split('@')[0],
        points: pts
      };
    }).filter(p => p.points > 0);
    const unikatniAktualniZisky = [...new Set(vsechnyAktualniKolo.map(p => p.points))].sort((a, b) => b - a).slice(0, 3);
    const top3AktualniKolo = unikatniAktualniZisky.map(points => {
      const nicks = vsechnyAktualniKolo.filter(p => p.points === points).map(p => p.nickname);
      return { points, names: nicks.join(', ') };
    });

    const zebricekPole = Object.keys(hracStats).map(email => ({
      uid: mapaEmailToUid[email] || "unknown", email: email, nickname: mapaPrezdivek[email],
      celkemBodu: hracStats[email].celkemBodu, natipovaneVyhodnocene: hracStats[email].natipovaneVyhodnocene,
      nenatipovaneVyhodnocene: hracStats[email].nenatipovaneVyhodnocene, presneVysledkyCount: hracStats[email].presneVysledkyCount,
      nejviceBoduVKole: hracStats[email].nejviceBoduVKole, vitezMs: hracStats[email].vitezMs, nejStrelec: hracStats[email].nejStrelec,
      bodyKoloAktualni: hracStats[email].bodyPoKolech[aktivniKolo] || 0,
      efektivitaProcento: maxMoznychBoduZapasu > 0 ? (hracStats[email].bodyZapasuCelkem / maxMoznychBoduZapasu) * 100 : 0
    })).sort((a, b) => {
      if (b.celkemBodu !== a.celkemBodu) return b.celkemBodu - a.celkemBodu;
      return b.presneVysledkyCount - a.presneVysledkyCount;
    });

    const zebricekLivePole = Object.keys(hracStats).map(email => ({
      uid: mapaEmailToUid[email] || "unknown", email: email, nickname: mapaPrezdivek[email],
      celkemBodu: hracStats[email].celkemBoduLive, natipovaneVyhodnocene: hracStats[email].natipovaneVyhodnoceneLive,
      nenatipovaneVyhodnocene: hracStats[email].nenatipovaneVyhodnoceneLive, presneVysledkyCount: hracStats[email].presneVysledkyCountLive,
      nejviceBoduVKole: hracStats[email].nejviceBoduVKole, vitezMs: hracStats[email].vitezMs, nejStrelec: hracStats[email].nejStrelec,
      bodyKoloAktualni: hracStats[email].bodyPoKolechLive?.[aktivniKolo] !== undefined ? hracStats[email].bodyPoKolechLive[aktivniKolo] : (hracStats[email].bodyPoKolech[aktivniKolo] || 0),
      efektivitaProcento: maxMoznychBoduZapasu > 0 ? (hracStats[email].bodyZapasuCelkemLive / maxMoznychBoduZapasu) * 100 : 0
    })).sort((a, b) => {
      if (b.celkemBodu !== a.celkemBodu) return b.celkemBodu - a.celkemBodu;
      return b.presneVysledkyCount - a.presneVysledkyCount;
    });

    // Patching the dynamic live round points logic to be fully safe
    zebricekLivePole.forEach(p => {
      const em = p.email;
      if (hracStats[em] && hracStats[em].bodyPoKolechLive) {
         p.bodyKoloAktualni = hracStats[em].bodyPoKolechLive[aktivniKolo] !== undefined ? hracStats[em].bodyPoKolechLive[aktivniKolo] : (hracStats[em].bodyPoKolech[aktivniKolo] || 0);
      }
    });

    const { S3Client: S3ClientCore, PutObjectCommand: PutObjectCommandCore } = require("@aws-sdk/client-s3");
    const r2ClientCore = new S3ClientCore({
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      region: "auto",
    });

    const leaderboardJson = {
      zebricek: zebricekPole,
      zebricekLive: zebricekLivePole,
      isLive: liveMatchIds.length > 0,
      mapaPrezdivek: mapaPrezdivek,
      top3Presne: top3Presne,
      top3Kola: top3Kola,
      top3AktualniKolo: top3AktualniKolo,
      aktivniKoloText: aktivniKolo,
      aktualizovano: new Date().toISOString()
    };

    await r2ClientCore.send(new PutObjectCommandCore({
      Bucket: "tipni-to-data",
      Key: `sezony/${sezonaId}/${ligaKlic}/leaderboard.json`,
      Body: JSON.stringify(leaderboardJson),
      ContentType: "application/json",
      CacheControl: "no-cache, no-store, must-revalidate"
    }));

    // 6. REFRESH UZAVŘENÝCH HISTORIÍ PRO HRÁČE - UKLÁDÁNÍ DO CLOUDFLARE R2
    const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
    const r2Client = new S3Client({
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      region: "auto",
    });

    const r2Promises = [];

    for (const uid of vsichniHraciUids) {
      const email = mapaUidToEmail[uid];
      if (!email || !hracStats[email]) continue;

      const hracovyTipyVsechny = hracStats[email].mapaTipuLocal || {};
      const maNatipovanouBonusMs = hracStats[email].vitezMs !== '–' || hracStats[email].nejStrelec !== '–';

      if (Object.keys(hracovyTipyVsechny).length === 0 && !maNatipovanouBonusMs) {
        continue;
      }

      const hracovyTipyOdemcene = {};

      Object.keys(hracovyTipyVsechny).forEach(matchId => {
        const zapas = lZapasy[matchId];
        if (zapas && zapas.datum) {
          let dObj = new Date(zapas.datum.seconds ? zapas.datum.seconds * 1000 : zapas.datum);
          if (dObj <= nyni || zapas.vysledek_domaci !== undefined) {
            hracovyTipyOdemcene[matchId] = hracovyTipyVsechny[matchId];
          }
        }
      });

      const historyPayload = {
        mapaTipu: hracovyTipyOdemcene,
        vytvoreno: new Date().toISOString()
      };

      const uploadPromise = r2Client.send(new PutObjectCommand({
        Bucket: "tipni-to-data",
        Key: `sezony/${sezonaId}/${ligaKlic}/historie_hrace_${uid}.json`,
        Body: JSON.stringify(historyPayload),
        ContentType: "application/json",
        CacheControl: "no-cache, no-store, must-revalidate"
      }));

      r2Promises.push(uploadPromise);
    }

    if (r2Promises.length > 0) {
      await Promise.all(r2Promises);
    }

    const pulsRef = db.collection('ligy').doc(leagueName).collection('stav').doc('puls');
    const pulsDoc = await pulsRef.get();
    let novaVerzeRozpisu = 1; let novaVerzeZebricku = 1;
    if (pulsDoc.exists) {
      const pData = pulsDoc.data();
      novaVerzeRozpisu = (pData.verzeRozpisu || 0) + 1;
      novaVerzeZebricku = (pData.verzeZebricku || 0) + 1;
    }

    await pulsRef.set({ verzeRozpisu: novaVerzeRozpisu, verzeZebricku: novaVerzeZebricku, aktualizovano: admin.firestore.Timestamp.now() }, { merge: true });
    return { success: true, message: `Generální přepočet ligy ${leagueName} pro sezónu ${sezonaId} dokončen!` };

  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});

// 🔮 FUNKCE 5: Transfér herních dat a sezónních šuplíků mezi dvěma e-maily (Záchrana bodů)
exports.transferUserDataCF = onCall({ cors: true }, async (request) => {
  if (!request.auth || !request.auth.token.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Tento vládní transfér smí spustit pouze Super Admin!");
  }

  const oldEmail = (request.data.oldEmail || "").trim().toLowerCase();
  const newEmail = (request.data.newEmail || "").trim().toLowerCase();
  const sezonaId = request.data.sezonaId || "2025_2026";

  if (!oldEmail || !newEmail) {
    throw new HttpsError("invalid-argument", "Musíš zadat starý i nový e-mail!");
  }

  try {
    // 1. Vyhledáme uživatele v DB podle e-mailů
    const [oldUserQuery, newUserQuery] = await Promise.all([
      db.collection("users").where("email", "==", oldEmail).get(),
      db.collection("users").where("email", "==", newEmail).get()
    ]);

    if (oldUserQuery.empty) {
      throw new HttpsError("not-found", `Původní uživatel s e-mailem ${oldEmail} nebyl v databázi nalezen!`);
    }
    if (newUserQuery.empty) {
      throw new HttpsError("not-found", `Cílový nový uživatel s e-mailem ${newEmail} neexistuje! Musí se nejprve registrovat.`);
    }

    const oldUid = oldUserQuery.docs[0].id;
    const newUid = newUserQuery.docs[0].id;

    // 2. Stáhneme sezónní monolitický šuplík ze starého účtu
    const oldSezonaRef = db.collection("users").doc(oldUid).collection("sezony").doc(sezonaId);
    const oldSezonaSnap = await oldSezonaRef.get();

    if (!oldSezonaSnap.exists) {
      return { success: true, message: "Původní hráč neměl v této sezóně žádné uložené tipy. Převod netřeba." };
    }

    const staráDataSezóny = oldSezonaSnap.data() || {};
    const staréSouteze = staráDataSezóny.souteze || {};

    // 3. Upravíme vnitřní vazby (e-mail a userId) uvnitř všech tipů a bonusů pro nový účet
    const upravenéSouteze = {};
    
    Object.keys(staréSouteze).forEach(ligaKlic => {
      upravenéSouteze[ligaKlic] = { ...staréSouteze[ligaKlic] };

      // Ošetříme zápasové tipy
      if (upravenéSouteze[ligaKlic].tipy) {
        const upravenéTipy = {};
        Object.keys(upravenéSouteze[ligaKlic].tipy).forEach(matchId => {
          upravenéTipy[matchId] = {
            ...upravenéSouteze[ligaKlic].tipy[matchId],
            userId: newUid,
            userEmail: newEmail
          };
        });
        upravenéSouteze[ligaKlic].tipy = upravenéTipy;
      }

      // Ošetříme dlouhodobé bonusy šampionátu
      if (upravenéSouteze[ligaKlic].bonusy) {
        upravenéSouteze[ligaKlic].bonusy = {
          ...upravenéSouteze[ligaKlic].bonusy,
          userId: newUid,
          userEmail: newEmail
        };
      }
    });

    // 4. Atomický zápis na cílový účet a smazání ze starého účtu přes Firestore Batch
    const batch = db.batch();
    const newSezonaRef = db.collection("users").doc(newUid).collection("sezony").doc(sezonaId);

    batch.set(newSezonaRef, { souteze: upravenéSouteze }, { merge: true });
    batch.delete(oldSezonaRef);

    await batch.commit();

    return { 
      success: true, 
      message: `Tipy a body byly úspěšně přelity z ID ${oldUid} na nové ID ${newUid}! Starý šuplík vymazán.` 
    };

  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});

// 🔒 FUNKCE 6: Zabezpečený zápis zápasových tipů s částečnou tolerancí vůči odstartovaným zápasům (Balíček 1)
exports.saveUserTipsCF = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Pro uložení tipů musíš být přihlášen!");
  }

  const uid = request.auth.uid;
  const email = request.auth.token.email || "";
  const { leagueName, tipyMapa } = request.data;
  const sezonaId = request.data.sezonaId || "2025_2026";

  if (!leagueName || !tipyMapa || Object.keys(tipyMapa).length === 0) {
    throw new HttpsError("invalid-argument", "Chybí název soutěže nebo mapa tvých tipů!");
  }

  try {
    const ligaKlic = leagueName.replace(/ /g, "_");
    const userSezonaRef = db.collection("users").doc(uid).collection("sezony").doc(sezonaId);

    const updateObj = { souteze: { [ligaKlic]: { tipy: {} } } };
    const nyni = new Date();
    const rejected = [];
    let validniTipyCount = 0;

    for (const matchId of Object.keys(tipyMapa)) {
      const tipData = tipyMapa[matchId];
      const matchDoc = await db.collection("ligy").doc(leagueName).collection("zapasy").doc(matchId).get();
      
      if (!matchDoc.exists) {
        rejected.push(matchId);
        continue;
      }

      const matchData = matchDoc.data();
      const datumZapasu = matchData.datum.toDate();

      // 🚨 SERVEROVÁ TOLERANTNÍ GILOTINA: Pokud zápas už začal, neshodíme celou funkci, pouze zápas odkloníme do pole zamítnutých
      if (nyni >= datumZapasu) {
        rejected.push(matchId);
        continue;
      }

      updateObj.souteze[ligaKlic].tipy[matchId] = {
        userId: uid, userEmail: email, matchId: matchId,
        tip_domaci: parseInt(tipData.tip_domaci), tip_hoste: parseInt(tipData.tip_hoste), postup: tipData.postup || ""
      };
      validniTipyCount++;
    }

    if (validniTipyCount > 0) {
      await userSezonaRef.set(updateObj, { merge: true });
    }

    return { 
      success: true, 
      message: `Uloženo ${validniTipyCount} tipů. Odmítnuto ${rejected.length} zápasů z důvodu zahájení hry.`, 
      rejected: rejected 
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error.message);
  }
});

// 🔒 FUNKCE 7: Zabezpečený zápis dlouhodobých bonusů s kontrolou startu turnaje (pole zacatek)
exports.saveBonusTipsCF = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Pro uložení bonusů musíš být přihlášen!");
  }

  const uid = request.auth.uid;
  const email = request.auth.token.email || "";
  const { leagueName, vitez, strelec } = request.data;
  const sezonaId = request.data.sezonaId || "2025_2026";

  if (!leagueName) throw new HttpsError("invalid-argument", "Chybí název soutěže!");

  try {
    const ligaKlic = leagueName.replace(/ /g, "_");
    const ligaDoc = await db.collection("ligy").doc(leagueName).get();
    const nyni = new Date();

    // 🚨 REÁLNÁ KONTROLA ČASOVÉHO ZÁMKU TURNAJE
    if (ligaDoc.exists) {
      const ligaData = ligaDoc.data();
      if (ligaData.zacatek) {
        const zacatekTurnaje = ligaData.zacatek.toDate();
        if (nyni >= zacatekTurnaje) {
          throw new HttpsError("failed-precondition", "Smůla! Šampionát už odstartoval. Dlouhodobé tipy jsou uzamčeny!");
        }
      }
    }

    const updateObj = {
      souteze: {
        [ligaKlic]: {
          bonusy: {
            userId: uid, userEmail: email,
            vitez: vitez ? vitez.trim() : "", strelec: strelec ? strelec.trim() : ""
          }
        }
      }
    };

    await db.collection("users").doc(uid).collection("sezony").doc(sezonaId).set(updateObj, { merge: true });
    return { success: true, message: "Bonusy uloženy!" };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error.message);
  }
});

// 📡 AUTOMATICKÝ AUTONOMNÍ DISPEČER HERNÍHO RADARU (Čte pouze 1 radarový dokument – spotřeba 0 Kč!)
exports.chronosWakeUpBotScheduled = onSchedule({
  schedule: "every 3 minutes", // 🔥 Zrychleno na 3 minuty pro bleskový Battle Mode bez výpadků!
  timeZone: "Europe/Prague",
  memory: "256MiB"             // Vypustili jsme AWS S3 SDK. Obrovská úspora RAM a rychlosti studených startů!
}, async (event) => {
  console.log("⏱️ CHRONOS RADAR: Startuji kontrolu centralizovaného majáku...");
  const LEAGUE_NAME = "MS ve fotbale";
  const nyni = new Date();

  try {
    // 🛡️ GIGA-OPTIMALIZACE: Čteme pouze jeden dokument namísto skenování 104 zápasů
    const radarSnap = await db.collection("ligy").doc(LEAGUE_NAME).collection("stav").doc("radar").get();

    if (!radarSnap.exists) {
      console.log("💤 RADAR BLIND: Maják v databázi neexistuje. Nechávám bota spát.");
      return null;
    }

    const radarData = radarSnap.data();
    let odpalitProbouzeciPing = false;

    // Podmínka 1: Bot v RAM paměti detekoval běžící live zápas -> držíme Render naživu
    if (radarData.beziLive === true) {
      console.log("🔴 LIVE RADAR: Na stadionu se aktuálně hraje živé utkání.");
      odpalitProbouzeciPing = true;
    } 
    // Podmínka 2: Zápas neběží, ale zkontrolujeme čas příštího výkopu z majáku
    else if (radarData.pristiZapasUtc) {
      const startZapasu = new Date(radarData.pristiZapasUtc);
      const rozdilMinut = (startZapasu - nyni) / (1000 * 60);

      console.log(`⏱️ CHRONOS DIAGNOSTIKA: Nejbližší zápas startuje za ${Math.round(rozdilMinut)} minut.`);

      // Pokud se blíží výkop nebo zápas právě probíhá, držíme okno otevřené (35 min před až 140 min po výkopu)
              if (rozdilMinut >= -140 && rozdilMinut <= 35) {
                odpalitProbouzeciPing = true;
              }
    }

    // 🚀 EXEKUCE: Pokud je splněn jistič, pošleme probouzecí HTTP dotaz na Render
    if (odpalitProbouzeciPing) {
      console.log("🚀 CHRONOS PING: Posílám probouzecí signál na Render...");
      const res = await fetch("https://tipni-to-bot.onrender.com");
      console.log(`📡 CHRONOS SÍŤ: Signál úspěšně doručen. Render status: ${res.status}`);
    } else {
      console.log("💤 CHRONOS SLEEP: Na stadionu se nic neděje. Nechávám bota spát a šetřím limity.");
    }

  } catch (err) {
    console.error("❌ CHRONOS CRITICAL: Selhala kontrola radarového majáku:", err);
  }
  return null;
});