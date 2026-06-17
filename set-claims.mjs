import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import process from 'process';

// Využijeme tvou existující konfiguraci servisního účtu, kterou máš pro bota
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();
const auth = getAuth();

/**
 * 🌪️ SENIORNÍ SYNCHRONIZÁTOR: Zapíše data do Firestore a zároveň vypálí šifrované Custom Claims
 */
async function syncUserPermissions(uid, isAdminRole, allowedLeagues) {
    console.log(`⏳ Startuji synchronizaci cejchů pro UID: ${uid}...`);
    try {
        // 1. Zápis do Firestore (pro potřeby UI v admin panelu)
        await db.collection('users').doc(uid).update({
            isAdmin: isAdminRole,
            leagues: allowedLeagues
        });

        // 2. ⚡ VYPÁLENÍ CUSTOM CLAIMS DO FIREBASE AUTH (To nejdůležitější!)
        await auth.setCustomUserClaims(uid, {
            isAdmin: isAdminRole,
            leagues: allowedLeagues
        });

        console.log(`✅ Úspěch! Uživatel ${uid} má nyní claims zapsané přímo v přihlašovacím tokenu.`);
    } catch (error) {
        console.error(`❌ Selhalo vypálení cejchů:`, error);
    }
}

// Příklad použití (Takhle bys skript zavolal např. z příkazové řádky nebo Cloud funkce):
// syncUserPermissions("IJJkTsUf...", false, ["MS ve fotbale", "MS v hokeji"]);