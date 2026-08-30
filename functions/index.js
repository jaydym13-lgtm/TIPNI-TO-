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
    "Liga mistrů": {
        presnyVysledek: 6,
        chytraTendence: 3,
        zakladniTendence: 2,
        golUtechy: 1,
        playoffBonus: 1,
        penaltyNenatipovano: -1,
        bonusVitez: 0,
        bonusStrelec: 0,
        hasTopMatch: false,
        topMatchMultiplier: 1,
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
        presnyVysledek: 5,
        chytraTendence: 3,
        presnaRemiza: 6,
        zakladniTendence: 2,
        golUtechy: 0,
        playoffBonus: 1,
        penaltyNenatipovano: -1,
        bonusVitez: 15,
        bonusStrelec: 8,
        bonusKanadskeBodovani: 8,
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

    const vsechnyDostupneLigy = ['Chance Liga', 'Premier League', 'Liga mistrů', 'MS ve fotbale', 'Tipsport Extraliga', 'MS v hokeji'];
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

// =========================================================================
// 🧮 SDÍLENÝ SENIORNÍ ENGINE PRO PŘEPOČET A DELTA-SYNCHRONIZACI NA R2
// =========================================================================
async function spustVnitrniPrepocetLigy(leagueName, sezonaId, matchIdsProSpyDelta = null) {
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

  const sezonaPromises = vsichniHraciUids.map(uid => 
    db.collection("users").doc(uid).collection("sezony").doc(sezonaId).get()
  );
  const sezonaSnaps = await Promise.all(sezonaPromises);

  let lZapasy = {};
  const zapasySnap = await db.collection("ligy").doc(leagueName).collection("sezony").doc(sezonaId).collection("zapasy").get();
  zapasySnap.forEach(zDoc => {
    lZapasy[zDoc.id] = { id: zDoc.id, ...zDoc.data() };
  });

  const hracStats = {};
  Object.keys(mapaPrezdivek).forEach(email => {
    hracStats[email] = {
      celkemBodu: 0, natipovaneVyhodnocene: 0, nenatipovaneVyhodnocene: 0, presneVysledkyCount: 0,
      presneTopMatchesCount: 0, spravneTendenceCount: 0,
      celkemBoduLive: 0, natipovaneVyhodnoceneLive: 0, nenatipovaneVyhodnoceneLive: 0, presneVysledkyCountLive: 0,
      presneTopMatchesCountLive: 0, spravneTendenceCountLive: 0,
      bodyPoKolech: {}, nejStrelec: '–', vitezMs: '–', nejviceBoduVKole: 0, nejviceBoduVKoleNazev: '–'
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
    hracStats[email].mapaTipuLocal = soutezData.tipy || {};
  });

  const pravidlaLigi = PRAVIDLA_LIG[leagueName] || PRAVIDLA_LIG["DEFAULT"];

  const vypocitejBodyZapasuLocal = (tipDomaci, tipHoste, realDomaci, realHoste, tipPostup, realPostup, isPlayoff, isTopMatch = false) => {
    const tDom = parseInt(tipDomaci); const tHos = parseInt(tipHoste);
    const rDom = parseInt(realDomaci); const rHos = parseInt(realHoste);
    if (isNaN(tDom) || isNaN(tHos) || isNaN(rDom) || isNaN(rHos)) return 0;

    let ziskaneBody = 0;

    if (leagueName === "Tipsport Extraliga") {
      const jeTipRemiza = (tDom === tHos);
      const jeRealRemiza = (rDom === rHos);

      if (jeTipRemiza && jeRealRemiza) {
        const jePresnaRemiza = (tDom === rDom && tHos === rHos);
        ziskaneBody = jePresnaRemiza ? 6 : 3;
        if (tipPostup && realPostup && tipPostup === realPostup) {
          ziskaneBody += 1;
        }
      } else if (!jeTipRemiza && !jeRealRemiza) {
        const presny = (tDom === rDom && tHos === rHos);
        const spravnaTendence = (tDom > tHos && rDom > rHos) || (tDom < tHos && rDom < rHos);
        if (presny) ziskaneBody = 5;
        else if (spravnaTendence) ziskaneBody = 2;
        else ziskaneBody = 0;
      } else {
        ziskaneBody = 0;
      }
    } else {
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
    if (zapas.apiStatus === "POSTPONED") continue;
    if (zapas.apiStatus === "IN_PLAY" || zapas.apiStatus === "PAUSED") {
      liveMatchIds.push(matchId);
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
          const tD = parseInt(uživatelůvTip.tip_domaci); const tH = parseInt(uživatelůvTip.tip_hoste);
          const rD = parseInt(zapas.vysledek_domaci); const rH = parseInt(zapas.vysledek_hoste);

          const jePresny = (tD === rD && tH === rH && (!zapas.isPlayoff || rD !== rH || uživatelůvTip.postup === zapas.postup));
          const jeTendence = (tD > tH && rD > rH) || (tD < tH && rD < rH) || (tD === tH && rD === rH);

          if (jePresny) {
            hracStats[email].presneVysledkyCount++;
            if (zapas.isTopMatch) hracStats[email].presneTopMatchesCount++;
          }
          if (jeTendence) {
            hracStats[email].spravneTendenceCount++;
          }
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
          
          const tD = parseInt(uživatelůvTip.tip_domaci); const tH = parseInt(uživatelůvTip.tip_hoste);
          const rDLive = parseInt(vDomaci); const rHLive = parseInt(vHoste);

          const jePresnyLive = (tD === rDLive && tH === rHLive && (!zapas.isPlayoff || rDLive !== rHLive || uživatelůvTip.postup === zapas.postup));
          const jeTendenceLive = (tD > tH && rDLive > rHLive) || (tD < tH && rDLive < rHLive) || (tD === tH && rDLive === rHLive);

          if (jePresnyLive) {
            hracStats[email].presneVysledkyCountLive++;
            if (zapas.isTopMatch) hracStats[email].presneTopMatchesCountLive++;
          }
          if (jeTendenceLive) {
            hracStats[email].spravneTendenceCountLive++;
          }
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

  const perfektniKolaSeznam = [];
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

            perfektniKolaSeznam.push({ uid: mapaEmailToUid[email] || '', nickname: mapaPrezdivek[email], round: klicKola });
          }
        });
      }
    });
  }

  Object.keys(hracStats).forEach(email => {
    let maxPts = 0; let maxKolo = '–';
    Object.entries(hracStats[email].bodyPoKolech || {}).forEach(([klicKola, pts]) => {
      if (pts > maxPts) { maxPts = pts; maxKolo = klicKola; }
    });
    hracStats[email].nejviceBoduVKole = maxPts;
    hracStats[email].nejviceBoduVKoleNazev = maxKolo;

    let maxPtsLive = 0; let maxKoloLive = '–';
    Object.entries(hracStats[email].bodyPoKolechLive || {}).forEach(([klicKola, pts]) => {
      if (pts > maxPtsLive) { maxPtsLive = pts; maxKoloLive = klicKola; }
    });
    hracStats[email].nejviceBoduVKoleLive = maxPtsLive;
    hracStats[email].nejviceBoduVKoleNazevLive = maxKoloLive;
  });

  const vsechnyPresne = Object.keys(hracStats).map(email => ({ nickname: mapaPrezdivek[email] || email.split('@')[0], count: hracStats[email].presneVysledkyCount })).filter(p => p.count > 0);
  const unikatniPresneBadges = [...new Set(vsechnyPresne.map(p => p.count))].sort((a, b) => b - a).slice(0, 3);
  const top3Presne = unikatniPresneBadges.map(count => ({ count, names: vsechnyPresne.filter(p => p.count === count).map(p => p.nickname).join(', ') }));

  const vsechnyPresneTop = Object.keys(hracStats).map(email => ({ nickname: mapaPrezdivek[email] || email.split('@')[0], count: hracStats[email].presneTopMatchesCount || 0 })).filter(p => p.count > 0);
  const unikatniPresneTopBadges = [...new Set(vsechnyPresneTop.map(p => p.count))].sort((a, b) => b - a).slice(0, 3);
  const top3PresneTop = unikatniPresneTopBadges.map(count => ({ count, names: vsechnyPresneTop.filter(p => p.count === count).map(p => p.nickname).join(', ') }));

  const vsechnyTendence = Object.keys(hracStats).map(email => ({ nickname: mapaPrezdivek[email] || email.split('@')[0], count: hracStats[email].spravneTendenceCount || 0 })).filter(p => p.count > 0);
  const unikatniTendenceBadges = [...new Set(vsechnyTendence.map(p => p.count))].sort((a, b) => b - a).slice(0, 3);
  const top3SpravneTendence = unikatniTendenceBadges.map(count => ({ count, names: vsechnyTendence.filter(p => p.count === count).map(p => p.nickname).join(', ') }));

  const vsechnyTendenceLive = Object.keys(hracStats).map(email => ({ nickname: mapaPrezdivek[email] || email.split('@')[0], count: hracStats[email].spravneTendenceCountLive || 0 })).filter(p => p.count > 0);
  const unikatniTendenceBadgesLive = [...new Set(vsechnyTendenceLive.map(p => p.count))].sort((a, b) => b - a).slice(0, 3);
  const top3SpravneTendenceLive = unikatniTendenceBadgesLive.map(count => ({ count, names: vsechnyTendenceLive.filter(p => p.count === count).map(p => p.nickname).join(', ') }));

  const vsechnyPresneLive = Object.keys(hracStats).map(email => ({ nickname: mapaPrezdivek[email] || email.split('@')[0], count: hracStats[email].presneVysledkyCountLive || 0 })).filter(p => p.count > 0);
  const unikatniPresneBadgesLive = [...new Set(vsechnyPresneLive.map(p => p.count))].sort((a, b) => b - a).slice(0, 3);
  const top3PresneLive = unikatniPresneBadgesLive.map(count => ({ count, names: vsechnyPresneLive.filter(p => p.count === count).map(p => p.nickname).join(', ') }));

  const vsechnyPresneTopLive = Object.keys(hracStats).map(email => ({ nickname: mapaPrezdivek[email] || email.split('@')[0], count: hracStats[email].presneTopMatchesCountLive || 0 })).filter(p => p.count > 0);
  const unikatniPresneTopBadgesLive = [...new Set(vsechnyPresneTopLive.map(p => p.count))].sort((a, b) => b - a).slice(0, 3);
  const top3PresneTopLive = unikatniPresneTopBadgesLive.map(count => ({ count, names: vsechnyPresneTopLive.filter(p => p.count === count).map(p => p.nickname).join(', ') }));

  const vsechnyKolaZisky = [];
  Object.keys(hracStats).forEach(email => {
    const nickname = mapaPrezdivek[email] || email.split('@')[0];
    Object.keys(hracStats[email].bodyPoKolech).forEach(klicKola => {
      const pts = hracStats[email].bodyPoKolech[klicKola];
      if (pts > 0) vsechnyKolaZisky.push({ nickname, points: pts, round: klicKola });
    });
  });
  const unikatniKolaZisky = [...new Set(vsechnyKolaZisky.map(p => p.points))].sort((a, b) => b - a).slice(0, 3);
  const top3Kola = unikatniKolaZisky.map(points => ({ points, text: vsechnyKolaZisky.filter(p => p.points === points).map(e => `${e.nickname} (${e.round})`).join(', ') }));

  const vsechnyKolaZiskyLive = [];
  Object.keys(hracStats).forEach(email => {
    const nickname = mapaPrezdivek[email] || email.split('@')[0];
    Object.keys(hracStats[email].bodyPoKolechLive || {}).forEach(klicKola => {
      const pts = hracStats[email].bodyPoKolechLive[klicKola];
      if (pts > 0) vsechnyKolaZiskyLive.push({ nickname, points: pts, round: klicKola });
    });
  });
  const unikatniKolaZiskyLive = [...new Set(vsechnyKolaZiskyLive.map(p => p.points))].sort((a, b) => b - a).slice(0, 3);
  const top3KolaLive = unikatniKolaZiskyLive.map(points => ({ points, text: vsechnyKolaZiskyLive.filter(p => p.points === points).map(e => `${e.nickname} (${e.round})`).join(', ') }));

  const vyhraVKolePocet = {}; const vyhraVKolePocetLive = {};
  const vyhranaKolaSeznam = {}; const vyhranaKolaSeznamLive = {};
  const vsechnyKolaKlice = new Set();
  Object.keys(hracStats).forEach(email => {
    Object.keys(hracStats[email].bodyPoKolechLive || {}).forEach(k => vsechnyKolaKlice.add(k));
  });

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
      if (jeRozehrano) otevrenaKolaSet.add(klicKola);
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

  const vsechnyHraciKola = Object.keys(vyhraVKolePocet).map(nick => ({ nickname: nick, count: vyhraVKolePocet[nick], rounds: (vyhranaKolaSeznam[nick] || []).join(', ') })).filter(p => p.count > 0);
  const unikatniHraciKolaBadges = [...new Set(vsechnyHraciKola.map(p => p.count))].sort((a, b) => b - a).slice(0, 3);
  const top3HraciKola = unikatniHraciKolaBadges.map(count => ({ count, names: vsechnyHraciKola.filter(p => p.count === count).map(e => `${e.nickname} (${e.rounds})`).join(', ') }));

  const vsechnyHraciKolaLive = Object.keys(vyhraVKolePocetLive).map(nick => ({ nickname: nick, count: vyhraVKolePocetLive[nick], rounds: (vyhranaKolaSeznamLive[nick] || []).join(', ') })).filter(p => p.count > 0);
  const unikatniHraciKolaBadgesLive = [...new Set(vsechnyHraciKolaLive.map(p => p.count))].sort((a, b) => b - a).slice(0, 3);
  const top3HraciKolaLive = unikatniHraciKolaBadgesLive.map(count => ({ count, names: vsechnyHraciKolaLive.filter(p => p.count === count).map(e => `${e.nickname} (${e.rounds})`).join(', ') }));

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
    const top3 = unikatniPts.map(points => ({ points, names: vsechnyZiskyVKole.filter(p => p.points === points).map(p => p.nickname).join(', ') }));

    return { round: klicKola, top3: top3 };
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
      presneTopMatchesCount: hracStats[email].presneTopMatchesCount || 0,
      spravneTendenceCount: hracStats[email].spravneTendenceCount || 0,
      vyhranaKolaCount: vyhraVKolePocet[mapaPrezdivek[email]] || 0,
      perfektniKolaCount: (perfektniKolaSeznam.filter(pk => pk.uid === uid) || []).length,
      nejviceBoduVKole: hracStats[email].nejviceBoduVKole, nejviceBoduVKoleNazev: hracStats[email].nejviceBoduVKoleNazev || '–',
      vitezMs: hracStats[email].vitezMs, nejStrelec: hracStats[email].nejStrelec,
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
      presneTopMatchesCount: hracStats[email].presneTopMatchesCountLive || 0,
      spravneTendenceCount: hracStats[email].spravneTendenceCountLive || 0,
      vyhranaKolaCount: vyhraVKolePocetLive[mapaPrezdivek[email]] || 0,
      perfektniKolaCount: (perfektniKolaSeznam.filter(pk => pk.uid === uid) || []).length,
      nejviceBoduVKole: hracStats[email].nejviceBoduVKoleLive || hracStats[email].nejviceBoduVKole || 0, nejviceBoduVKoleNazev: hracStats[email].nejviceBoduVKoleNazevLive || hracStats[email].nejviceBoduVKoleNazev || '–',
      vitezMs: hracStats[email].vitezMs, nejStrelec: hracStats[email].nejStrelec,
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

  const odehraneZapasyCF = Object.values(lZapasy).filter(z => 
    z.vysledek_domaci !== undefined && z.vysledek_domaci !== null && 
    z.apiStatus !== "IN_PLAY" && z.apiStatus !== "PAUSED"
  );

  let radarStatsCF = {
    totalniVybuchy: [], vlciSamotari: [], zlatyDul: null, stedrostKlubu: [],
    nejcastejsiTip: "–", nejcastejsiTipPct: 0, nejcastejsiVysledek: "–", nejcastejsiVysledekPct: 0,
    uspesnostTendencePct: 0, uspesnostPresnePct: 0, smolarSezony: null, hrdinaSezony: null
  };

  if (odehraneZapasyCF.length > 0) {
    const totalniVybuchy = []; const vlciSamotari = [];
    let zlatyDul = null; let maxRozdanoBodu = -1;
    const klubyStats = {}; const cetnostTipu = {}; const cetnostVysledku = {}; const smolariMap = {};
    let celkemTipuSez = 0; let celkemSpravnychTendenci = 0; let celkemPresnychTref = 0;

    // ⏱️ PŘESNÉ CHRONOLOGICKÉ ŘAZENÍ ODEHRANÝCH ZÁPASŮ PODLE DATA A ČASU
    const odehraneZapasyChronoCF = [...odehraneZapasyCF].sort((a, b) => {
      const dA = a.datum?.toDate ? a.datum.toDate().getTime() : (a.datum?.seconds ? a.datum.seconds * 1000 : new Date(a.datum).getTime());
      const dB = b.datum?.toDate ? b.datum.toDate().getTime() : (b.datum?.seconds ? b.datum.seconds * 1000 : new Date(b.datum).getTime());
      return dA - dB;
    });

    // 🦸 VÝPOČET NEJDELŠÍ NESTANOVENÉ BODOVÉ ŠŇŮRY PRO KAŽDÉHO HRÁČE
    const streakMapCF = {};
    Object.keys(hracStats).forEach(email => {
      const uTips = hracStats[email].mapaTipuLocal || {};
      const nick = mapaPrezdivek[email] || email.split('@')[0];

      let curStreak = 0;
      let curStreakPts = 0;
      let bestStreak = 0;
      let bestStreakPts = 0;

      odehraneZapasyChronoCF.forEach(zapas => {
        const uTip = uTips[zapas.id || zapas.matchId];
        if (!uTip || uTip.tip_domaci === undefined || uTip.tip_domaci === null || String(uTip.tip_domaci).trim() === '') {
          curStreak = 0;
          curStreakPts = 0;
          return;
        }

        const tDom = parseInt(uTip.tip_domaci);
        const tHos = parseInt(uTip.tip_hoste);
        const rDom = parseInt(zapas.vysledek_domaci);
        const rHos = parseInt(zapas.vysledek_hoste);

        if (isNaN(tDom) || isNaN(tHos) || isNaN(rDom) || isNaN(rHos)) {
          curStreak = 0;
          curStreakPts = 0;
          return;
        }

        const body = vypocitejBodyZapasuLocal(tDom, tHos, rDom, rHos, uTip.postup, zapas.postup, zapas.isPlayoff, zapas.isTopMatch);

        if (body > 0) {
          curStreak++;
          curStreakPts += body;
          if (curStreak > bestStreak || (curStreak === bestStreak && curStreakPts > bestStreakPts)) {
            bestStreak = curStreak;
            bestStreakPts = curStreakPts;
          }
        } else {
          curStreak = 0;
          curStreakPts = 0;
        }
      });

      if (bestStreak > 0) {
        streakMapCF[email] = { nick: nick, streak: bestStreak, points: bestStreakPts };
      }
    });

    let hrdinaSezonyCF = null;
    const allStreaksCF = Object.values(streakMapCF);
    if (allStreaksCF.length > 0) {
      const maxStreak = Math.max(...allStreaksCF.map(s => s.streak));
      if (maxStreak > 0) {
        const topStreakUsers = allStreaksCF.filter(s => s.streak === maxStreak);
        const maxPtsInStreak = Math.max(...topStreakUsers.map(s => s.points));
        const bestHeroes = topStreakUsers.filter(s => s.points === maxPtsInStreak);
        const heroNicks = bestHeroes.map(h => h.nick).join(", ");
        hrdinaSezonyCF = {
          names: heroNicks,
          pocet: maxStreak,
          body: maxPtsInStreak
        };
      }
    }

    odehraneZapasyCF.forEach(zapas => {
      const rDom = parseInt(zapas.vysledek_domaci);
      const rHos = parseInt(zapas.vysledek_hoste);
      if (isNaN(rDom) || isNaN(rHos)) return;

      const vysledekStr = `${rDom} : ${rHos}`;
      cetnostVysledku[vysledekStr] = (cetnostVysledku[vysledekStr] || 0) + 1;

      let celkemBoduZapasu = 0; let presnychZasahu = 0; const hraciSBody = []; let tipovaloLidi = 0;
      const dNazev = zapas.domaci || "Domácí"; const hNazev = zapas.hoste || "Hosté";

      if (!klubyStats[dNazev]) klubyStats[dNazev] = { body: 0, zapasu: 0, uspesne: 0, celkemTipu: 0 };
      if (!klubyStats[hNazev]) klubyStats[hNazev] = { body: 0, zapasu: 0, uspesne: 0, celkemTipu: 0 };
      klubyStats[dNazev].zapasu++;
      klubyStats[hNazev].zapasu++;

      Object.keys(hracStats).forEach(email => {
        const nick = mapaPrezdivek[email] || email.split('@')[0];
        const uTip = hracStats[email].mapaTipuLocal ? hracStats[email].mapaTipuLocal[zapas.id] : null;
        if (!uTip || uTip.tip_domaci === undefined || uTip.tip_domaci === null || String(uTip.tip_domaci).trim() === '') return;

        const tDom = parseInt(uTip.tip_domaci); const tHos = parseInt(uTip.tip_hoste);
        if (isNaN(tDom) || isNaN(tHos)) return;

        tipovaloLidi++; celkemTipuSez++;
        const tipStr = `${tDom} : ${tHos}`;
        cetnostTipu[tipStr] = (cetnostTipu[tipStr] || 0) + 1;

        const body = vypocitejBodyZapasuLocal(tDom, tHos, rDom, rHos, uTip.postup, zapas.postup, zapas.isPlayoff, zapas.isTopMatch);
        klubyStats[dNazev].celkemTipu++;
        klubyStats[hNazev].celkemTipu++;

        const jePresny = (tDom === rDom && tHos === rHos && (!zapas.isPlayoff || rDom !== rHos || uTip.postup === zapas.postup));
        const jeTendence = (tDom > tHos && rDom > rHos) || (tDom < tHos && rDom < rHos) || (tDom === tHos && rDom === rHos);

        if (jePresny) celkemPresnychTref++;
        if (jeTendence) celkemSpravnychTendenci++;

        if (body > 0) {
          celkemBoduZapasu += body;
          hraciSBody.push({ email, nick, body });
          klubyStats[dNazev].body += body;
          klubyStats[hNazev].body += body;
          klubyStats[dNazev].uspesne++;
          klubyStats[hNazev].uspesne++;
        }

        if (jePresny) {
          presnychZasahu++;
        } else {
          const rozdil = Math.abs(tDom - rDom) + Math.abs(tHos - rHos);
          if (rozdil === 1) smolariMap[email] = (smolariMap[email] || 0) + 1;
        }
      });

      const zapasLabel = `${dNazev} ${rDom} : ${rHos} ${hNazev}`;
      const koloLabel = zapas.kolo || "Šampionát";

      if (tipovaloLidi > 0 && hraciSBody.length === 0) totalniVybuchy.push({ zapas: zapasLabel, kolo: koloLabel, datum: zapas.datum });
      if (tipovaloLidi > 1 && hraciSBody.length === 1) vlciSamotari.push({ zapas: zapasLabel, kolo: koloLabel, hrac: hraciSBody[0].nick, body: hraciSBody[0].body, datum: zapas.datum });

      if (celkemBoduZapasu > maxRozdanoBodu || (celkemBoduZapasu === maxRozdanoBodu && zlatyDul && presnychZasahu > zlatyDul.presnych)) {
        maxRozdanoBodu = celkemBoduZapasu;
        zlatyDul = { zapas: zapasLabel, kolo: koloLabel, rozdanoBodu: celkemBoduZapasu, presnych: presnychZasahu };
      }
    });

    const stedrostKlubu = Object.entries(klubyStats).map(([tym, d]) => ({
      tym: tym,
      prumerBodu: d.zapasu > 0 ? parseFloat((d.body / d.zapasu).toFixed(1)) : 0,
      uspesnost: d.celkemTipu > 0 ? Math.round((d.uspesne / d.celkemTipu) * 100) : 0,
      celkemBodu: d.body,
      zapasu: d.zapasu
    })).sort((a, b) => b.prumerBodu !== a.prumerBodu ? b.prumerBodu - a.prumerBodu : b.uspesnost - a.uspesnost);

    const sortedTipy = Object.entries(cetnostTipu).sort((a, b) => b[1] - a[1]);
    const topTip = sortedTipy[0] ? sortedTipy[0][0] : "–";
    const topTipCount = sortedTipy[0] ? sortedTipy[0][1] : 0;
    const topTipPct = celkemTipuSez > 0 ? Math.round((topTipCount / celkemTipuSez) * 100) : 0;

    const sortedVysledky = Object.entries(cetnostVysledku).sort((a, b) => b[1] - a[1]);
    const topVysledek = sortedVysledky[0] ? sortedVysledky[0][0] : "–";
    const topVysledekCount = sortedVysledky[0] ? sortedVysledky[0][1] : 0;
    const topVysledekPct = odehraneZapasyCF.length > 0 ? Math.round((topVysledekCount / odehraneZapasyCF.length) * 100) : 0;

    let nejSmolarEmail = null; let maxSmula = 0;
    Object.entries(smolariMap).forEach(([email, count]) => {
      if (count > maxSmula) { maxSmula = count; nejSmolarEmail = email; }
    });

    radarStatsCF = {
      totalniVybuchy: totalniVybuchy.reverse(),
      vlciSamotari: vlciSamotari.reverse(),
      zlatyDul: zlatyDul,
      stedrostKlubu: stedrostKlubu,
      nejcastejsiTip: topTip,
      nejcastejsiTipPct: topTipPct,
      nejcastejsiVysledek: topVysledek,
      nejcastejsiVysledekPct: topVysledekPct,
      uspesnostTendencePct: celkemTipuSez > 0 ? Math.round((celkemSpravnychTendenci / celkemTipuSez) * 100) : 0,
      uspesnostPresnePct: celkemTipuSez > 0 ? Math.round((celkemPresnychTref / celkemTipuSez) * 100) : 0,
      smolarSezony: nejSmolarEmail ? { nick: mapaPrezdivek[nejSmolarEmail] || nejSmolarEmail.split('@')[0], pocet: maxSmula } : null,
      hrdinaSezony: hrdinaSezonyCF
    };
  }

  const leaderboardJson = {
    zebricek: zebricekPole,
    zebricekLive: zebricekLivePole,
    isLive: liveMatchIds.length > 0,
    mapaPrezdivek: mapaPrezdivek,
    top3Presne: top3Presne,
    top3PresneTop: top3PresneTop,
    top3SpravneTendence: top3SpravneTendence,
    top3SpravneTendenceLive: top3SpravneTendenceLive,
    top3HraciKola: top3HraciKola,
    top3HraciKolaLive: top3HraciKolaLive,
    perfektniKola: perfektniKolaSeznam,
    top3Kola: top3Kola,
    top3PresneLive: top3PresneLive,
    top3PresneTopLive: top3PresneTopLive,
    top3KolaLive: top3KolaLive,
    otevrenaKolaStatistiky: otevrenaKolaStatistiky,
    otevrenaKolaSeznam: otevrenaKolaArr,
    aktivniKoloText: aktivniKolo,
    radar: radarStatsCF,
    aktualizovano: new Date().toISOString()
  };

  const r2UploadPromises = [];

  // 1. Uložíme nový leaderboard.json
  r2UploadPromises.push(r2Client.send(new PutObjectCommand({
    Bucket: "tipni-to-data",
    Key: `sezony/${sezonaId}/${ligaKlic}/leaderboard.json`,
    Body: JSON.stringify(leaderboardJson),
    ContentType: "application/json",
    CacheControl: "no-cache, no-store, must-revalidate"
  })));

  // 2. Uložíme profil historie každého hráče
  for (const uid of vsichniHraciUids) {
    const email = mapaUidToEmail[uid];
    if (!email || !hracStats[email]) continue;

    const hracovyTipyVsechny = hracStats[email].mapaTipuLocal || {};
    const maNatipovanouBonusMs = hracStats[email].vitezMs !== '–' || hracStats[email].nejStrelec !== '–';

    if (Object.keys(hracovyTipyVsechny).length === 0 && !maNatipovanouBonusMs) continue;

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

    r2UploadPromises.push(r2Client.send(new PutObjectCommand({
      Bucket: "tipni-to-data",
      Key: `sezony/${sezonaId}/${ligaKlic}/historie_hrace_${uid}.json`,
      Body: JSON.stringify(historyPayload),
      ContentType: "application/json",
      CacheControl: "no-cache, no-store, must-revalidate"
    })));
  }

  // 3. 🎯 SENIORNÍ DELTA ŠPEHOVACÍHO OKA: Vygenerujeme pouze zápasy zadané v poli matchIdsProSpyDelta
  if (Array.isArray(matchIdsProSpyDelta) && matchIdsProSpyDelta.length > 0) {
    for (const matchId of matchIdsProSpyDelta) {
      const zapas = lZapasy[matchId];
      if (!zapas) continue;

      let datumObj = zapas.datum?.toDate ? zapas.datum.toDate() : (zapas.datum?.seconds ? new Date(zapas.datum.seconds * 1000) : new Date(zapas.datum));
      const jeOdemceny = (datumObj <= nyni || zapas.vysledek_domaci !== undefined || zapas.apiStatus === "IN_PLAY" || zapas.apiStatus === "FINISHED");

      if (jeOdemceny) {
        const tipyProZapasPole = [];
        Object.keys(mapaPrezdivek).forEach(email => {
          const uTip = hracStats[email].mapaTipuLocal ? hracStats[email].mapaTipuLocal[matchId] : null;
          if (uTip && uTip.tip_domaci !== undefined && uTip.tip_domaci !== null && String(uTip.tip_domaci).trim() !== '') {
            tipyProZapasPole.push({
              uid: mapaEmailToUid[email] || '',
              userEmail: email,
              nickname: mapaPrezdivek[email],
              tip_domaci: parseInt(uTip.tip_domaci),
              tip_hoste: parseInt(uTip.tip_hoste),
              postup: uTip.postup || ''
            });
          }
        });

        const spyPayload = {
          tipy: tipyProZapasPole,
          aktualizovano: new Date().toISOString()
        };

        r2UploadPromises.push(r2Client.send(new PutObjectCommand({
          Bucket: "tipni-to-data",
          Key: `sezony/${sezonaId}/${ligaKlic}/spy_zapas_${matchId}.json`,
          Body: JSON.stringify(spyPayload),
          ContentType: "application/json",
          CacheControl: "no-cache, no-store, must-revalidate"
        })));
      }
    }
  }

  await Promise.all(r2UploadPromises);

  const pulsRef = db.collection('ligy').doc(leagueName).collection('stav').doc('puls');
  const pulsDoc = await pulsRef.get();
  let novaVerzeRozpisu = 1; let novaVerzeZebricku = 1;
  if (pulsDoc.exists) {
    const pData = pulsDoc.data();
    novaVerzeRozpisu = (pData.verzeRozpisu || 0) + 1;
    novaVerzeZebricku = (pData.verzeZebricku || 0) + 1;
  }

  await pulsRef.set({ verzeRozpisu: novaVerzeRozpisu, verzeZebricku: novaVerzeZebricku, aktualizovano: admin.firestore.Timestamp.now() }, { merge: true });
}

