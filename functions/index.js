const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

// 👑 FUNKCE 1: Bezpečné vypálení cejchů (Claims) a zápis do Firestore
exports.manageUserPermissionsCF = onCall(async (request) => {
  // Bezpečnostní prověření: Akci smí provést pouze přihlášený Admin nebo Super Admin
  if (!request.auth || (!request.auth.token.isAdmin && request.auth.uid !== 'tfLmfp1twLbcFsxWrgNkZ7iQRC22')) {
    throw new HttpsError("permission-denied", "Pouze prověřený admin smí měnit ligy a práva!");
  }

  const { targetUid, isAdminRole, leagues } = request.data;

  try {
    // 1. Zápis do Firestore pro potřeby UI
    await db.collection("users").doc(targetUid).update({
      isAdmin: isAdminRole,
      leagues: leagues
    });

    // 2. Vypálení cejchů přímo do šifrovaného JWT tokenu uživatele
    await auth.setCustomUserClaims(targetUid, {
      isAdmin: isAdminRole,
      leagues: leagues
    });

    return { success: true, message: "Cejchy bezpečně vypáleny do tokenu!" };
  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});

// 🌪️ FUNKCE 2: Nuclear Purge - Totální vymazání uživatele z celého vesmíru (Sezónní upgrade)
exports.purgeUserAbsoluteCF = onCall(async (request) => {
  if (!request.auth || request.auth.uid !== 'tfLmfp1twLbcFsxWrgNkZ7iQRC22') {
    throw new HttpsError("permission-denied", "Tento demoliční spínač smí zmáčknout pouze Super Admin!");
  }

  const { targetUid } = request.data;

  try {
    const batch = db.batch();
    const sezonaId = "2025_2026"; // Vyčistíme herní šuplík pro aktivní sezónu

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
  if (!request.auth || request.auth.uid !== 'tfLmfp1twLbcFsxWrgNkZ7iQRC22') {
    throw new HttpsError("permission-denied", "Tento vládní spínač smí mačkat pouze Super Admin!");
  }

  const { targetUid, targetEmail, leagueName, vitez, strelec, tipyMapa } = request.data;
  const sezonaId = request.data.sezonaId || "2025_2026";

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
exports.recalculateLeaderboardCF = onCall({ cors: true }, async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && request.auth.uid !== 'tfLmfp1twLbcFsxWrgNkZ7iQRC22')) {
    throw new HttpsError("permission-denied", "Pouze prověřený administrátor smí vynutit rekalulaci žebříčku!");
  }

  const { leagueName } = request.data;
  const sezonaId = request.data.sezonaId || "2025_2026";

  if (!leagueName) {
    throw new HttpsError("invalid-argument", "Chybí název soutěže k přepočtení!");
  }

  try {
    const nyni = new Date();
    const ligaKlic = leagueName.replace(/ /g, "_");

    // 1. Stáhneme základní profily, konfiguraci ligy a rozpis zápasů
    const [usersSnapshot, leagueDoc, matchesSnapshot] = await Promise.all([
      db.collection("users").get(),
      db.collection("ligy").doc(leagueName).get(),
      db.collection("ligy").doc(leagueName).collection("zapasy").get()
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

    // 🪐 PARALELNÍ SBĚR SEZÓNNÍCH ŠUPLÍKŮ (Senior-grade Multi-Query parallelization)
    const sezonaSliby = vsichniHraciUids.map(uid => 
      db.collection("users").doc(uid).collection("sezony").doc(sezonaId).get()
    );
    const sezonaSnaps = await Promise.all(sezonaSliby);

    const lZapasy = {};
    matchesSnapshot.forEach(mDoc => {
      lZapasy[mDoc.id] = mDoc.data();
    });

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
      if (!sSnap.exists()) return;
      const uid = sSnap.ref.parent.parent.id;
      const email = mapaUidToEmail[uid];
      if (!email || !hracStats[email]) return;

      const sData = sSnap.data() || {};
      const souteze = sData.souteze || {};
      const soutezData = souteze[ligaKlic] || {};
      
      // Načteme dlouhodobé bonusy
      const bTip = soutezData.bonusy || {};
      hracStats[email].nejStrelec = bTip.strelec || '–';
      hracStats[email].vitezMs = bTip.vitez || '–';

      // Načteme zápasové tipy do lokální mapy pro potřeby loopu níže
      const hracovyTipy = soutezData.tipy || {};
      hracStats[email].mapaTipuLocal = hracovyTipy;
    });

    const vypocitejBodyZapasuLocal = (tipDomaci, tipHoste, realDomaci, realHoste, tipPostup, realPostup, isPlayoff) => {
      const tDom = parseInt(tipDomaci); const tHos = parseInt(tipHoste);
      const rDom = parseInt(realDomaci); const rHos = parseInt(realHoste);
      if (isNaN(tDom) || isNaN(tHos)) return 0;

      if (leagueName === "MS ve fotbale") {
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
      } else {
        if (tDom === rDom && tHos === rHos) return 3;
        const tipRozdil = tDom - tHos; const realRozdil = rDom - rHos;
        if ((tipRozdil > 0 && realRozdil > 0) || (tipRozdil < 0 && realRozdil < 0) || (tipRozdil === 0 && realRozdil === 0)) return 1;
        return 0;
      }
    };

    if (realLeagueData && (realLeagueData.vitez || realLeagueData.strelec)) {
      Object.keys(hracStats).forEach(email => {
        let bonusBody = 0;
        let hodnotaBonus = (leagueName === "MS ve fotbale") ? 8 : 10;
        if (realLeagueData.vitez && hracStats[email].vitezMs && hracStats[email].vitezMs.trim().toLowerCase() === realLeagueData.vitez.trim().toLowerCase()) bonusBody += hodnotaBonus;
        if (realLeagueData.strelec && hracStats[email].nejStrelec && hracStats[email].nejStrelec.trim().toLowerCase() === realLeagueData.strelec.trim().toLowerCase()) bonusBody += hodnotaBonus;
        hracStats[email].celkemBodu += bonusBody;
        hracStats[email].celkemBoduLive += bonusBody;
      });
    }

    const jeFotbaloveMS = (leagueName === "MS ve fotbale");
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
          if (uživatelůvTip && uživatelůvTip.tip_domaci !== undefined && uživatelůvTip.tip_domaci !== null && uživatelůvTip.tip_domaci !== '') {
            const tDom = parseInt(uživatelůvTip.tip_domaci);
            const tHos = parseInt(uživatelůvTip.tip_hoste);
            if (tDom > tHos) domaciWins++; else if (tDom === tHos) remizy++; else if (tDom < tHos) hosteWins++;
            tipyProZapasPole.push({ userEmail: email, tip_domaci: tDom, tip_hoste: tHos, postup: uživatelůvTip.postup || '' });
          }
        });

        let celkemTipu = domaciWins + remizy + hosteWins;
        if (celkemTipu > 0) {
          zapas.procentaDomaci = Math.round((domaciWins / celkemTipu) * 100);
          zapas.procentaRemiza = Math.round((remizy / celkemTipu) * 100);
          zapas.procentaHoste = Math.round((hosteWins / celkemTipu) * 100);
        }

        await db.collection('ligy').doc(leagueName).collection('stav').doc(`tipy_zapasu_${matchId}`).set({
          tipy: tipyProZapasPole, aktualizovano: admin.firestore.Timestamp.now()
        });
      }
    }

    // 4. KONEČNÁ MATEMATICKÁ SMYČKA HODNOCENÍ HRÁČE
    Object.keys(hracStats).forEach(email => {
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
            bodyZapasu = vypocitejBodyZapasuLocal(uživatelůvTip.tip_domaci, uživatelůvTip.tip_hoste, zapas.vysledek_domaci, zapas.vysledek_hoste, uživatelůvTip.postup, zapas.postup, zapas.isPlayoff);
            hracStats[email].celkemBodu += bodyZapasu; hracStats[email].natipovaneVyhodnocene++;
            if (parseInt(uživatelůvTip.tip_domaci) === parseInt(zapas.vysledek_domaci) && parseInt(uživatelůvTip.tip_hoste) === parseInt(zapas.vysledek_hoste)) hracStats[email].presneVysledkyCount++;
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

        if (jeLiveNeboVyhodnoceny) {
          let bodyZapasuLive = 0;
          if (uživatelůvTip) {
            bodyZapasuLive = vypocitejBodyZapasuLocal(uživatelůvTip.tip_domaci, uživatelůvTip.tip_hoste, vDomaci, vHoste, uživatelůvTip.postup, zapas.postup, zapas.isPlayoff);
            hracStats[email].celkemBoduLive += bodyZapasuLive; hracStats[email].natipovaneVyhodnoceneLive++;
          } else {
            if (jeFotbaloveMS) { bodyZapasuLive = -1; hracStats[email].celkemBoduLive += bodyZapasuLive; }
            hracStats[email].nenatipovaneVyhodnoceneLive++;
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

    const zebricekPole = Object.keys(hracStats).map(email => ({
      uid: mapaEmailToUid[email] || "unknown", email: email, nickname: mapaPrezdivek[email],
      celkemBodu: hracStats[email].celkemBodu, natipovaneVyhodnocene: hracStats[email].natipovaneVyhodnocene,
      nenatipovaneVyhodnocene: hracStats[email].nenatipovaneVyhodnocene, presneVysledkyCount: hracStats[email].presneVysledkyCount,
      nejviceBoduVKole: hracStats[email].nejviceBoduVKole, vitezMs: hracStats[email].vitezMs, nejStrelec: hracStats[email].nejStrelec
    })).sort((a, b) => b.celkemBodu - a.celkemBodu);

    const zebricekLivePole = Object.keys(hracStats).map(email => ({
      uid: mapaEmailToUid[email] || "unknown", email: email, nickname: mapaPrezdivek[email],
      celkemBodu: hracStats[email].celkemBoduLive, natipovaneVyhodnocene: hracStats[email].natipovaneVyhodnoceneLive,
      nenatipovaneVyhodnocene: hracStats[email].nenatipovaneVyhodnoceneLive, presneVysledkyCount: hracStats[email].presneVysledkyCountLive,
      nejviceBoduVKole: hracStats[email].nejviceBoduVKole, vitezMs: hracStats[email].vitezMs, nejStrelec: hracStats[email].nejStrelec
    })).sort((a, b) => b.celkemBodu - a.celkemBodu);

    // 5. ZÁPIS HOTOVÝCH AGREGÁTŮ PRO FRONTEND DO SLOŽKY /STAV
    await Promise.all([
      db.collection('ligy').doc(leagueName).collection('stav').doc('leaderboard').set({
        zebricek: zebricekPole, zebricekLive: zebricekLivePole, isLive: liveMatchIds.length > 0, mapaPrezdivek: mapaPrezdivek,
        textKraliPresnosti: kraliPresnosti.length > 0 ? `${kraliPresnosti.join(', ')} (${maxPresnychGlobal}x)` : '–',
        textRekordmaniKola: rekordmaniKola.length > 0 ? `${rekordmaniKola.join(', ')} (${maxBoduKoloGlobal} b.)` : '–',
        aktualizovano: admin.firestore.Timestamp.now()
      }),
      db.collection('ligy').doc(leagueName).collection('stav').doc('rozpis').set({
        zapasyMapa: lZapasy, aktualizovano: admin.firestore.Timestamp.now()
      })
    ]);

    // 6. REFRESH UZAVŘENÝCH HISTORIÍ PRO HRÁČE
    for (const uid of vsichniHraciUids) {
      const email = mapaUidToEmail[uid];
      const hracovyTipyVsechny = hracStats[email].mapaTipuLocal || {};
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

      await db.collection('ligy').doc(leagueName).collection('stav').doc(`historie_${uid}`).set({
        mapaTipu: hracovyTipyOdemcene, vytvoreno: admin.firestore.Timestamp.now()
      });
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