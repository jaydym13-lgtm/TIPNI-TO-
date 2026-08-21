const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

initializeApp();
const db = getFirestore();
const auth = getAuth();

// Kompatibilita pro stávající FieldValue a Timestamp volání
const admin = {
  firestore: {
    FieldValue,
    Timestamp
  }
};

// ⚙️ CENTRÁLNÍ KONSTANTY BACKENDU
const DEFAULT_SEASON_ID = "2026_2027";
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "tipni-to-data";
const RENDER_BOT_URL = process.env.RENDER_BOT_URL || "https://tipni-to-bot.onrender.com";

// 📜 CENTRÁLNÍ MATICE PRAVIDEL PRO CLOUD FUNKCE (KOMPLETNÍ)
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
    "Premier League": {
        presnyVysledek: 6,
        chytraTendence: 3,
        zakladniTendence: 2,
        golUtechy: 1,
        playoffBonus: 0,
        penaltyNenatipovano: -1,
        bonusVitez: 10,
        bonusStrelec: 10,
        hasTopMatch: true,
        topMatchMultiplier: 2,
        roundBonus: 0
    },
    "MS v hokeji": {
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
    },
    "Tipsport Extraliga": {
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

// 👑 FUNKCE 1: Správa oprávnění uživatelů
exports.manageUserPermissionsCF = onCall(async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze prověřený admin smí měnit ligy a práva!");
  }

  const { targetUid, isAdminRole, leagues } = request.data;

  try {
    await auth.setCustomUserClaims(targetUid, {
      isAdmin: isAdminRole,
      leagues: leagues
    });

    await db.collection("users").doc(targetUid).update({
      isAdmin: isAdminRole,
      leagues: leagues
    });

    const vsechnyDostupneLigy = ['Chance Liga', 'Premier League', 'MS ve fotbale', 'Tipsport Extraliga', 'MS v hokeji'];
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

// 🌪️ FUNKCE 2: Nuclear Purge
exports.purgeUserAbsoluteCF = onCall(async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze prověřený admin smí ukládat proxy data přes loutkovodiče!");
  }

  const { targetUid } = request.data;

  try {
    const batch = db.batch();
    const sezonaId = request.data.sezonaId || "2026_2027";

    batch.delete(db.collection("users").doc(targetUid).collection("sezony").doc(sezonaId));
    batch.delete(db.collection("uzivatele_online").doc(targetUid));
    batch.delete(db.collection("users").doc(targetUid));

    await batch.commit();
    await auth.deleteUser(targetUid);

    return { success: true, message: "Uživatel byl kompletně vymazán ze vesmíru!" };
  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});

// 👑 FUNKCE 3: Loutkovodič
exports.saveProxyDataCF = onCall({ cors: true }, async (request) => {
  if (!request.auth || !request.auth.token.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Tento vládní spínač smí mačkat pouze Super Admin!");
  }

  const { targetUid, targetEmail, leagueName, vitez, strelec, tipyMapa } = request.data;
  const sezonaId = request.data.sezonaId || "2026_2027";

  try {
    const userSezonaRef = db.collection("users").doc(targetUid).collection("sezony").doc(sezonaId);
    const ligaKlic = leagueName.replace(/ /g, "_");
    
    const updateObj = {
      souteze: {
        [ligaKlic]: {}
      }
    };

    if (vitez !== undefined || strelec !== undefined) {
      updateObj.souteze[ligaKlic].bonusy = {
        userId: targetUid,
        userEmail: targetEmail,
        vitez: vitez ? vitez.trim() : "",
        strelec: strelec ? strelec.trim() : ""
      };
    }

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

// 👑 FUNKCE 4: Generální rekalulace žebříčku
exports.recalculateLeaderboardCF = onCall({ 
  cors: true,
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (request) => {
  console.log("🚀 FORSÁŽ CLOUDU: Aktivuji bleskový přepočet a otevírám trezor s klíči k R2.");
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze prověřený administrátor smí vynutit rekalulaci žebříčku!");
  }

  const rawData = request.data || {};
  let leagueName = "";
  let sezonaId = DEFAULT_SEASON_ID;

  if (typeof rawData === 'string') {
    leagueName = rawData;
  } else if (typeof rawData === 'object') {
    leagueName = rawData.leagueName || "";
    sezonaId = rawData.sezonaId || DEFAULT_SEASON_ID;
  }

  if (!leagueName || typeof leagueName !== 'string') {
    throw new HttpsError("invalid-argument", "Chybí validní textový název soutěže k přepočtení!");
  }

  try {
    const nyni = new Date();
    const ligaKlic = leagueName.replace(/ /g, "_");

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
        const maLigu = data.isSuperAdmin === true || (data.leagues && Array.isArray(data.leagues) && data.leagues.includes(leagueName));
        if (maLigu) {
          mapaPrezdivek[email] = data.nickname || email.split('@')[0];
          mapaUidToEmail[uid] = email;
          mapaEmailToUid[email] = uid;
          vsichniHraciUids.push(uid);
        }
      }
    });

    // 🎯 SENIOR IZOLACE: Načteme POUZE konkrétní šuplík požadované sezóny pro každého hráče
    const sezonaPromises = vsichniHraciUids.map(uid => 
      db.collection("users").doc(uid).collection("sezony").doc(sezonaId).get()
    );
    const sezonaSnaps = await Promise.all(sezonaPromises);

    let lZapasy = {};
    try {
      const zapasySnap = await db.collection("ligy").doc(leagueName).collection("sezony").doc(sezonaId).collection("zapasy").get();
      zapasySnap.forEach(zDoc => {
        lZapasy[zDoc.id] = { id: zDoc.id, ...zDoc.data() };
      });
      console.log(`🤖 SEZNAM ZÁPASŮ NAČTEN PŘÍMO Z FIRESTORE: Načteno ${Object.keys(lZapasy).length} zápasů.`);
    } catch (fsErr) {
      console.error("⚠️ Nepodařilo se načíst zápasy z Firestore:", fsErr);
    }

    const hracStats = {};
    Object.keys(mapaPrezdivek).forEach(email => {
      hracStats[email] = {
        celkemBodu: 0, natipovaneVyhodnocene: 0, nenatipovaneVyhodnocene: 0, presneVysledkyCount: 0,
        celkemBoduLive: 0, natipovaneVyhodnoceneLive: 0, nenatipovaneVyhodnoceneLive: 0, presneVysledkyCountLive: 0,
        bodyPoKolech: {}, nejStrelec: '–', vitezMs: '–', nejviceBoduVKole: 0
      };
    });

    sezonaSnaps.forEach(sSnap => {
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

    for (const matchId of Object.keys(lZapasy)) {
      const zapas = lZapasy[matchId];
      let datumObj = zapas.datum?.toDate ? zapas.datum.toDate() : (zapas.datum?.seconds ? new Date(zapas.datum.seconds * 1000) : new Date(zapas.datum));
      
      if (zapas.apiStatus === "IN_PLAY" || zapas.apiStatus === "PAUSED" || (datumObj <= nyni && zapas.apiStatus !== "FINISHED")) {
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
              
              tipyProZapasPole.push({
                uid: mapaEmailToUid[email] || '',
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

    const vsechnyPresne = Object.keys(hracStats).map(email => ({
      nickname: mapaPrezdivek[email] || email.split('@')[0],
      count: hracStats[email].presneVysledkyCount
    })).filter(p => p.count > 0);
    const unikatniPresneBadges = [...new Set(vsechnyPresne.map(p => p.count))].sort((a, b) => b - a).slice(0, 3);
    const top3Presne = unikatniPresneBadges.map(count => {
      const nicks = vsechnyPresne.filter(p => p.count === count).map(p => p.nickname);
      return { count, names: nicks.join(', ') };
    });

    // ⚡ REKORDY: Započítáváme body ze všech kol bez čekání na dohrávky
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

    const vyhraVKolePocet = {};
    const vyhraVKolePocetLive = {};
    const vyhranaKolaSeznam = {};
    const vyhranaKolaSeznamLive = {};

    const vsechnyKolaKlice = new Set();
    Object.keys(hracStats).forEach(email => {
      Object.keys(hracStats[email].bodyPoKolechLive || {}).forEach(k => vsechnyKolaKlice.add(k));
    });

    // 🛡️ DETEKTOR DOHRANÝCH A OTEVŘENÝCH KOL
    const kolaZapasyMapCF = {};
    Object.values(lZapasy).forEach(z => {
      if (z.kolo) {
        const k = String(z.kolo).trim();
        if (!kolaZapasyMapCF[k]) kolaZapasyMapCF[k] = [];
        kolaZapasyMapCF[k].push(z);
      }
    });

    const dohranaKolaSet = new Set();
    const otevrenaKolaSet = new Set();

    Object.keys(kolaZapasyMapCF).forEach(klicKola => {
      const zapasyVKole = kolaZapasyMapCF[klicKola];
      const vsetkoDohrano = zapasyVKole.length > 0 && zapasyVKole.every(z => z.vysledek_domaci !== undefined && z.vysledek_domaci !== null && z.apiStatus !== "IN_PLAY" && z.apiStatus !== "PAUSED");
      if (vsetkoDohrano) {
        dohranaKolaSet.add(klicKola);
      } else {
        const jeRozehrano = zapasyVKole.some(z => z.vysledek_domaci !== undefined || z.apiStatus === "IN_PLAY" || z.apiStatus === "PAUSED" || (z.datum && new Date(z.datum.seconds ? z.datum.seconds * 1000 : z.datum) <= new Date()));
        if (jeRozehrano) {
          otevrenaKolaSet.add(klicKola);
        }
      }
    });

    dohranaKolaSet.forEach(klicKola => {
      let maxPts = -Infinity;
      Object.keys(hracStats).forEach(email => {
        const pts = hracStats[email].bodyPoKolech?.[klicKola];
        if (pts !== undefined && pts > maxPts && pts > 0) maxPts = pts;
      });
      if (maxPts > 0) {
        Object.keys(hracStats).forEach(email => {
          if (hracStats[email].bodyPoKolech?.[klicKola] === maxPts) {
            const nick = mapaPrezdivek[email] || email.split('@')[0];
            vyhraVKolePocet[nick] = (vyhraVKolePocet[nick] || 0) + 1;
            if (!vyhranaKolaSeznam[nick]) vyhranaKolaSeznam[nick] = [];
            vyhranaKolaSeznam[nick].push(klicKola);
          }
        });
      }
    });

    vsechnyKolaKlice.forEach(klicKola => {
      let maxPtsLive = -Infinity;
      Object.keys(hracStats).forEach(email => {
        const pts = hracStats[email].bodyPoKolechLive?.[klicKola];
        if (pts !== undefined && pts > maxPtsLive && pts > 0) maxPtsLive = pts;
      });
      if (maxPtsLive > 0) {
        Object.keys(hracStats).forEach(email => {
          if (hracStats[email].bodyPoKolechLive?.[klicKola] === maxPtsLive) {
            const nick = mapaPrezdivek[email] || email.split('@')[0];
            vyhraVKolePocetLive[nick] = (vyhraVKolePocetLive[nick] || 0) + 1;
            if (!vyhranaKolaSeznamLive[nick]) vyhranaKolaSeznamLive[nick] = [];
            vyhranaKolaSeznamLive[nick].push(klicKola);
          }
        });
      }
    });

    const vsechnyHraciKola = Object.keys(vyhraVKolePocet).map(nick => ({
      nickname: nick,
      count: vyhraVKolePocet[nick],
      rounds: (vyhranaKolaSeznam[nick] || []).join(', ')
    })).filter(p => p.count > 0);
    const unikatniHraciKolaBadges = [...new Set(vsechnyHraciKola.map(p => p.count))].sort((a, b) => b - a).slice(0, 3);
    const top3HraciKola = unikatniHraciKolaBadges.map(count => {
      const entries = vsechnyHraciKola.filter(p => p.count === count);
      const formattedArr = entries.map(e => `${e.nickname} (${e.rounds})`);
      return { count, names: formattedArr.join(', ') };
    });

    const vsechnyHraciKolaLive = Object.keys(vyhraVKolePocetLive).map(nick => ({
      nickname: nick,
      count: vyhraVKolePocetLive[nick],
      rounds: (vyhranaKolaSeznamLive[nick] || []).join(', ')
    })).filter(p => p.count > 0);
    const unikatniHraciKolaBadgesLive = [...new Set(vsechnyHraciKolaLive.map(p => p.count))].sort((a, b) => b - a).slice(0, 3);
    const top3HraciKolaLive = unikatniHraciKolaBadgesLive.map(count => {
      const entries = vsechnyHraciKolaLive.filter(p => p.count === count);
      const formattedArr = entries.map(e => `${e.nickname} (${e.rounds})`);
      return { count, names: formattedArr.join(', ') };
    });

    const otevrenaKolaArr = Array.from(otevrenaKolaSet).sort((a, b) => {
      const numA = parseInt(String(a).replace(/[^0-9]/g, '')) || 0;
      const numB = parseInt(String(b).replace(/[^0-9]/g, '')) || 0;
      return numA - numB;
    });

    const otevrenaKolaStatistiky = otevrenaKolaArr.map(klicKola => {
      const vsechnyZiskyVKole = Object.keys(hracStats).map(email => {
        const stats = hracStats[email];
        const pts = stats.bodyPoKolechLive?.[klicKola] !== undefined ? stats.bodyPoKolechLive[klicKola] : (stats.bodyPoKolech[klicKola] || 0);
        return { nickname: mapaPrezdivek[email] || email.split('@')[0], points: pts };
      }).filter(p => p.points > 0);

      const unikatniPts = [...new Set(vsechnyZiskyVKole.map(p => p.points))].sort((a, b) => b - a).slice(0, 3);
      const top3 = unikatniPts.map(points => {
        const nicks = vsechnyZiskyVKole.filter(p => p.points === points).map(p => p.nickname);
        return { points, names: nicks.join(', ') };
      });

      return {
        round: klicKola,
        top3: top3
      };
    });

    const zebricekPole = Object.keys(hracStats).map(email => {
      const uid = mapaEmailToUid[email] || "unknown";
      const pOtevrenaKola = otevrenaKolaArr.map(klicKola => ({
        round: klicKola,
        points: hracStats[email].bodyPoKolech[klicKola] || 0
      })).filter(k => k.points > 0 || otevrenaKolaArr.length === 1);

      return {
        uid: uid, email: email, nickname: mapaPrezdivek[email],
        celkemBodu: hracStats[email].celkemBodu, natipovaneVyhodnocene: hracStats[email].natipovaneVyhodnocene,
        nenatipovaneVyhodnocene: hracStats[email].nenatipovaneVyhodnocene, presneVysledkyCount: hracStats[email].presneVysledkyCount,
        nejviceBoduVKole: hracStats[email].nejviceBoduVKole, vitezMs: hracStats[email].vitezMs, nejStrelec: hracStats[email].nejStrelec,
        bodyKoloAktualni: hracStats[email].bodyPoKolech[aktivniKolo] || 0,
        otevrenaKola: pOtevrenaKola,
        efektivitaProcento: maxMoznychBoduZapasu > 0 ? (hracStats[email].bodyZapasuCelkem / maxMoznychBoduZapasu) * 100 : 0
      };
    }).sort((a, b) => {
      if (b.celkemBodu !== a.celkemBodu) return b.celkemBodu - a.celkemBodu;
      return b.presneVysledkyCount - a.presneVysledkyCount;
    });

    const zebricekLivePole = Object.keys(hracStats).map(email => {
      const uid = mapaEmailToUid[email] || "unknown";
      const pOtevrenaKolaLive = otevrenaKolaArr.map(klicKola => ({
        round: klicKola,
        points: hracStats[email].bodyPoKolechLive?.[klicKola] !== undefined ? hracStats[email].bodyPoKolechLive[klicKola] : (hracStats[email].bodyPoKolech[klicKola] || 0)
      })).filter(k => k.points > 0 || otevrenaKolaArr.length === 1);

      return {
        uid: uid, email: email, nickname: mapaPrezdivek[email],
        celkemBodu: hracStats[email].celkemBoduLive, natipovaneVyhodnocene: hracStats[email].natipovaneVyhodnoceneLive,
        nenatipovaneVyhodnocene: hracStats[email].nenatipovaneVyhodnoceneLive, presneVysledkyCount: hracStats[email].presneVysledkyCountLive,
        nejviceBoduVKole: hracStats[email].nejviceBoduVKole, vitezMs: hracStats[email].vitezMs, nejStrelec: hracStats[email].nejStrelec,
        bodyKoloAktualni: hracStats[email].bodyPoKolechLive?.[aktivniKolo] !== undefined ? hracStats[email].bodyPoKolechLive[aktivniKolo] : (hracStats[email].bodyPoKolech[aktivniKolo] || 0),
        otevrenaKola: pOtevrenaKolaLive,
        efektivitaProcento: maxMoznychBoduZapasu > 0 ? (hracStats[email].bodyZapasuCelkemLive / maxMoznychBoduZapasu) * 100 : 0
      };
    }).sort((a, b) => {
      if (b.celkemBodu !== a.celkemBodu) return b.celkemBodu - a.celkemBodu;
      return b.presneVysledkyCount - a.presneVysledkyCount;
    });

    zebricekLivePole.forEach(p => {
      const em = p.email;
      if (hracStats[em] && hracStats[em].bodyPoKolechLive) {
         p.bodyKoloAktualni = hracStats[em].bodyPoKolechLive[aktivniKolo] !== undefined ? hracStats[em].bodyPoKolechLive[aktivniKolo] : (hracStats[em].bodyPoKolech[aktivniKolo] || 0);
      }
    });

    const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
    const r2Client = new S3Client({
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
      top3HraciKola: top3HraciKola,
      top3HraciKolaLive: top3HraciKolaLive,
      top3Kola: top3Kola,
      otevrenaKolaStatistiky: otevrenaKolaStatistiky,
      otevrenaKolaSeznam: otevrenaKolaArr,
      aktivniKoloText: aktivniKolo,
      aktualizovano: new Date().toISOString()
    };

    await r2Client.send(new PutObjectCommand({
      Bucket: "tipni-to-data",
      Key: `sezony/${sezonaId}/${ligaKlic}/leaderboard.json`,
      Body: JSON.stringify(leaderboardJson),
      ContentType: "application/json",
      CacheControl: "no-cache, no-store, must-revalidate"
    }));

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

// 🔮 FUNKCE 5: Transfér herních dat
exports.transferUserDataCF = onCall({ cors: true }, async (request) => {
  if (!request.auth || !request.auth.token.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Tento vládní transfér smí spustit pouze Super Admin!");
  }

  const oldEmail = (request.data.oldEmail || "").trim().toLowerCase();
  const newEmail = (request.data.newEmail || "").trim().toLowerCase();
  const sezonaId = request.data.sezonaId || "2026_2027";

  if (!oldEmail || !newEmail) {
    throw new HttpsError("invalid-argument", "Musíš zadat starý i nový e-mail!");
  }

  try {
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

    const oldSezonaRef = db.collection("users").doc(oldUid).collection("sezony").doc(sezonaId);
    const oldSezonaSnap = await oldSezonaRef.get();

    if (!oldSezonaSnap.exists) {
      return { success: true, message: "Původní hráč neměl v této sezóně žádné uložené tipy. Převod netřeba." };
    }

    const staráDataSezóny = oldSezonaSnap.data() || {};
    const staréSouteze = staráDataSezóny.souteze || {};

    const upravenéSouteze = {};
    
    Object.keys(staréSouteze).forEach(ligaKlic => {
      upravenéSouteze[ligaKlic] = { ...staréSouteze[ligaKlic] };

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

      if (upravenéSouteze[ligaKlic].bonusy) {
        upravenéSouteze[ligaKlic].bonusy = {
          ...upravenéSouteze[ligaKlic].bonusy,
          userId: newUid,
          userEmail: newEmail
        };
      }
    });

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

// 🔒 FUNKCE 6: Zabezpečený zápis zápasových tipů
exports.saveUserTipsCF = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Pro uložení tipů musíš být přihlášen!");
  }

  const uid = request.auth.uid;
  const email = request.auth.token.email || "";
  const { leagueName, tipyMapa } = request.data;
  const sezonaId = request.data.sezonaId || "2026_2027";

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

    // ⚡ 1 RPC DOTAZ MÍSTO N+1: Vytvoříme reference a stáhneme všechna utkání najednou
    const matchIds = Object.keys(tipyMapa);
    const matchRefs = matchIds.map(mId =>
      db.collection("ligy").doc(leagueName).collection("sezony").doc(sezonaId).collection("zapasy").doc(mId)
    );
    const matchDocs = await db.getAll(...matchRefs);

    for (const matchDoc of matchDocs) {
      const matchId = matchDoc.id;
      const tipData = tipyMapa[matchId];

      if (!matchDoc.exists || !tipData) {
        rejected.push(matchId);
        continue;
      }

      const matchData = matchDoc.data() || {};
      let datumZapasu;
      if (matchData.datum?.toDate) {
        datumZapasu = matchData.datum.toDate();
      } else if (matchData.datum?.seconds) {
        datumZapasu = new Date(matchData.datum.seconds * 1000);
      } else {
        datumZapasu = new Date(matchData.datum);
      }

      if (nyni >= datumZapasu) {
        rejected.push(matchId);
        continue;
      }

      updateObj.souteze[ligaKlic].tipy[matchId] = {
        userId: uid,
        userEmail: email,
        matchId: matchId,
        tip_domaci: parseInt(tipData.tip_domaci),
        tip_hoste: parseInt(tipData.tip_hoste),
        postup: tipData.postup || ""
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

// 🔒 FUNKCE 7: Zabezpečený zápis dlouhodobých bonusů
exports.saveBonusTipsCF = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Pro uložení bonusů musíš být přihlášen!");
  }

  const uid = request.auth.uid;
  const email = request.auth.token.email || "";
  const { leagueName, vitez, strelec } = request.data;
  const sezonaId = request.data.sezonaId || "2026_2027";

  if (!leagueName) throw new HttpsError("invalid-argument", "Chybí název soutěže!");

  try {
    const ligaKlic = leagueName.replace(/ /g, "_");
    const ligaDoc = await db.collection("ligy").doc(leagueName).get();
    const nyni = new Date();

    if (ligaDoc.exists) {
      const ligaData = ligaDoc.data();
      if (ligaData.zacatek) {
        let zacatekTurnaje;
        if (ligaData.zacatek?.toDate) {
          zacatekTurnaje = ligaData.zacatek.toDate();
        } else if (ligaData.zacatek?.seconds) {
          zacatekTurnaje = new Date(ligaData.zacatek.seconds * 1000);
        } else {
          zacatekTurnaje = new Date(ligaData.zacatek);
        }

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

// 📡 CHRONOS BOT SCHEDULER
exports.chronosWakeUpBotScheduled = onSchedule({
  schedule: "every 1 minutes",
  timeZone: "Europe/Prague",
  memory: "256MiB"
}, async (event) => {
  console.log("⏱️ CHRONOS RADAR: Startuji kontrolu centralizovaného majáku...");
  const SEZNAM_LIG = ["Chance Liga", "Premier League", "MS ve fotbale", "Tipsport Extraliga", "MS v hokeji"];
  const nyni = new Date();
  let odpalitProbouzeciPing = false;

  try {
    for (const leagueName of SEZNAM_LIG) {
      const radarSnap = await db.collection("ligy").doc(leagueName).collection("stav").doc("radar").get();
      if (!radarSnap.exists) continue;

      const radarData = radarSnap.data();

      if (radarData.beziLive === true) {
        console.log(`🔴 LIVE RADAR [${leagueName}]: Na stadionu se aktuálně hraje živé utkání.`);
        odpalitProbouzeciPing = true;
        break;
      } else if (radarData.pristiZapasUtc) {
        const startZapasu = new Date(radarData.pristiZapasUtc);
        const rozdilMinut = (startZapasu - nyni) / (1000 * 60);

        if (rozdilMinut >= -240 && rozdilMinut <= 10) {
          console.log(`⏱️ CHRONOS RADAR [${leagueName}]: Zápas je v aktivním okně (rozdíl ${Math.round(rozdilMinut)} min).`);
          odpalitProbouzeciPing = true;
          break;
        }
      }
    }

    if (odpalitProbouzeciPing) {
      console.log("🚀 CHRONOS PING: Posílám probouzecí signál na Render (/cron)...");
      const targetUrl = `${RENDER_BOT_URL.replace(/\/+$/, "")}/cron`;
      const res = await fetch(targetUrl);
      console.log(`📡 CHRONOS SÍŤ: Signál úspěšně doručen. Render status: ${res.status}`);
    } else {
      console.log("💤 CHRONOS SLEEP: Na stadionu se nic neděje. Nechávám bota spát a šetřím limity.");
    }

  } catch (err) {
    console.error("❌ CHRONOS CRITICAL: Selhala kontrola radarového majáku:", err);
  }
  return null;
});

// 📅 KALENDÁŘNÍ RADAR: 3x denně (3:00, 9:00, 14:00) stáhne a zaktualizuje rozpis zápasů všech lig
exports.syncFixturesScheduled = onSchedule({
  schedule: "0 3,9,14 * * *",
  timeZone: "Europe/Prague",
  memory: "256MiB"
}, async (event) => {
  console.log("📅 FIXTURE RADAR: Startuji pravidelnou synchronizaci kalendáře zápasů (3x denně)...");
  try {
    const targetUrl = `${RENDER_BOT_URL.replace(/\/+$/, "")}/sync-fixtures`;
    const res = await fetch(targetUrl);
    console.log(`📡 FIXTURE RADAR: Signál doručen na Render (/sync-fixtures). Status: ${res.status}`);
  } catch (err) {
    console.error("❌ FIXTURE RADAR CRITICAL: Selhalo odeslání požadavku na synchronizaci kalendáře:", err);
  }
  return null;
});

// 🎮 FUNKCE 8: Zabezpečená registrace přezdívky s kontrolou unikátnosti
exports.registerNicknameCF = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Pro uložení přezdívky musíš být přihlášen!");
  }

  const uid = request.auth.uid;
  const email = (request.auth.token.email || "").trim().toLowerCase();
  const rawNickname = (request.data?.nickname || "").trim();

  if (!rawNickname || rawNickname.length < 3 || rawNickname.length > 16) {
    throw new HttpsError("invalid-argument", "Přezdívka musí mít 3 až 16 znaků!");
  }

  try {
    const q = db.collection("users").where("nickname", "==", rawNickname);
    const duplicateCheck = await q.get();

    // Pokud přezdívka existuje a nepatří aktuálnímu uživateli, zamítneme
    if (!duplicateCheck.empty && duplicateCheck.docs[0].id !== uid) {
      throw new HttpsError("already-exists", "Tuhle přezdívku už vyfoukl někdo před tebou! Zvol si jinou. 🤯");
    }

    const isSuperAdminUser = request.auth.token.isSuperAdmin === true || uid === "tfLmfp1twLbcFsxWrgNkZ7iQRC22";
    const vsechnyLigy = ['Chance Liga', 'Premier League', 'MS ve fotbale', 'Tipsport Extraliga', 'MS v hokeji'];

    const userDocRef = db.collection("users").doc(uid);
    const existingDoc = await userDocRef.get();

    const userPayload = {
      userId: uid,
      email: email,
      nickname: rawNickname,
      isAdmin: isSuperAdminUser ? true : (existingDoc.exists ? (existingDoc.data().isAdmin || false) : false),
      isSuperAdmin: isSuperAdminUser ? true : (existingDoc.exists ? (existingDoc.data().isSuperAdmin || false) : false),
      leagues: isSuperAdminUser ? vsechnyLigy : (existingDoc.exists ? (existingDoc.data().leagues || []) : []),
      aktualizovano: admin.firestore.FieldValue.serverTimestamp()
    };

    if (!existingDoc.exists) {
      userPayload.vytvoreno = admin.firestore.FieldValue.serverTimestamp();
    }

    await userDocRef.set(userPayload, { merge: true });

    return { success: true, nickname: rawNickname };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error.message);
  }
});