// 👑 FUNKCE 3: Loutkovodič (Autonomní okamžitý zápis do DB + R2 s delta aktualizací)
exports.saveProxyDataCF = onCall({ 
  cors: true,
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze prověřený administrátor smí ukládat data přes loutkovodiče!");
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

    const dotceneMatchIds = tipyMapa ? Object.keys(tipyMapa) : [];

    if (dotceneMatchIds.length > 0) {
      updateObj.souteze[ligaKlic].tipy = {};
      for (const matchId of dotceneMatchIds) {
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

    // 1. Zápis do Firestore
    await userSezonaRef.set(updateObj, { merge: true });

    // 2. Okamžitý autonomní přepočet a nahrání na R2 (včetně Špehovacího oka pro zapsané zápasy)
    await spustVnitrniPrepocetLigy(leagueName, sezonaId, dotceneMatchIds);

    return { success: true, message: "Data byla přes loutkovodiče úspěšně naočkována a okamžitě synchronizována!" };
  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});

// 👑 FUNKCE 4: Generální rekalkulace žebříčku
exports.recalculateLeaderboardCF = onCall({ 
  cors: true,
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (request) => {
  console.log("🚀 FORSÁŽ CLOUDU: Aktivuji bleskový přepočet žebříčku na R2.");
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze prověřený administrátor smí vynutit rekalkulaci žebříčku!");
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
    await spustVnitrniPrepocetLigy(leagueName, sezonaId, null);
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

    const kanadske = request.data.kanadske || "";

    const updateObj = {
      souteze: {
        [ligaKlic]: {
          bonusy: {
            userId: uid, userEmail: email,
            vitez: vitez ? vitez.trim() : "", 
            strelec: strelec ? strelec.trim() : "",
            kanadske: kanadske ? kanadske.trim() : ""
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
  const SEZNAM_LIG = ["Chance Liga", "Premier League", "Liga mistrů", "MS ve fotbale", "Tipsport Extraliga", "MS v hokeji"];
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

// 📊 ODDS RADAR: 1× týdně v PONDĚLÍ v 15:00 probudí Render pro stažení kurzů na herní týden (Po–Po)
exports.syncOddsScheduled = onSchedule({
  schedule: "0 15 * * 1",
  timeZone: "Europe/Prague",
  memory: "256MiB"
}, async (event) => {
  console.log("📊 ODDS RADAR: Posílám pondělní týdenní probouzecí signál pro stažení kurzů (/sync-odds)...");
  try {
    const targetUrl = `${RENDER_BOT_URL.replace(/\/+$/, "")}/sync-odds`;
    const res = await fetch(targetUrl);
    console.log(`📡 ODDS RADAR: Signál doručen na Render. Status: ${res.status}`);
  } catch (err) {
    console.error("❌ ODDS RADAR CRITICAL: Selhalo probuzení pro kurzy:", err);
  }
  return null;
});

// 🗺️ EVENT MAPPER RADAR: 1× měsíčně (1. den v měsíci ve 02:00) stáhne a spáruje ID zápasů
exports.syncEventMappingScheduled = onSchedule({
  schedule: "0 2 1 * *",
  timeZone: "Europe/Prague",
  memory: "256MiB"
}, async (event) => {
  console.log("🗺️ EVENT MAPPER RADAR: Posílám měsíční signál pro aktualizaci mapy ID (/sync-event-map)...");
  try {
    const targetUrl = `${RENDER_BOT_URL.replace(/\/+$/, "")}/sync-event-map`;
    const res = await fetch(targetUrl);
    console.log(`📡 EVENT MAPPER RADAR: Signál doručen na Render. Status: ${res.status}`);
  } catch (err) {
    console.error("❌ EVENT MAPPER RADAR CRITICAL: Selhalo probuzení pro mapování ID:", err);
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
    const vsechnyLigy = ['Chance Liga', 'Premier League', 'Liga mistrů', 'MS ve fotbale', 'Tipsport Extraliga', 'MS v hokeji'];

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
