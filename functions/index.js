// index.js - VERZE 3.0.0 (GEN 2 PROFI)
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require('firebase-admin');

// Inicializace administrátorských práv pro server
admin.initializeApp();

// 👑 Pomocná konstanta pro Boha (Makyána)
const MAKYAN_EMAIL = 'makyan13@seznam.cz';

// =========================================================================
// 1. FUNKCE PRO ZMĚNU ROLE
// =========================================================================
exports.zmenitRoliServer = onCall({ region: "us-central1" }, async (request) => {
    // V 2. generaci jsou data v request.data
    const data = request.data;

    // 1. PROFI KONTROLA: Vytáhneme si občanku z kufříku
    if (!data || !data.token) {
        throw new HttpsError('unauthenticated', 'Chybí bezpečnostní token.');
    }

    let decodedToken;
    try {
        decodedToken = await admin.auth().verifyIdToken(data.token);
    } catch (error) {
        throw new HttpsError('unauthenticated', 'Neplatný nebo expirovaný token.');
    }

    const callerEmail = (decodedToken.email || '').toLowerCase();
    const callerRole = decodedToken.role;

    if (callerEmail !== MAKYAN_EMAIL && callerRole !== 'Admin') {
        throw new HttpsError('permission-denied', 'Nemáš práva měnit role. Nejsi Admin.');
    }

    const targetUid = data.uid;
    const newRole = data.role;

    try {
        const userRecord = await admin.auth().getUser(targetUid);
        const targetEmail = (userRecord.email || '').toLowerCase();

        // 🛡️ BOŽSKÁ IMUNITA
        if (targetEmail === MAKYAN_EMAIL) {
            throw new HttpsError('permission-denied', 'Na Boha se nesahá! Makyánovi nelze změnit roli.');
        }

        const currentClaims = userRecord.customClaims || {};

        await admin.auth().setCustomUserClaims(targetUid, {
            ...currentClaims,
            role: newRole
        });

        const db = admin.firestore();
        const remove = admin.firestore.FieldValue.delete();
        const batchData = {
            admin_users: { [targetUid]: remove },
            editor_users: { [targetUid]: remove },
            vip_plus_users: { [targetUid]: remove },
            vip_users: { [targetUid]: remove }
        };

        if (newRole === 'Admin') batchData.admin_users[targetUid] = true;
        if (newRole === 'Editor') batchData.editor_users[targetUid] = true;
        if (newRole === 'VipPlus') batchData.vip_plus_users[targetUid] = true;
        if (newRole === 'Vip') batchData.vip_users[targetUid] = true;

        await db.collection('linka_data').doc('nastaveni').set(batchData, { merge: true });

        return { message: `Role úspěšně změněna na ${newRole}` };
    } catch (error) {
        console.error("Chyba při změně role:", error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Došlo k chybě na serveru při změně role.');
    }
});


// =========================================================================
// 2. FUNKCE PRO ZMRAZENÍ ÚČTU
// =========================================================================
exports.zmrazitUzivateleServer = onCall({ region: "us-central1" }, async (request) => {
    const data = request.data;

    if (!data || !data.token) {
        throw new HttpsError('unauthenticated', 'Chybí bezpečnostní token.');
    }

    let decodedToken;
    try {
        decodedToken = await admin.auth().verifyIdToken(data.token);
    } catch (error) {
        throw new HttpsError('unauthenticated', 'Neplatný nebo expirovaný token.');
    }

    const callerEmail = (decodedToken.email || '').toLowerCase();
    const callerRole = decodedToken.role;

    if (callerEmail !== MAKYAN_EMAIL && callerRole !== 'Admin') {
        throw new HttpsError('permission-denied', 'Nemáš práva mrazit uživatele. Nejsi Admin.');
    }

    const targetUid = data.uid;
    const isFrozen = data.isFrozen;

    try {
        const userRecord = await admin.auth().getUser(targetUid);
        const targetEmail = (userRecord.email || '').toLowerCase();

        // 🛡️ BOŽSKÁ IMUNITA
        if (targetEmail === MAKYAN_EMAIL) {
            throw new HttpsError('permission-denied', 'Makyána nelze zamrazit. To je rouhání!');
        }

        const currentClaims = userRecord.customClaims || {};

        await admin.auth().setCustomUserClaims(targetUid, {
            ...currentClaims,
            isFrozen: isFrozen
        });

        const db = admin.firestore();
        await db.collection('linka_data').doc('nastaveni').set({
            zmrazeni: { [targetUid]: isFrozen ? true : admin.firestore.FieldValue.delete() }
        }, { merge: true });

        if (isFrozen) {
            await admin.auth().revokeRefreshTokens(targetUid);
        }

        return { message: isFrozen ? 'Účet tvrdě zmrazen.' : 'Účet odmrazen.' };
    } catch (error) {
        console.error("Chyba při mrazení:", error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Došlo k chybě na serveru při mrazení.');
    }
});