// =========================================================================
// ⚙️ TIPNI TO! - ADMIN PANEL & PŘEPOČETNÍ ENGINE NA CLOUDU (admin.js)
// =========================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db, auth, admin, DEFAULT_SEASON_ID } = require("./init");
const { PRAVIDLA_LIG } = require("./rules");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getDatabase } = require("firebase-admin/database");

// 📡 RTDB MAJÁK: Okamžitý signál pro mobily i bota s Echo Guard ochranou (0 Firestore reads)
async function cinkniRtdbMajak(leagueName, typ = "all") {
  try {
    const lKlic = String(leagueName || "").replace(/ /g, "_");
    const rtdb = getDatabase();
    await rtdb.ref(`system/leagues_pulse/${lKlic}`).set({
      ts: Date.now(),
      source: "admin",
      type: typ,
      league: leagueName
    });
  } catch (err) {
    console.warn(`⚠️ RTDB Maják varování pro ${leagueName}:`, err.message);
  }
}

// 👑 FUNKCE 1: Správa oprávnění uživatelů
const manageUserPermissionsCF = onCall(async (request) => {
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

    // ⚡ RTDB SYNCHRONIZACE: Okamžitá aktualizace soupisky bez čtení z Firestore
    try {
      await getDatabase().ref(`admin_roster/${targetUid}`).update({
        isAdmin: isAdminRole,
        leagues: leagues
      });
    } catch (rtdbErr) {
      console.warn("RTDB sync varování:", rtdbErr.message);
    }

    return { success: true, message: "Cejchy a ligové přístupy bezpečně aktualizovány!" };
  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});

