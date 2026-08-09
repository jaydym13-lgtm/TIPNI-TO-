// =========================================================================
// ⚙️ TIPNI TO! - CENTRÁLNÍ KONFIGURAČNÍ SOUBOR (config.js)
// =========================================================================

export const CONFIG = {
    R2_BASE_URL: "https://pub-03310472e0f0459ab78ec11236373cd6.r2.dev",
    DEFAULT_SEASON: "2026_2027",
    MASTER_LEAGUES: [
        "Chance Liga",
        "Premier League",
        "Liga národů",
        "MS ve fotbale",
        "Tipsport Extraliga",
        "MS v hokeji"
    ],
    FIREBASE_CONFIG: {
        apiKey: "AIzaSyAuJyI2f1sJP1GiBjW8019Bg6U7sq9ocr4",
        authDomain: "tipni-to.firebaseapp.com",
        projectId: "tipni-to",
        storageBucket: "tipni-to.firebasestorage.app",
        messagingSenderId: "528796783428",
        appId: "1:528796783428:web:08b0333dca077d88be3d11"
    }
};

window.CONFIG = CONFIG;