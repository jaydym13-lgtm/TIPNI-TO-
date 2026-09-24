// =========================================================================
// ⚽ TIPNI TO! - HRÁČSKÉ JÁDRO & BLESKOVÉ UKLÁDÁNÍ TIPŮ (tips.js)
// Žádné těžké SDK závislosti = minimální paměť a bleskový Cold Start!
// =========================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db, admin } = require("./init");

// 🔒 FUNKCE 6: Zabezpečený zápis zápasových tipů
const saveUserTipsCF = onCall({ cors: true }, async (request) => {
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

      if (nyni >= datumZapasu || matchData.apiStatus === "POSTPONED") {
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
const saveBonusTipsCF = onCall({ cors: true }, async (request) => {
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

// 🎮 FUNKCE 8: Zabezpečená registrace přezdívky s kontrolou unikátnosti
const registerNicknameCF = onCall({ cors: true }, async (request) => {
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

module.exports = {
  saveUserTipsCF,
  saveBonusTipsCF,
  registerNicknameCF
};