// 🌪️ FUNKCE 2: Nuclear Purge
const purgeUserAbsoluteCF = onCall(async (request) => {
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

    // ⚡ RTDB SYNCHRONIZACE: Okamžité vymazání z RTDB soupisky
    try {
      await getDatabase().ref(`admin_roster/${targetUid}`).remove();
    } catch (rtdbErr) {
      console.warn("RTDB purge varování:", rtdbErr.message);
    }

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
    hracStats[email].nejKanadske = bTip.kanadske || '–';
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
      const trefilPostup = Boolean(tipPostup && realPostup && tipPostup === realPostup);

      if (jeTipRemiza && jeRealRemiza) {
        const jePresnaRemiza = (tDom === rDom && tHos === rHos);
        if (isTopMatch) {
          return jePresnaRemiza 
            ? (trefilPostup ? 11 : 10)
            : (trefilPostup ? 8 : 6);
        } else {
          return jePresnaRemiza
            ? (trefilPostup ? 7 : 6)
            : (trefilPostup ? 4 : 3);
        }
      } else if (!jeTipRemiza && !jeRealRemiza) {
        const presny = (tDom === rDom && tHos === rHos);
        const spravnaTendence = (tDom > tHos && rDom > rHos) || (tDom < tHos && rDom < rHos);
        if (presny) {
          return isTopMatch ? 10 : 5;
        } else if (spravnaTendence) {
          return isTopMatch ? 4 : 2;
        } else {
          return -1;
        }
      } else {
        return -1;
      }
    }

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

  if (realLeagueData && (realLeagueData.vitez || realLeagueData.strelec || realLeagueData.kanadske)) {
    Object.keys(hracStats).forEach(email => {
      let bonusBody = 0;
      if (pravidlaLigi.bonusVitez > 0 && realLeagueData.vitez && hracStats[email].vitezMs && hracStats[email].vitezMs.trim().toLowerCase() === realLeagueData.vitez.trim().toLowerCase()) {
        bonusBody += pravidlaLigi.bonusVitez;
      }
      if (pravidlaLigi.bonusStrelec > 0 && realLeagueData.strelec && hracStats[email].nejStrelec && hracStats[email].nejStrelec.trim().toLowerCase() === realLeagueData.strelec.trim().toLowerCase()) {
        bonusBody += pravidlaLigi.bonusStrelec;
      }
      if (pravidlaLigi.bonusKanadskeBodovani > 0 && realLeagueData.kanadske && hracStats[email].nejKanadske && hracStats[email].nejKanadske.trim().toLowerCase() === realLeagueData.kanadske.trim().toLowerCase()) {
        bonusBody += pravidlaLigi.bonusKanadskeBodovani;
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

  const kolaZapasyMapCF = {};
  Object.entries(lZapasy).forEach(([mId, z]) => {
    if (z.kolo) {
      const k = String(z.kolo).trim();
      if (!kolaZapasyMapCF[k]) kolaZapasyMapCF[k] = [];
      kolaZapasyMapCF[k].push({ ...z, id: mId, matchId: mId });
    }
  });

  const dohranaKolaSet = new Set();
  const otevrenaKolaSet = new Set();

  const STANDARD_ZAPASU_LIGY = {
    "Tipsport Extraliga": 7,
    "Chance Liga": 8,
    "Premier League": 10
  };
  const ocekavanyPocetZapasu = STANDARD_ZAPASU_LIGY[leagueName] || 0;

  Object.keys(kolaZapasyMapCF).forEach(klicKola => {
    const zapasyVKole = kolaZapasyMapCF[klicKola];
    const maPlnyPocet = ocekavanyPocetZapasu === 0 || zapasyVKole.length >= ocekavanyPocetZapasu;
    const bezOdlozenych = zapasyVKole.every(z => z.apiStatus !== "POSTPONED");
    const vsechnyOdehrane = zapasyVKole.length > 0 && zapasyVKole.every(z => z.vysledek_domaci !== undefined && z.vysledek_domaci !== null && z.apiStatus !== "IN_PLAY" && z.apiStatus !== "PAUSED");

    const vsetkoDohrano = maPlnyPocet && bezOdlozenych && vsechnyOdehrane;
    if (vsetkoDohrano) {
      dohranaKolaSet.add(klicKola);
    } else {
      const jeRozehrano = zapasyVKole.some(z => z.vysledek_domaci !== undefined || z.apiStatus === "IN_PLAY" || z.apiStatus === "PAUSED" || (z.datum && new Date(z.datum.seconds ? z.datum.seconds * 1000 : z.datum) <= new Date()));
      if (jeRozehrano) otevrenaKolaSet.add(klicKola);
    }
  });

  const perfektniKolaSeznam = [];
  if (pravidlaLigi.roundBonus && pravidlaLigi.roundBonus > 0) {
    dohranaKolaSet.forEach(klicKola => {
      const zapasyVKole = kolaZapasyMapCF[klicKola];
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
    });
  }

  Object.keys(hracStats).forEach(email => {
    const entries = Object.entries(hracStats[email].bodyPoKolech || {});
    let maxPts = entries.length > 0 ? -Infinity : 0;
    let maxKolo = '–';
    entries.forEach(([klicKola, pts]) => {
      if (pts > maxPts) { maxPts = pts; maxKolo = klicKola; }
    });
    if (maxPts === -Infinity) maxPts = 0;
    hracStats[email].nejviceBoduVKole = maxPts;
    hracStats[email].nejviceBoduVKoleNazev = maxKolo;

    const entriesLive = Object.entries(hracStats[email].bodyPoKolechLive || {});
    let maxPtsLive = entriesLive.length > 0 ? -Infinity : 0;
    let maxKoloLive = '–';
    entriesLive.forEach(([klicKola, pts]) => {
      if (pts > maxPtsLive) { maxPtsLive = pts; maxKoloLive = klicKola; }
    });
    if (maxPtsLive === -Infinity) maxPtsLive = 0;
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

  const vsechnyHraciKola = Object.keys(vyhraVKolePocet).map(nick => ({ nickname: nick, count: vyhraVKolePocet[nick], rounds: (vyhranaKolaSeznam[nick] || []).join(' & ') })).filter(p => p.count > 0);
  const unikatniHraciKolaBadges = [...new Set(vsechnyHraciKola.map(p => p.count))].sort((a, b) => b - a).slice(0, 3);
  const top3HraciKola = unikatniHraciKolaBadges.map(count => ({ count, names: vsechnyHraciKola.filter(p => p.count === count).map(e => `${e.nickname} (${e.rounds})`).join(', ') }));

  const vsechnyHraciKolaLive = Object.keys(vyhraVKolePocetLive).map(nick => ({ nickname: nick, count: vyhraVKolePocetLive[nick], rounds: (vyhranaKolaSeznamLive[nick] || []).join(' & ') })).filter(p => p.count > 0);
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
      const pts = stats.bodyPoKolech[klicKola] !== undefined ? stats.bodyPoKolech[klicKola] : 0;
      return { nickname: mapaPrezdivek[email] || email.split('@')[0], points: pts };
    });

    const unikatniPts = [...new Set(vsechnyZiskyVKole.map(p => p.points))].sort((a, b) => b - a).slice(0, 3);
    const top3 = unikatniPts.map(points => ({ points, names: vsechnyZiskyVKole.filter(p => p.points === points).map(p => p.nickname).join(', ') }));

    return { round: klicKola, top3: top3 };
  });

  const otevrenaKolaStatistikyLive = otevrenaKolaArr.map(klicKola => {
    const vsechnyZiskyVKole = Object.keys(hracStats).map(email => {
      const stats = hracStats[email];
      const pts = stats.bodyPoKolechLive?.[klicKola] !== undefined ? stats.bodyPoKolechLive[klicKola] : (stats.bodyPoKolech[klicKola] || 0);
      return { nickname: mapaPrezdivek[email] || email.split('@')[0], points: pts };
    });

    const unikatniPts = [...new Set(vsechnyZiskyVKole.map(p => p.points))].sort((a, b) => b - a).slice(0, 3);
    const top3 = unikatniPts.map(points => ({ points, names: vsechnyZiskyVKole.filter(p => p.points === points).map(p => p.nickname).join(', ') }));

    return { round: klicKola, top3: top3 };
  });

  const zebricekPole = Object.keys(hracStats).map(email => {
    const uid = mapaEmailToUid[email] || "unknown";
    const pOtevrenaKola = otevrenaKolaArr.map(klicKola => ({
      round: klicKola,
      points: hracStats[email].bodyPoKolech[klicKola] !== undefined ? hracStats[email].bodyPoKolech[klicKola] : 0
    }));

    return {
      uid: uid, email: email, nickname: mapaPrezdivek[email],
      celkemBodu: hracStats[email].celkemBodu, natipovaneVyhodnocene: hracStats[email].natipovaneVyhodnocene,
      nenatipovaneVyhodnocene: hracStats[email].nenatipovaneVyhodnocene, presneVysledkyCount: hracStats[email].presneVysledkyCount,
      presneTopMatchesCount: hracStats[email].presneTopMatchesCount || 0,
      spravneTendenceCount: hracStats[email].spravneTendenceCount || 0,
      vyhranaKolaCount: vyhraVKolePocet[mapaPrezdivek[email]] || 0,
      perfektniKolaCount: (perfektniKolaSeznam.filter(pk => pk.uid === uid) || []).length,
      nejviceBoduVKole: hracStats[email].nejviceBoduVKole, nejviceBoduVKoleNazev: hracStats[email].nejviceBoduVKoleNazev || '–',
      vitezMs: hracStats[email].vitezMs, nejStrelec: hracStats[email].nejStrelec, nejKanadske: hracStats[email].nejKanadske,
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
    }));

    return {
      uid: uid, email: email, nickname: mapaPrezdivek[email],
      celkemBodu: hracStats[email].celkemBoduLive, natipovaneVyhodnocene: hracStats[email].natipovaneVyhodnoceneLive,
      nenatipovaneVyhodnocene: hracStats[email].nenatipovaneVyhodnoceneLive, presneVysledkyCount: hracStats[email].presneVysledkyCountLive,
      presneTopMatchesCount: hracStats[email].presneTopMatchesCountLive || 0,
      spravneTendenceCount: hracStats[email].spravneTendenceCountLive || 0,
      vyhranaKolaCount: vyhraVKolePocetLive[mapaPrezdivek[email]] || 0,
      perfektniKolaCount: (perfektniKolaSeznam.filter(pk => pk.uid === uid) || []).length,
      nejviceBoduVKole: hracStats[email].nejviceBoduVKoleLive || hracStats[email].nejviceBoduVKole || 0, nejviceBoduVKoleNazev: hracStats[email].nejviceBoduVKoleNazevLive || hracStats[email].nejviceBoduVKoleNazev || '–',
      vitezMs: hracStats[email].vitezMs, nejStrelec: hracStats[email].nejStrelec, nejKanadske: hracStats[email].nejKanadske,
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

  const odehraneZapasyChronoCF = [...odehraneZapasyCF].sort((a, b) => {
    const dA = a.datum?.toDate ? a.datum.toDate().getTime() : (a.datum?.seconds ? a.datum.seconds * 1000 : new Date(a.datum).getTime());
    const dB = b.datum?.toDate ? b.datum.toDate().getTime() : (b.datum?.seconds ? b.datum.seconds * 1000 : new Date(b.datum).getTime());
    return dA - dB;
  });

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

          const isHockey = leagueName.includes("hokej") || leagueName.includes("Extraliga");

          let vysledekStr = `${rDom} : ${rHos}`;
          if (isHockey && rDom === rHos) {
            if (zapas.postup === 'domaci') vysledekStr = `${rDom + 1} : ${rHos}p`;
            else if (zapas.postup === 'hoste') vysledekStr = `${rDom} : ${rHos + 1}p`;
            else vysledekStr = `${rDom} : ${rHos}p`;
          }
          cetnostVysledku[vysledekStr] = (cetnostVysledku[vysledekStr] || 0) + 1;

          let celkemBoduZapasu = 0; let presnychZasahu = 0; const hraciSBody = []; const hraciSTendenci = []; let tipovaloLidi = 0;
          const dNazev = zapas.domaci || "Domácí"; const hNazev = zapas.hoste || "Hosté";

          if (!klubyStats[dNazev]) klubyStats[dNazev] = { body: 0, zapasu: 0, uspesne: 0, celkemTipu: 0 };
          if (!klubyStats[hNazev]) klubyStats[hNazev] = { body: 0, zapasu: 0, uspesne: 0, celkemTipu: 0 };
          klubyStats[dNazev].zapasu++;
          klubyStats[hNazev].zapasu++;

          Object.keys(hracStats).forEach(email => {
            const nick = mapaPrezdivek[email] || email.split('@')[0];
            const uTip = hracStats[email].mapaTipuLocal ? (hracStats[email].mapaTipuLocal[zapas.id] || hracStats[email].mapaTipuLocal[zapas.matchId]) : null;
            if (!uTip || uTip.tip_domaci === undefined || uTip.tip_domaci === null || String(uTip.tip_domaci).trim() === '') return;

            const tDom = parseInt(uTip.tip_domaci);
            const tHos = parseInt(uTip.tip_hoste);
            if (isNaN(tDom) || isNaN(tHos)) return;

            tipovaloLidi++;
            celkemTipuSez++;

            let tipStr = `${tDom} : ${tHos}`;
            if (isHockey && tDom === tHos) {
              if (uTip.postup === 'domaci') tipStr = `${tDom + 1} : ${tHos}p`;
              else if (uTip.postup === 'hoste') tipStr = `${tDom} : ${tHos + 1}p`;
              else tipStr = `${tDom} : ${tHos}p`;
            }
            cetnostTipu[tipStr] = (cetnostTipu[tipStr] || 0) + 1;

            const body = vypocitejBodyZapasuLocal(tDom, tHos, rDom, rHos, uTip.postup, zapas.postup, zapas.isPlayoff, zapas.isTopMatch);
            klubyStats[dNazev].celkemTipu++;
            klubyStats[hNazev].celkemTipu++;

            const vyzadujePostup = isHockey || zapas.isPlayoff;
            const jePresny = (tDom === rDom && tHos === rHos && (!vyzadujePostup || rDom !== rHos || uTip.postup === zapas.postup));

            let jeTendence = false;
            if (isHockey && rDom === rHos) {
              jeTendence = (tDom === tHos && Boolean(uTip.postup) && uTip.postup === zapas.postup);
            } else {
              jeTendence = (tDom > tHos && rDom > rHos) || (tDom < tHos && rDom < rHos) || (tDom === tHos && rDom === rHos);
            }

            if (jePresny) celkemPresnychTref++;
            if (jeTendence) celkemSpravnychTendenci++;

            if (body > 0) {
              celkemBoduZapasu += body;
              hraciSBody.push({ email, nick, body, tip: tipStr });
              const maPlatnouTrefu = isHockey ? (body > 0) : (jeTendence || jePresny);
              if (maPlatnouTrefu) {
                hraciSTendenci.push({ email, nick, body, tip: tipStr });
              }
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
          if (tipovaloLidi > 1 && hraciSTendenci.length === 1) vlciSamotari.push({ zapas: zapasLabel, kolo: koloLabel, hrac: hraciSTendenci[0].nick, body: hraciSTendenci[0].body, tip: hraciSTendenci[0].tip, datum: zapas.datum });

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

    let maxSmula = 0;
    Object.values(smolariMap).forEach(count => {
      if (count > maxSmula) maxSmula = count;
    });
    const topSmolari = maxSmula > 0
      ? Object.entries(smolariMap)
          .filter(([_, count]) => count === maxSmula)
          .map(([em]) => mapaPrezdivek[em] || em.split('@')[0])
      : [];

    const parsujDatumMs = (d) => {
      if (!d) return 0;
      if (typeof d.toDate === 'function') return d.toDate().getTime();
      if (d.seconds) return d.seconds * 1000;
      return Date.parse(d) || 0;
    };
    totalniVybuchy.sort((a, b) => parsujDatumMs(b.datum) - parsujDatumMs(a.datum));
    vlciSamotari.sort((a, b) => parsujDatumMs(b.datum) - parsujDatumMs(a.datum));

    radarStatsCF = {
      totalniVybuchy: totalniVybuchy,
      vlciSamotari: vlciSamotari,
      zlatyDul: zlatyDul,
      stedrostKlubu: stedrostKlubu,
      nejcastejsiTip: topTip,
      nejcastejsiTipPct: topTipPct,
      nejcastejsiVysledek: topVysledek,
      nejcastejsiVysledekPct: topVysledekPct,
      uspesnostTendencePct: celkemTipuSez > 0 ? Math.round((celkemSpravnychTendenci / celkemTipuSez) * 100) : 0,
      uspesnostPresnePct: celkemTipuSez > 0 ? Math.round((celkemPresnychTref / celkemTipuSez) * 100) : 0,
      smolarSezony: topSmolari.length > 0 ? { names: topSmolari.join(', '), nick: topSmolari[0], pocet: maxSmula } : null,
      hrdinaSezony: hrdinaSezonyCF
    };
  }

  const kolaSouhrn = {};
  Object.keys(kolaZapasyMapCF).forEach(klicKola => {
    const zapasyVKole = kolaZapasyMapCF[klicKola] || [];
    const isLiveOrStartedRound = zapasyVKole.some(z => {
      const d = z.datum?.toDate ? z.datum.toDate() : (z.datum?.seconds ? new Date(z.datum.seconds * 1000) : new Date(z.datum || 0));
      return z.vysledek_domaci !== undefined || z.apiStatus === "IN_PLAY" || z.apiStatus === "PAUSED" || d <= new Date();
    });

    let maxPtsRound = -Infinity;
    Object.keys(hracStats).forEach(email => {
      const pts = hracStats[email].bodyPoKolechLive?.[klicKola] !== undefined
        ? hracStats[email].bodyPoKolechLive[klicKola]
        : (hracStats[email].bodyPoKolech?.[klicKola] || 0);
      if (pts > maxPtsRound) maxPtsRound = pts;
    });

    let hraciKolaObj = null;
    if (isLiveOrStartedRound && maxPtsRound > 0) {
      const winners = [];
      Object.keys(hracStats).forEach(email => {
        const pts = hracStats[email].bodyPoKolechLive?.[klicKola] !== undefined
          ? hracStats[email].bodyPoKolechLive[klicKola]
          : (hracStats[email].bodyPoKolech?.[klicKola] || 0);
        if (pts === maxPtsRound) {
          winners.push(mapaPrezdivek[email] || email.split('@')[0]);
        }
      });
      hraciKolaObj = {
        names: winners.join(', '),
        points: maxPtsRound,
        count: winners.length
      };
    }

    let nejvicPresnychObj = null;
    if (isLiveOrStartedRound) {
      const exactCounts = {};
      let maxExactRound = 0;

      Object.keys(hracStats).forEach(email => {
        const uTips = hracStats[email].mapaTipuLocal || {};
        let userExact = 0;

        zapasyVKole.forEach(zap => {
          const vDom = zap.vysledek_domaci;
          const vHos = zap.vysledek_hoste;
          if (vDom !== undefined && vDom !== null && vHos !== undefined && vHos !== null) {
            const uTip = uTips[zap.id || zap.matchId];
            if (uTip && uTip.tip_domaci !== undefined && uTip.tip_domaci !== null && String(uTip.tip_domaci).trim() !== '') {
              const tD = parseInt(uTip.tip_domaci);
              const tH = parseInt(uTip.tip_hoste);
              const rD = parseInt(vDom);
              const rH = parseInt(vHos);
              const isExact = (tD === rD && tH === rH && (!zap.isPlayoff || rD !== rH || uTip.postup === zap.postup));
              if (isExact) userExact++;
            }
          }
        });

        exactCounts[email] = userExact;
        if (userExact > maxExactRound) maxExactRound = userExact;
      });

      if (maxExactRound > 0) {
        const exactWinners = [];
        Object.keys(exactCounts).forEach(email => {
          if (exactCounts[email] === maxExactRound) {
            exactWinners.push(mapaPrezdivek[email] || email.split('@')[0]);
          }
        });
        nejvicPresnychObj = {
          names: exactWinners.join(', '),
          count: maxExactRound
        };
      }
    }

    let topMatchObj = null;
    if (pravidlaLigi.hasTopMatch) {
      const topMatch = zapasyVKole.find(z => z.isTopMatch);
      if (topMatch) {
        const d = topMatch.datum?.toDate ? topMatch.datum.toDate() : (topMatch.datum?.seconds ? new Date(topMatch.datum.seconds * 1000) : new Date(topMatch.datum || 0));
        const isTopStarted = (topMatch.vysledek_domaci !== undefined && topMatch.vysledek_domaci !== null) ||
                             topMatch.apiStatus === "IN_PLAY" || topMatch.apiStatus === "PAUSED" ||
                             d <= new Date();
        
        const exactUsers = [];
        if (isTopStarted && topMatch.vysledek_domaci !== undefined && topMatch.vysledek_domaci !== null) {
          const rD = parseInt(topMatch.vysledek_domaci);
          const rH = parseInt(topMatch.vysledek_hoste);

          Object.keys(hracStats).forEach(email => {
            const uTips = hracStats[email].mapaTipuLocal || {};
            const uTip = uTips[topMatch.id || topMatch.matchId];

            if (uTip && uTip.tip_domaci !== undefined && uTip.tip_domaci !== null && String(uTip.tip_domaci).trim() !== '') {
              const tD = parseInt(uTip.tip_domaci);
              const tH = parseInt(uTip.tip_hoste);
              const isExact = (tD === rD && tH === rH && (!topMatch.isPlayoff || rD !== rH || uTip.postup === topMatch.postup));
              if (isExact) {
                exactUsers.push(mapaPrezdivek[email] || email.split('@')[0]);
              }
            }
          });
        }

        topMatchObj = {
          hasTopMatch: true,
          isStarted: isTopStarted,
          isEvaluated: topMatch.vysledek_domaci !== undefined && topMatch.vysledek_domaci !== null,
          domaci: topMatch.domaci,
          hoste: topMatch.hoste,
          exactCount: exactUsers.length,
          exactUsers: exactUsers
        };
      }
    }

    kolaSouhrn[klicKola] = {
      hracKola: hraciKolaObj,
      topMatch: topMatchObj,
      nejvicPresnych: nejvicPresnychObj
    };
  });

  const zapasyConsensusCF = {};
  Object.keys(lZapasy).forEach(mId => {
    let c1 = 0, cX = 0, c2 = 0, cTot = 0;
    Object.keys(hracStats).forEach(email => {
      const t = hracStats[email]?.mapaTipuLocal?.[mId];
      if (t && t.tip_domaci !== undefined && t.tip_domaci !== null && String(t.tip_domaci).trim() !== '') {
        const d = parseInt(t.tip_domaci, 10);
        const h = parseInt(t.tip_hoste, 10);
        if (!isNaN(d) && !isNaN(h)) {
          cTot++;
          if (d > h) c1++;
          else if (d === h) cX++;
          else c2++;
        }
      }
    });
    zapasyConsensusCF[mId] = {
      p1: cTot > 0 ? (c1 / cTot) : 0.33,
      pX: cTot > 0 ? (cX / cTot) : 0.33,
      p2: cTot > 0 ? (c2 / cTot) : 0.33,
      total: cTot
    };
  });

  const serazenaKolaKliceCF = Object.keys(kolaZapasyMapCF).sort((a, b) => {
    const numA = parseInt(String(a).replace(/[^0-9]/g, ''), 10) || 0;
    const numB = parseInt(String(b).replace(/[^0-9]/g, ''), 10) || 0;
    return numA - numB;
  });
  const odehranaKolaKliceCF = serazenaKolaKliceCF.filter(k => 
    (kolaZapasyMapCF[k] || []).some(z => {
      const isEval = z.vysledek_domaci !== undefined && z.vysledek_domaci !== null;
      const isLive = z.apiStatus === "IN_PLAY" || z.apiStatus === "PAUSED";
      return isEval || isLive;
    })
  );
  const posl3KolaCF = odehranaKolaKliceCF.slice(-3);
  const posl5KolaCF = odehranaKolaKliceCF.slice(-5);

  const getLeagueTotalsCF = (isLive) => {
    const ptsArr = Object.values(hracStats)
      .filter(u => (isLive ? u.natipovaneVyhodnoceneLive : u.natipovaneVyhodnocene) > 0)
      .map(u => isLive ? u.celkemBoduLive : u.celkemBodu);
    if (ptsArr.length === 0) return { min: 0, max: 0, avg: 0 };
    return {
      min: Math.min(...ptsArr),
      max: Math.max(...ptsArr),
      avg: ptsArr.reduce((a, b) => a + b, 0) / ptsArr.length
    };
  };

  const getLeagueLast3AvgCF = (isLive) => {
    if (posl3KolaCF.length === 0) return 0;
    let sum = 0, count = 0;
    Object.values(hracStats).forEach(u => {
      const bMap = isLive ? (u.bodyPoKolechLive || {}) : (u.bodyPoKolech || {});
      let uPts = 0;
      posl3KolaCF.forEach(k => { uPts += (bMap[k] || 0); });
      sum += uPts;
      count++;
    });
    return count > 0 ? (sum / count) : 0;
  };

  const spoctiFUTKartu = (email, isLiveMode = false) => {
    const stats = hracStats[email] || {};
    const uTips = stats.mapaTipuLocal || {};
    const odehrano = isLiveMode ? (stats.natipovaneVyhodnoceneLive || 0) : (stats.natipovaneVyhodnocene || 0);
    const nenatipovano = isLiveMode ? (stats.nenatipovaneVyhodnoceneLive || 0) : (stats.nenatipovaneVyhodnocene || 0);
    const presne = isLiveMode ? (stats.presneVysledkyCountLive || 0) : (stats.presneVysledkyCount || 0);
    const vyhranaKola = isLiveMode ? (vyhraVKolePocetLive[mapaPrezdivek[email]] || 0) : (vyhraVKolePocet[mapaPrezdivek[email]] || 0);
    const bodyKola = isLiveMode ? (stats.bodyPoKolechLive || {}) : (stats.bodyPoKolech || {});
    const maxRound = isLiveMode ? (stats.nejviceBoduVKoleLive || stats.nejviceBoduVKole || 0) : (stats.nejviceBoduVKole || 0);
    const bodyZiskane = isLiveMode ? (stats.celkemBoduLive || 0) : (stats.celkemBodu || 0);

    if (odehrano === 0) {
      return {
        ovr: 0,
        tier: 'bronze',
        archetype: '–',
        archetypeName: 'Nekalibrováno',
        stats: { pre: 0, odv: 0, clu: 0, sta: 0, for: 0, efe: 0 },
        badges: { streaks: 0, exacts: 0, draws: 0, maxRound: 0, roundWins: 0, perfektniKola: 0 },
        backSide: { totalMatches: 0, avgRoundPts: '0.0 b.', percentile: '–', favTendency: '–' }
      };
    }

    const lTotals = getLeagueTotalsCF(isLiveMode);
    let statEfe = 70;
    if (lTotals.max > lTotals.min) {
      if (bodyZiskane >= lTotals.avg) {
        const spread = Math.max(1, lTotals.max - lTotals.avg);
        statEfe = Math.round(70 + ((bodyZiskane - lTotals.avg) / spread) * 24);
      } else {
        const spread = Math.max(1, lTotals.avg - lTotals.min);
        statEfe = Math.round(50 + ((bodyZiskane - lTotals.min) / spread) * 20);
      }
    }
    statEfe = Math.min(99, Math.max(35, statEfe));

    const allUsersListCF = Object.values(hracStats);
    const totalLeaguePlayersCF = allUsersListCF.length;
    const worsePlayersCountCF = allUsersListCF.filter(p => (isLiveMode ? (p.celkemBoduLive || 0) : (p.celkemBodu || 0)) < bodyZiskane).length;
    const percentileValCF = totalLeaguePlayersCF > 1 ? Math.min(99, Math.max(1, Math.round((worsePlayersCountCF / (totalLeaguePlayersCF - 1)) * 100))) : 50;

    let exactCount = 0;
    let pureTendCount = 0;
    let smartTendCount = 0;
    let odvahaCount = 0;
    let odvahaTotal = 0;
    let tip1Count = 0, tipXCount = 0, tip2Count = 0;

    let topMatchesCount = 0;
    let topMatchesPoints = 0;

    Object.entries(lZapasy).forEach(([mId, z]) => {
      const tip = uTips[mId];
      if (!tip || tip.tip_domaci === undefined || tip.tip_domaci === null || String(tip.tip_domaci).trim() === '') return;

      const tD = parseInt(tip.tip_domaci, 10);
      const tH = parseInt(tip.tip_hoste, 10);
      if (isNaN(tD) || isNaN(tH)) return;

      odvahaTotal++;
      const consensus = zapasyConsensusCF[mId] || { p1: 0.33, pX: 0.33, p2: 0.33 };
      const oddsDom = z?.odds?.['1'] || z?.odds?.[1] || 0;
      const oddsHost = z?.odds?.['2'] || z?.odds?.[2] || 0;

      const isContrarian = (tD > tH && consensus.p1 < 0.22) || (tD === tH && consensus.pX < 0.22) || (tD < tH && consensus.p2 < 0.22);
      const isUnderdog = (tD > tH && oddsDom >= 2.9) || (tH > tD && oddsHost >= 2.9);
      const isDraw = (tD === tH);

      if (isDraw || isContrarian || isUnderdog) odvahaCount++;

      const jeDohranoNeboLive = (z.vysledek_domaci !== undefined && z.vysledek_domaci !== null) || z.apiStatus === "IN_PLAY" || z.apiStatus === "PAUSED";
      if (!jeDohranoNeboLive) return;

      if (tD > tH) tip1Count++;
      else if (tD === tH) tipXCount++;
      else tip2Count++;

      const rD = parseInt(z.vysledek_domaci !== undefined ? z.vysledek_domaci : 0, 10);
      const rH = parseInt(z.vysledek_hoste !== undefined ? z.vysledek_hoste : 0, 10);

      const isExact = (tD === rD && tH === rH && (!z.isPlayoff || rD !== rH || tip.postup === z.postup));
      const tipDiff = tD - tH;
      const realDiff = rD - rH;
      const isTend = (tipDiff > 0 && realDiff > 0) || (tipDiff < 0 && realDiff < 0) || (tipDiff === 0 && realDiff === 0);
      const isSmartTend = isTend && (tipDiff === realDiff || tD === rD || tH === rH);

      if (isExact) {
        exactCount++;
      } else if (isSmartTend) {
        smartTendCount++;
      } else if (isTend) {
        pureTendCount++;
      }

      if (z.isTopMatch) {
        topMatchesCount++;
        const ptsZ = vypocitejBodyZapasuLocal(tD, tH, rD, rH, tip.postup, z.postup, z.isPlayoff, z.isTopMatch);
        if (ptsZ > 0) topMatchesPoints += ptsZ;
      }
    });

    const exactRatio = odehrano > 0 ? (exactCount / odehrano) : 0;
    const smartRatio = odehrano > 0 ? (smartTendCount / odehrano) : 0;
    const pureRatio = odehrano > 0 ? (pureTendCount / odehrano) : 0;
    const exactPart = Math.min(38, (exactRatio / 0.28) * 38);
    const tendPart = Math.min(18, ((smartRatio * 0.7 + pureRatio * 0.4) / 0.45) * 18);
    const statPre = Math.min(99, Math.max(45, Math.round(44 + exactPart + tendPart)));

    const ratioOdv = odvahaTotal > 0 ? (odvahaCount / odvahaTotal) : 0;
    const statOdv = Math.min(99, Math.max(40, Math.round(42 + (ratioOdv / 0.45) * 45)));

    const tableBaseClu = 48 + (percentileValCF / 100) * 40;
    let statClu = Math.round(tableBaseClu);
    if (topMatchesCount > 0) {
      const avgPtsInTop = topMatchesPoints / topMatchesCount;
      const topPerfClu = Math.min(95, Math.max(45, 50 + (avgPtsInTop / 6) * 42));
      statClu = Math.min(99, Math.max(45, Math.round(tableBaseClu * 0.55 + topPerfClu * 0.45)));
    }

    let userLast3Pts = 0;
    posl3KolaCF.forEach(k => { userLast3Pts += (bodyKola[k] || 0); });
    const leagueAvg3 = getLeagueLast3AvgCF(isLiveMode);
    let statFor = 70;
    if (leagueAvg3 > 0) {
      const ratioFor = userLast3Pts / leagueAvg3;
      if (ratioFor >= 1.0) {
        statFor = Math.round(70 + Math.min(25, (ratioFor - 1.0) * 45));
      } else {
        statFor = Math.round(70 - Math.min(25, (1.0 - ratioFor) * 40));
      }
    }
    statFor = Math.min(99, Math.max(45, statFor));

    const ptsKola5 = posl5KolaCF.map(k => bodyKola[k] !== undefined ? bodyKola[k] : 0);
    let statSta = 70;
    if (ptsKola5.length > 0) {
      const mean5 = ptsKola5.reduce((a, b) => a + b, 0) / ptsKola5.length;
      const variance5 = ptsKola5.reduce((a, b) => a + Math.pow(b - mean5, 2), 0) / ptsKola5.length;
      const sd5 = Math.sqrt(variance5);
      const cv5 = mean5 > 0 ? (sd5 / mean5) : 1.5;

      const leagueAvgRound = lTotals.avg / Math.max(1, odehranaKolaKliceCF.length);
      const meanRatio = leagueAvgRound > 0 ? (mean5 / leagueAvgRound) : 1.0;

      const cvPenalty = Math.min(30, cv5 * 25);
      const performanceBonus = Math.min(20, Math.max(-20, (meanRatio - 1.0) * 25));
      const missedPenalty = nenatipovano * 3;

      statSta = Math.min(99, Math.max(40, Math.round(75 - cvPenalty + performanceBonus - missedPenalty)));
    }

    let curStreak = 0;
    let maxStreak = 0;
    let trefeneRemizy = 0;
    odehraneZapasyChronoCF.forEach(z => {
      const uTip = uTips[z.id || z.matchId];
      if (!uTip || uTip.tip_domaci === undefined || uTip.tip_domaci === null || String(uTip.tip_domaci).trim() === '') {
        curStreak = 0;
        return;
      }
      const tD = parseInt(uTip.tip_domaci, 10);
      const tH = parseInt(uTip.tip_hoste, 10);
      const rD = parseInt(z.vysledek_domaci, 10);
      const rH = parseInt(z.vysledek_hoste, 10);
      if (isNaN(tD) || isNaN(tH) || isNaN(rD) || isNaN(rH)) {
        curStreak = 0;
        return;
      }

      if (tD === tH && rD === rH) {
        trefeneRemizy++;
      }

      const b = vypocitejBodyZapasuLocal(tD, tH, rD, rH, uTip.postup, z.postup, z.isPlayoff, z.isTopMatch);
      if (b > 0) {
        curStreak++;
        if (curStreak > maxStreak) maxStreak = curStreak;
      } else {
        curStreak = 0;
      }
    });

    const ovr = Math.min(99, Math.max(50, Math.round(
      statPre * 0.25 +
      statEfe * 0.20 +
      statFor * 0.20 +
      statClu * 0.15 +
      statSta * 0.10 +
      statOdv * 0.10
    )));

    let tier = 'bronze';
    if (ovr >= 90) tier = 'elite';
    else if (ovr >= 80) tier = 'gold';
    else if (ovr >= 70) tier = 'silver';

    const attrMap = [
      { code: 'ODS', name: 'Odstřelovač', val: statPre },
      { code: 'STR', name: 'Stroj na body', val: statEfe },
      { code: 'PRE', name: 'Predátor', val: statFor },
      { code: 'CLU', name: 'Klíčový hráč', val: statClu },
      { code: 'TAK', name: 'Taktik', val: statSta },
      { code: 'HAZ', name: 'Odvážlivec', val: statOdv }
    ];
    attrMap.sort((a, b) => b.val - a.val);
    const dominant = attrMap[0].val > 0 ? attrMap[0] : { code: '–', name: 'Nekalibrováno' };

    const totalTend = tip1Count + tipXCount + tip2Count;
    let favTendency = '–';
    if (totalTend > 0) {
      const raw = [
        { key: '1', count: tip1Count, exact: (tip1Count / totalTend) * 100 },
        { key: 'X', count: tipXCount, exact: (tipXCount / totalTend) * 100 },
        { key: '2', count: tip2Count, exact: (tip2Count / totalTend) * 100 }
      ];

      raw.forEach(item => {
        item.floor = Math.floor(item.exact);
        item.rem = item.exact - item.floor;
      });

      const sumFloor = raw.reduce((sum, item) => sum + item.floor, 0);
      const deficit = 100 - sumFloor;

      const sortedByRem = [...raw].sort((a, b) => (b.rem - a.rem) || (b.count - a.count));
      for (let i = 0; i < deficit; i++) {
        sortedByRem[i].floor += 1;
      }

      const pMap = {};
      raw.forEach(item => { pMap[item.key] = item.floor; });
      favTendency = `1: ${pMap['1']} % | X: ${pMap['X']} % | 2: ${pMap['2']} %`;
    }

    const numRoundsCF = Math.max(1, odehranaKolaKliceCF.length);
    const avgRoundPts = (bodyZiskane / numRoundsCF).toFixed(1);
    return {
      ovr: ovr,
      tier: tier,
      archetype: dominant.code,
      archetypeName: dominant.name,
      stats: {
        pre: statPre,
        odv: statOdv,
        clu: statClu,
        sta: statSta,
        for: statFor,
        efe: statEfe
      },
      badges: {
        streaks: maxStreak,
        exacts: presne,
        draws: trefeneRemizy,
        maxRound: maxRound,
        roundWins: vyhranaKola,
        perfektniKola: (perfektniKolaSeznam.filter(pk => pk.uid === mapaEmailToUid[email]) || []).length
      },
      backSide: {
        totalMatches: odehrano,
        avgRoundPts: `${avgRoundPts} b.`,
        percentile: `Lepší než ${percentileValCF} % tipérů`,
        favTendency: favTendency
      }
    };
  };

  zebricekPole.forEach(p => {
    p.futCard = spoctiFUTKartu(p.email, false);
  });
  zebricekLivePole.forEach(p => {
    p.futCard = spoctiFUTKartu(p.email, true);
  });

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
    otevrenaKolaStatistikyLive: otevrenaKolaStatistikyLive,
    otevrenaKolaSeznam: otevrenaKolaArr,
    aktivniKoloText: aktivniKolo,
    kolaSouhrn: kolaSouhrn,
    radar: radarStatsCF,
    aktualizovano: new Date().toISOString()
  };

  const r2UploadPromises = [];

  r2UploadPromises.push(r2Client.send(new PutObjectCommand({
    Bucket: "tipni-to-data",
    Key: `sezony/${sezonaId}/${ligaKlic}/leaderboard.json`,
    Body: JSON.stringify(leaderboardJson),
    ContentType: "application/json",
    CacheControl: "no-cache, no-store, must-revalidate"
  })));

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

  try {
    const vsechnyLigySeznam = ["Chance Liga", "Premier League", "Liga mistrů", "Tipsport Extraliga", "MS v hokeji", "MS ve fotbale"];
    const playersMap = {};

    for (const lName of vsechnyLigySeznam) {
      let lb = null;
      if (lName === leagueName) {
        lb = leaderboardJson;
      } else {
        const lKlic = lName.replace(/ /g, "_");
        try {
          const res = await r2Client.send(new GetObjectCommand({
            Bucket: "tipni-to-data",
            Key: `sezony/${sezonaId}/${lKlic}/leaderboard.json`
          }));
          const txt = await res.Body.transformToString();
          lb = JSON.parse(txt);
        } catch(e) {}
      }

      if (lb && lb.zebricek) {
        lb.zebricek.forEach(p => {
          if (!p.uid || !p.futCard) return;
          const odehrano = (p.natipovaneVyhodnocene || 0) + (p.nenatipovaneVyhodnocene || 0);
          if (odehrano === 0) return;

          if (!playersMap[p.uid]) {
            playersMap[p.uid] = {
              uid: p.uid,
              nickname: p.nickname || 'Hráč',
              leaguesCards: []
            };
          }
          playersMap[p.uid].leaguesCards.push({
            leagueName: lName,
            futCard: p.futCard
          });
        });
      }
    }

    const playersList = Object.values(playersMap).map(p => {
      const count = p.leaguesCards.length;
      const sumOvr = p.leaguesCards.reduce((acc, c) => acc + (c.futCard.ovr || 0), 0);
      const rawAvg = sumOvr / count;

      let koef = 1.0;
      if (count === 1) koef = 0.97;
      else if (count === 2) koef = 0.99;
      else if (count === 3) koef = 1.00;
      else if (count === 4) koef = 1.01;
      else if (count >= 5) koef = 1.02;

      const masterOvr = Math.min(99, Math.round(rawAvg * koef));

      let bestLeague = p.leaguesCards[0].leagueName;
      let maxOvr = -1;
      let sumPre = 0, sumOdv = 0, sumClu = 0, sumSta = 0, sumFor = 0, sumEfe = 0;
      let maxStreak = 0, sumExacts = 0, sumDraws = 0, maxRound = 0, sumMatches = 0;
      let sumAvgPts = 0;

      p.leaguesCards.forEach(c => {
        const fc = c.futCard;
        if ((fc.ovr || 0) > maxOvr) {
          maxOvr = fc.ovr;
          bestLeague = c.leagueName;
        }
        sumPre += (fc.stats?.pre || 60);
        sumOdv += (fc.stats?.odv || 60);
        sumClu += (fc.stats?.clu || 60);
        sumSta += (fc.stats?.sta || 60);
        sumFor += (fc.stats?.for || 60);
        sumEfe += (fc.stats?.efe || 60);

        if ((fc.badges?.streaks || 0) > maxStreak) maxStreak = fc.badges.streaks;
        sumExacts += (fc.badges?.exacts || 0);
        sumDraws += (fc.badges?.draws || 0);
        if ((fc.badges?.maxRound || 0) > maxRound) maxRound = fc.badges.maxRound;
        sumMatches += (fc.backSide?.totalMatches || 0);
        sumAvgPts += parseFloat(fc.backSide?.avgRoundPts || 0) || 0;
      });

      const bestCard = p.leaguesCards.find(c => c.leagueName === bestLeague)?.futCard || p.leaguesCards[0].futCard;

      let tier = 'bronze';
      if (masterOvr >= 90) tier = 'elite';
      else if (masterOvr >= 80) tier = 'gold';
      else if (masterOvr >= 70) tier = 'silver';

      return {
        uid: p.uid,
        nickname: p.nickname,
        masterOvr,
        tier,
        archetype: bestCard.archetype || 'TAK',
        archetypeName: bestCard.archetypeName || 'Taktik',
        specialization: `Specializace: ${bestLeague}`,
        bestLeague,
        leaguesCount: count,
        stats: {
          pre: Math.round(sumPre / count),
          odv: Math.round(sumOdv / count),
          clu: Math.round(sumClu / count),
          sta: Math.round(sumSta / count),
          for: Math.round(sumFor / count),
          efe: Math.round(sumEfe / count)
        },
        badges: {
          exacts: sumExacts,
          streaks: maxStreak,
          draws: sumDraws,
          maxRound: maxRound
        },
        backSide: {
          totalMatches: sumMatches,
          avgRoundPts: `${(sumAvgPts / count).toFixed(1)} b.`,
          favTendency: bestCard.backSide?.favTendency || '–'
        }
      };
    });

    playersList.sort((a, b) => b.masterOvr - a.masterOvr || a.nickname.localeCompare(b.nickname, 'cs'));

    const byLeagueMap = {};
    for (const lName of vsechnyLigySeznam) {
      let lb = null;
      if (lName === leagueName) {
        lb = leaderboardJson;
      } else {
        const lKlic = lName.replace(/ /g, "_");
        try {
          const res = await r2Client.send(new GetObjectCommand({
            Bucket: "tipni-to-data",
            Key: `sezony/${sezonaId}/${lKlic}/leaderboard.json`
          }));
          const txt = await res.Body.transformToString();
          lb = JSON.parse(txt);
        } catch(e) {}
      }

      if (lb && lb.zebricek) {
        const leaguePlayers = [];
        lb.zebricek.forEach(p => {
          if (!p.uid || !p.futCard) return;
          const odehrano = (p.natipovaneVyhodnocene || 0) + (p.nenatipovaneVyhodnocene || 0);
          if (odehrano === 0) return;

          leaguePlayers.push({
            uid: p.uid,
            nickname: p.nickname || 'Hráč',
            ovr: p.futCard.ovr || 60,
            tier: p.futCard.tier || 'bronze',
            archetype: p.futCard.archetype || 'TAK',
            archetypeName: p.futCard.archetypeName || 'Taktik',
            points: p.celkemBodu || 0,
            matches: odehrano
          });
        });

        if (leaguePlayers.length > 0) {
          leaguePlayers.sort((a, b) => b.ovr - a.ovr || b.points - a.points || a.nickname.localeCompare(b.nickname, 'cs'));
          byLeagueMap[lName] = leaguePlayers;
        }
      }
    }

    await r2Client.send(new PutObjectCommand({
      Bucket: "tipni-to-data",
      Key: `sezony/${sezonaId}/hall_of_fame.json`,
      Body: JSON.stringify({ all: playersList, byLeague: byLeagueMap, aktualizovano: new Date().toISOString() }, null, 2),
      ContentType: "application/json",
      CacheControl: "no-cache, no-store, must-revalidate"
    }));
  } catch (hofErr) {
    console.warn("Nepodařilo se vygenerovat hall_of_fame.json na R2:", hofErr.message);
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
  await cinkniRtdbMajak(leagueName, "all");
}

// 👑 FUNKCE 3: Loutkovodič (Autonomní okamžitý zápis do DB + R2 s delta aktualizací)
const saveProxyDataCF = onCall({ 
  cors: true,
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze prověřený administrátor smí ukládat data přes loutkovodiče!");
  }

  const { targetUid, targetEmail, leagueName, vitez, strelec, tipyMapa } = request.data;
  const sezonaId = request.data.sezonaId || "2026_2027";
  const { kanadske } = request.data;
  const { updateBonus } = request.data;

  try {
    const userSezonaRef = db.collection("users").doc(targetUid).collection("sezony").doc(sezonaId);
    const ligaKlic = leagueName.replace(/ /g, "_");
    
    const dotUpdateMap = {};

    if (updateBonus === true) {
      if (typeof vitez === "string") dotUpdateMap[`souteze.${ligaKlic}.bonusy.vitez`] = vitez.trim();
      if (typeof strelec === "string") dotUpdateMap[`souteze.${ligaKlic}.bonusy.strelec`] = strelec.trim();
      if (typeof kanadske === "string") dotUpdateMap[`souteze.${ligaKlic}.bonusy.kanadske`] = kanadske.trim();
      dotUpdateMap[`souteze.${ligaKlic}.bonusy.userId`] = targetUid;
      dotUpdateMap[`souteze.${ligaKlic}.bonusy.userEmail`] = targetEmail;
    }

    const dotceneMatchIds = tipyMapa ? Object.keys(tipyMapa) : [];
    for (const matchId of dotceneMatchIds) {
      const tipData = tipyMapa[matchId];
      if (tipData.isDeleted) {
        dotUpdateMap[`souteze.${ligaKlic}.tipy.${matchId}`] = admin.firestore.FieldValue.delete();
      } else {
        dotUpdateMap[`souteze.${ligaKlic}.tipy.${matchId}`] = {
          userId: targetUid,
          userEmail: targetEmail,
          matchId: matchId,
          tip_domaci: parseInt(tipData.tip_domaci, 10),
          tip_hoste: parseInt(tipData.tip_hoste, 10),
          postup: tipData.postup || ""
        };
      }
    }

    const docSnap = await userSezonaRef.get();
    if (docSnap.exists) {
      await userSezonaRef.update(dotUpdateMap);
    } else {
      await userSezonaRef.set(dotUpdateMap, { merge: true });
    }

    await spustVnitrniPrepocetLigy(leagueName, sezonaId, dotceneMatchIds);

    return { success: true, message: "Data byla přes loutkovodiče úspěšně naočkována a okamžitě synchronizována!" };
  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});

// 👑 FUNKCE 4: Generální rekalkulace žebříčku
const recalculateLeaderboardCF = onCall({ 
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
const transferUserDataCF = onCall({ cors: true }, async (request) => {
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
    batch.delete(db.collection("users").doc(oldUid));
    batch.delete(db.collection("uzivatele_online").doc(oldUid));

    await batch.commit();

    try {
      await auth.deleteUser(oldUid);
    } catch (authErr) {
      console.warn("Uživatel v Auth již neexistoval nebo nelze smazat:", authErr.message);
    }

    return { 
      success: true, 
      message: `Tipy a body byly úspěšně přelity z ID ${oldUid} na nové ID ${newUid}! Starý šuplík vymazán.` 
    };

  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});

// 📅 FUNKCE 10: Okamžitá změna data zápasu bez závislosti na botovi
const updateMatchDateCF = onCall({
  cors: true,
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze administrátor smí měnit termín zápasu!");
  }

  const { leagueName, matchId, newDateIso } = request.data;
  const sezonaId = request.data.sezonaId || DEFAULT_SEASON_ID;

  if (!leagueName || !matchId || !newDateIso) {
    throw new HttpsError("invalid-argument", "Chybí název ligy, ID zápasu nebo nové datum!");
  }

  try {
    const ligaKlic = leagueName.replace(/ /g, "_");
    const parsedDate = new Date(newDateIso);

    const matchRef = db.collection("ligy").doc(leagueName)
      .collection("sezony").doc(sezonaId)
      .collection("zapasy").doc(matchId);

    await matchRef.update({
      datum: admin.firestore.Timestamp.fromDate(parsedDate)
    });

    const r2Client = new S3Client({
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      region: "auto",
    });

    const r2Key = `sezony/${sezonaId}/${ligaKlic}/rozpis.json`;
    let rozpisData = null;

    try {
      const getRes = await r2Client.send(new GetObjectCommand({
        Bucket: "tipni-to-data",
        Key: r2Key
      }));
      const rawText = await getRes.Body.transformToString();
      rozpisData = JSON.parse(rawText);
    } catch (e) {
      console.warn("Nepodařilo se stáhnout stávající rozpis.json z R2:", e.message);
    }

    if (rozpisData && rozpisData.zapasyMapa && rozpisData.zapasyMapa[matchId]) {
      rozpisData.zapasyMapa[matchId].datum = newDateIso;
      rozpisData.aktualizovano = new Date().toISOString();

      await r2Client.send(new PutObjectCommand({
        Bucket: "tipni-to-data",
        Key: r2Key,
        Body: JSON.stringify(rozpisData),
        ContentType: "application/json",
        CacheControl: "no-cache, no-store, must-revalidate"
      }));
    }

    const pulsRef = db.collection("ligy").doc(leagueName).collection("stav").doc("puls");
    await pulsRef.set({
      verzeRozpisu: admin.firestore.FieldValue.increment(1),
      aktualizovano: admin.firestore.Timestamp.now()
    }, { merge: true });

    await cinkniRtdbMajak(leagueName, "rozpis");

    return { success: true, message: "Termín zápasu bezpečně upraven a synchronizován!" };
  } catch (error) {
    console.error("Chyba při změně data zápasu:", error);
    throw new HttpsError("internal", error.message);
  }
});

// 📊 FUNKCE 11: Ruční zápis kurzů zápasu (Firestore + rozpis.json + central_odds.json)
const saveMatchOddsCF = onCall({
  cors: true,
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze administrátor smí zadávat kurzy zápasů!");
  }

  const { leagueName, matchId, odds } = request.data;
  const sezonaId = request.data.sezonaId || DEFAULT_SEASON_ID;

  if (!leagueName || !matchId || !odds || !odds["1"] || !odds["2"]) {
    throw new HttpsError("invalid-argument", "Chybí název ligy, ID zápasu nebo platné kurzy!");
  }

  try {
    const ligaKlic = leagueName.replace(/ /g, "_");

    const matchRef = db.collection("ligy").doc(leagueName)
      .collection("sezony").doc(sezonaId)
      .collection("zapasy").doc(matchId);

    const matchDoc = await matchRef.get();
    const matchData = matchDoc.exists ? matchDoc.data() : {};

    await matchRef.set({ odds: odds }, { merge: true });

    const r2Client = new S3Client({
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      region: "auto",
    });

    const rozpisKey = `sezony/${sezonaId}/${ligaKlic}/rozpis.json`;
    try {
      const getRes = await r2Client.send(new GetObjectCommand({
        Bucket: "tipni-to-data",
        Key: rozpisKey
      }));
      const rawText = await getRes.Body.transformToString();
      const rozpisObj = JSON.parse(rawText);

      if (rozpisObj && rozpisObj.zapasyMapa && rozpisObj.zapasyMapa[matchId]) {
        rozpisObj.zapasyMapa[matchId].odds = odds;
        rozpisObj.aktualizovano = new Date().toISOString();

        await r2Client.send(new PutObjectCommand({
          Bucket: "tipni-to-data",
          Key: rozpisKey,
          Body: JSON.stringify(rozpisObj),
          ContentType: "application/json",
          CacheControl: "no-cache, no-store, must-revalidate"
        }));
      }
    } catch (e) {
      console.warn("Nepodařilo se upravit rozpis.json na R2:", e.message);
    }

    const centralOddsKey = `sezony/${sezonaId}/central_odds.json`;
    try {
      let centralOddsObj = {};
      try {
        const getOddsRes = await r2Client.send(new GetObjectCommand({
          Bucket: "tipni-to-data",
          Key: centralOddsKey
        }));
        const rawOddsText = await getOddsRes.Body.transformToString();
        centralOddsObj = JSON.parse(rawOddsText);
      } catch (err) {}

      if (!centralOddsObj[leagueName]) centralOddsObj[leagueName] = {};
      centralOddsObj[leagueName][matchId] = odds;

      let datumIso = "";
      if (matchData.datum) {
        datumIso = matchData.datum.toDate ? matchData.datum.toDate().toISOString().split("T")[0] : new Date(matchData.datum.seconds ? matchData.datum.seconds * 1000 : matchData.datum).toISOString().split("T")[0];
      }
      if (matchData.domaci && matchData.hoste && datumIso) {
        const datedKey = `${String(matchData.domaci).toLowerCase().trim()} vs ${String(matchData.hoste).toLowerCase().trim()}_${datumIso}`;
        centralOddsObj[leagueName][datedKey] = odds;
      }
      if (matchData.domaci && matchData.hoste) {
        delete centralOddsObj[leagueName][`${String(matchData.domaci).toLowerCase().trim()} vs ${String(matchData.hoste).toLowerCase().trim()}`];
      }

      await r2Client.send(new PutObjectCommand({
        Bucket: "tipni-to-data",
        Key: centralOddsKey,
        Body: JSON.stringify(centralOddsObj, null, 2),
        ContentType: "application/json"
      }));
    } catch (e) {
      console.warn("Nepodařilo se zapsat do central_odds.json na R2:", e.message);
    }

    const pulsRef = db.collection("ligy").doc(leagueName).collection("stav").doc("puls");
    await pulsRef.set({
      verzeRozpisu: admin.firestore.FieldValue.increment(1),
      aktualizovano: admin.firestore.Timestamp.now()
    }, { merge: true });

    await cinkniRtdbMajak(leagueName, "rozpis");

    return { success: true, message: "Kurzy bezpečně zapsány a synchronizovány!" };
  } catch (error) {
    console.error("Chyba při ručním zápisu kurzů:", error);
    throw new HttpsError("internal", error.message);
  }
});

// 🗑️ FUNKCE 11b: Ruční smazání kurzu zápasu (Firestore + rozpis.json + central_odds.json)
const deleteMatchOddsCF = onCall({
  cors: true,
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze administrátor smí mazat kurzy!");
  }

  const { leagueName, matchId } = request.data;
  const sezonaId = request.data.sezonaId || DEFAULT_SEASON_ID;

  if (!leagueName || !matchId) {
    throw new HttpsError("invalid-argument", "Chybí název ligy nebo ID zápasu!");
  }

  try {
    const ligaKlic = leagueName.replace(/ /g, "_");

    const matchRef = db.collection("ligy").doc(leagueName)
      .collection("sezony").doc(sezonaId)
      .collection("zapasy").doc(matchId);

    const matchDoc = await matchRef.get();
    const matchData = matchDoc.exists ? matchDoc.data() : {};
    await matchRef.update({ odds: admin.firestore.FieldValue.delete() }).catch(() => {});

    const r2Client = new S3Client({
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      region: "auto",
    });

    const rozpisKey = `sezony/${sezonaId}/${ligaKlic}/rozpis.json`;
    try {
      const getRes = await r2Client.send(new GetObjectCommand({ Bucket: "tipni-to-data", Key: rozpisKey }));
      const rozpisObj = JSON.parse(await getRes.Body.transformToString());
      if (rozpisObj && rozpisObj.zapasyMapa && rozpisObj.zapasyMapa[matchId]) {
        delete rozpisObj.zapasyMapa[matchId].odds;
        rozpisObj.aktualizovano = new Date().toISOString();
        await r2Client.send(new PutObjectCommand({
          Bucket: "tipni-to-data",
          Key: rozpisKey,
          Body: JSON.stringify(rozpisObj),
          ContentType: "application/json",
          CacheControl: "no-cache, no-store, must-revalidate"
        }));
      }
    } catch (e) {
      console.warn("Chyba mazání z rozpis.json:", e.message);
    }

    const centralOddsKey = `sezony/${sezonaId}/central_odds.json`;
    try {
      const getOddsRes = await r2Client.send(new GetObjectCommand({ Bucket: "tipni-to-data", Key: centralOddsKey }));
      const centralOddsObj = JSON.parse(await getOddsRes.Body.transformToString());

      if (centralOddsObj[leagueName]) {
        delete centralOddsObj[leagueName][matchId];

        let datumIso = "";
        if (matchData.datum) {
          datumIso = matchData.datum.toDate ? matchData.datum.toDate().toISOString().split("T")[0] : new Date(matchData.datum.seconds ? matchData.datum.seconds * 1000 : matchData.datum).toISOString().split("T")[0];
        }
        if (matchData.domaci && matchData.hoste) {
          const dNorm = String(matchData.domaci).toLowerCase().trim();
          const hNorm = String(matchData.hoste).toLowerCase().trim();
          delete centralOddsObj[leagueName][`${dNorm} vs ${hNorm}`];
          if (datumIso) delete centralOddsObj[leagueName][`${dNorm} vs ${hNorm}_${datumIso}`];
        }

        await r2Client.send(new PutObjectCommand({
          Bucket: "tipni-to-data",
          Key: centralOddsKey,
          Body: JSON.stringify(centralOddsObj, null, 2),
          ContentType: "application/json"
        }));
      }
    } catch (e) {
      console.warn("Chyba mazání z central_odds.json:", e.message);
    }

    const pulsRef = db.collection("ligy").doc(leagueName).collection("stav").doc("puls");
    await pulsRef.set({
      verzeRozpisu: admin.firestore.FieldValue.increment(1),
      aktualizovano: admin.firestore.Timestamp.now()
    }, { merge: true });

    await cinkniRtdbMajak(leagueName, "rozpis");

    return { success: true, message: "Kurz byl úspěšně vymazán ze všech systémů!" };
  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});

// 🗑️ FUNKCE 12: Bezpečné smazání zápasu z Firestore i rozpis.json na R2 + signál pro mobily
const deleteMatchCF = onCall({
  cors: true,
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze administrátor smí mazat zápasy!");
  }

  const { leagueName, matchId } = request.data;
  const sezonaId = request.data.sezonaId || DEFAULT_SEASON_ID;

  if (!leagueName || !matchId) {
    throw new HttpsError("invalid-argument", "Chybí název ligy nebo ID zápasu ke smazání!");
  }

  try {
    const ligaKlic = leagueName.replace(/ /g, "_");

    const matchRef = db.collection("ligy").doc(leagueName)
      .collection("sezony").doc(sezonaId)
      .collection("zapasy").doc(matchId);
    await matchRef.delete();

    const r2Client = new S3Client({
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      region: "auto",
    });

    const rozpisKey = `sezony/${sezonaId}/${ligaKlic}/rozpis.json`;
    try {
      const getRes = await r2Client.send(new GetObjectCommand({
        Bucket: "tipni-to-data",
        Key: rozpisKey
      }));
      const rawText = await getRes.Body.transformToString();
      const rozpisObj = JSON.parse(rawText);

      if (rozpisObj && rozpisObj.zapasyMapa && rozpisObj.zapasyMapa[matchId]) {
        delete rozpisObj.zapasyMapa[matchId];
        rozpisObj.aktualizovano = new Date().toISOString();

        await r2Client.send(new PutObjectCommand({
          Bucket: "tipni-to-data",
          Key: rozpisKey,
          Body: JSON.stringify(rozpisObj),
          ContentType: "application/json",
          CacheControl: "no-cache, no-store, must-revalidate"
        }));
      }
    } catch (e) {
      console.warn("Nepodařilo se vymazat zápas z rozpis.json na R2:", e.message);
    }

    const pulsRef = db.collection("ligy").doc(leagueName).collection("stav").doc("puls");
    await pulsRef.set({
      verzeRozpisu: admin.firestore.FieldValue.increment(1),
      aktualizovano: admin.firestore.Timestamp.now()
    }, { merge: true });

    await cinkniRtdbMajak(leagueName, "rozpis");

    return { success: true, message: "Zápas byl úspěšně vymazán z Firestore i R2!" };
  } catch (error) {
    console.error("Chyba při mazání zápasu:", error);
    throw new HttpsError("internal", error.message);
  }
});

// ⏳ FUNKCE 13: Ruční odložení / vrácení zápasu do hry s ochranou proti přepsání botem
const toggleMatchPostponedCF = onCall({
  cors: true,
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze administrátor smí měnit stav odložení zápasu!");
  }

  const { leagueName, matchId, isPostponed } = request.data;
  const sezonaId = request.data.sezonaId || DEFAULT_SEASON_ID;

  if (!leagueName || !matchId) {
    throw new HttpsError("invalid-argument", "Chybí název ligy nebo ID zápasu!");
  }

  try {
    const ligaKlic = leagueName.replace(/ /g, "_");
    const newStatus = isPostponed ? "POSTPONED" : "SCHEDULED";

    const matchRef = db.collection("ligy").doc(leagueName)
      .collection("sezony").doc(sezonaId)
      .collection("zapasy").doc(matchId);

    await matchRef.update({
      apiStatus: newStatus,
      manuallyPostponed: Boolean(isPostponed)
    });

    const r2Client = new S3Client({
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      region: "auto",
    });

    const rozpisKey = `sezony/${sezonaId}/${ligaKlic}/rozpis.json`;
    try {
      const getRes = await r2Client.send(new GetObjectCommand({
        Bucket: "tipni-to-data",
        Key: rozpisKey
      }));
      const rawText = await getRes.Body.transformToString();
      const rozpisObj = JSON.parse(rawText);

      if (rozpisObj && rozpisObj.zapasyMapa && rozpisObj.zapasyMapa[matchId]) {
        rozpisObj.zapasyMapa[matchId].apiStatus = newStatus;
        rozpisObj.zapasyMapa[matchId].manuallyPostponed = Boolean(isPostponed);
        rozpisObj.aktualizovano = new Date().toISOString();

        await r2Client.send(new PutObjectCommand({
          Bucket: "tipni-to-data",
          Key: rozpisKey,
          Body: JSON.stringify(rozpisObj),
          ContentType: "application/json",
          CacheControl: "no-cache, no-store, must-revalidate"
        }));
      }
    } catch (e) {
      console.warn("Nepodařilo se upravit stav odložení v rozpis.json na R2:", e.message);
    }

    const pulsRef = db.collection("ligy").doc(leagueName).collection("stav").doc("puls");
    await pulsRef.set({
      verzeRozpisu: admin.firestore.FieldValue.increment(1),
      aktualizovano: admin.firestore.Timestamp.now()
    }, { merge: true });

    await cinkniRtdbMajak(leagueName, "rozpis");

    return { success: true, message: `Stav zápasu úspěšně změněn na ${newStatus}!` };
  } catch (error) {
    console.error("Chyba při změně stavu odložení:", error);
    throw new HttpsError("internal", error.message);
  }
});

// 🚚 FUNKCE 14: Jednorázová migrace všech uživatelů do RTDB admin_roster
const syncAllUsersToRtdbCF = onCall({ cors: true }, async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze prověřený admin smí synchronizovat uživatele!");
  }

  try {
    const usersSnap = await db.collection("users").get();
    const rtdb = getDatabase();
    const updates = {};

    usersSnap.forEach(uDoc => {
      const u = uDoc.data() || {};
      updates[uDoc.id] = {
        nickname: u.nickname || 'Nový Hráč',
        email: u.email || '',
        leagues: u.leagues || [],
        isAdmin: u.isAdmin === true,
        isSuperAdmin: u.isSuperAdmin === true,
        showSurveys: u.showSurveys !== undefined ? u.showSurveys : true,
        notifyUntipped: u.notifyUntipped === true,
        lastSeen: u.lastSeen?.toMillis ? u.lastSeen.toMillis() : (u.lastSeen || null)
      };
    });

    await rtdb.ref("admin_roster").set(updates);
    return { success: true, count: usersSnap.size, message: `Úspěšně přeneseno ${usersSnap.size} uživatelů do RTDB (0 reads režim aktivní)!` };
  } catch (err) {
    throw new HttpsError("internal", err.message);
  }
});

// 🗑️ FUNKCE 15: Samostatné smazání a anonymizace vlastního účtu (GDPR Google Play)
const deleteMyAccountCF = onCall({ cors: true }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Musíš být přihlášen!");
  }

  const uid = request.auth.uid;

  try {
    const shortId = uid.slice(0, 4).toUpperCase();
    const anonNick = `Bývalý hráč #${shortId}`;
    const anonEmail = `deleted_${uid.slice(0, 8)}@deleted.local`;

    // 1. Smazání z Firebase Auth (okamžitá ztráta přihlášení)
    try {
      await auth.deleteUser(uid);
    } catch (authErr) {
      console.warn("Uživatel v Auth již neexistoval:", authErr.message);
    }

    // 2. Smazání z RTDB (admin_roster a online status)
    try {
      const rtdb = getDatabase();
      await rtdb.ref(`admin_roster/${uid}`).remove();
      await rtdb.ref(`status/${uid}`).remove();
    } catch (rtdbErr) {
      console.warn("RTDB remove varování:", rtdbErr.message);
    }

    // 3. Odstranění z online tabulky Firestore
    await db.collection("uzivatele_online").doc(uid).delete().catch(() => {});

    // 4. Anonymizace profilu ve Firestore (body v sezónách zůstávají zafixované)
    await db.collection("users").doc(uid).update({
      nickname: anonNick,
      email: anonEmail,
      fcmTokens: admin.firestore.FieldValue.delete(),
      pushToken: admin.firestore.FieldValue.delete(),
      notifyUntipped: false,
      showSurveys: false,
      isDeleted: true,
      deletedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, message: "Tvůj účet byl trvale smazán a data anonymizována." };
  } catch (error) {
    console.error("Chyba při mazání vlastního účtu:", error);
    throw new HttpsError("internal", error.message);
  }
});

module.exports = {
  manageUserPermissionsCF,
  purgeUserAbsoluteCF,
  spustVnitrniPrepocetLigy,
  saveProxyDataCF,
  recalculateLeaderboardCF,
  transferUserDataCF,
  updateMatchDateCF,
  saveMatchOddsCF,
  deleteMatchOddsCF,
  deleteMatchCF,
  toggleMatchPostponedCF,
  syncAllUsersToRtdbCF,
  deleteMyAccountCF
};