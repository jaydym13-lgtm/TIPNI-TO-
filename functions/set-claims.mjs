import admin from "firebase-admin";
import { readFileSync } from "fs";

// 🧠 ARCHITEKTONICKÝ BOOTSTRAP: Načteme klíč service accountu, který si stáhneš z Firebase Konzole
// (Project Settings -> Service Accounts -> Generate new private key)
// Soubor ulož do složky /functions pod názvem serviceAccountKey.json
const serviceAccount = JSON.parse(readFileSync("./serviceAccountKey.json", "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const MY_UID = "tfLmfp1twLbcFsxWrgNkZ7iQRC22"; // Tvoje posvátné UID

async function bootstrapSuperAdmin() {
  try {
    await admin.auth().setCustomUserClaims(MY_UID, {
      isSuperAdmin: true,
      isAdmin: true,
      leagues: ['MS v hokeji', 'MS ve fotbale', 'Tipsport Extraliga', 'Chance Liga']
    });
    console.log("👑 SENIORNÍ TRIUMF: Tvoje UID bylo bezpečně orazítkováno jako globální Super Admin!");
    process.exit(0);
  } catch (error) {
    console.error("❌ CHYBA ORAZÍTKOVÁNÍ:", error);
    process.exit(1);
  }
}

bootstrapSuperAdmin();