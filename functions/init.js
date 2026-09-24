// =========================================================================
// ⚙️ TIPNI TO! - CENTRÁLNÍ BACKEND INICIALIZACE A SDK INSTANCE (init.js)
// =========================================================================

const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { CloudTasksClient } = require("@google-cloud/tasks");

// 🇪🇺 CENTRÁLNÍ EVROPSKÝ REGION PRO VŠECHNY CLOUD FUNKCE
setGlobalOptions({ region: "europe-west1" });

initializeApp();
const db = getFirestore();
const auth = getAuth();
const tasksClient = new CloudTasksClient();

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

module.exports = {
    db,
    auth,
    admin,
    FieldValue,
    Timestamp,
    tasksClient,
    DEFAULT_SEASON_ID,
    R2_BUCKET_NAME,
    RENDER_BOT_URL
};