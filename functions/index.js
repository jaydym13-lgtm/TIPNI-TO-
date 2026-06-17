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

// 🌪️ FUNKCE 2: Nuclear Purge - Totální vymazání uživatele z celého vesmíru
exports.purgeUserAbsoluteCF = onCall(async (request) => {
  // Bezpečnostní prověření: Smazat hráče smí výhradně Super Admin přes UID
  if (!request.auth || request.auth.uid !== 'tfLmfp1twLbcFsxWrgNkZ7iQRC22') {
    throw new HttpsError("permission-denied", "Tento demoliční spínač smí zmáčknout pouze Super Admin!");
  }

  const { targetUid } = request.data;

  try {
    const ligy = ['MS v hokeji', 'MS ve fotbale', 'Tipsport Extraliga', 'Chance Liga'];
    const smazatSliby = [];

    // 1. Projedeme všechny soutěže a vyčistíme podkolekce tipů a dlouhodobých bonusů
    for (const liga of ligy) {
      const tipsSnapshot = await db.collection("ligy").doc(liga).collection("tipy").where("userId", "==", targetUid).get();
      tipsSnapshot.forEach(docSnap => {
        smazatSliby.push(docSnap.ref.delete());
      });
      smazatSliby.push(db.collection("ligy").doc(liga).collection("bonusy").doc(targetUid).delete());
    }

    // 2. Smažeme online status a dokument profilu ze složky /users
    smazatSliby.push(db.collection("uzivatele_online").doc(targetUid).delete());
    smazatSliby.push(db.collection("users").doc(targetUid).delete());

    // 3. 🚨 TO NEJDŮLEŽITĚJŠÍ: Vymažeme uživatele natvrdo z Firebase Authentication (Účet zanikne)
    smazatSliby.push(auth.deleteUser(targetUid));

    await Promise.all(smazatSliby);
    return { success: true, message: "Uživatel byl kompletně vymazán ze stadionu!" };
  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});

// 🎭 FUNKCE 3: Loutkovodič - Zpětný zápis s explicitní CORS infrastrukturní pojistkou pro lokální vývoj
exports.saveProxyDataCF = onCall({ cors: true }, async (request) => {
  // Bezpečnostní prověření: Spustit loutkovodiče smí výhradně Super Admin přes UID
  if (!request.auth || request.auth.uid !== 'tfLmfp1twLbcFsxWrgNkZ7iQRC22') {
    throw new HttpsError("permission-denied", "Tento vládní spínač smí mačkat pouze Super Admin!");
  }

  const { targetUid, targetEmail, leagueName, vitez, strelec, tipyMapa } = request.data;

  try {
    const batch = db.batch();

    // 1. Zápis dlouhodobých bonusů
    if (vitez !== undefined || strelec !== undefined) {
      const bonusRef = db.collection("ligy").doc(leagueName).collection("bonusy").doc(targetUid);
      batch.set(bonusRef, {
        userId: targetUid,
        userEmail: targetEmail,
        vitez: vitez ? vitez.trim() : "",
        strelec: strelec ? strelec.trim() : "",
        vytvoreno: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    // 2. Zápis jednotlivých opožděných tipů zápasů
    if (tipyMapa && Object.keys(tipyMapa).length > 0) {
      for (const matchId of Object.keys(tipyMapa)) {
        const tipData = tipyMapa[matchId];
        const tipRef = db.collection("ligy").doc(leagueName).collection("tipy").doc(`${targetUid}_${matchId}`);
        
        batch.set(tipRef, {
          userId: targetUid,
          userEmail: targetEmail,
          matchId: matchId,
          tip_domaci: parseInt(tipData.tip_domaci),
          tip_hoste: parseInt(tipData.tip_hoste),
          postup: tipData.postup || "",
          vytvoreno: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
    }

    await batch.commit();
    return { success: true, message: "Data za hráče byla úspěšně naočkována na Firebase!" };
  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});