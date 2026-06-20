// =========================================================================
// 🚀 TIPNI TO! - HLAVNÍ CORE SOUBOR V11 MODULAR (app.js)
// =========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app-check.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAuJyI2f1sJP1GiBjW8019Bg6U7sq9ocr4",
  authDomain: "tipni-to.firebaseapp.com",
  projectId: "tipni-to",
  storageBucket: "tipni-to.firebasestorage.app",
  messagingSenderId: "528796783428",
  appId: "1:528796783428:web:08b0333dca077d88be3d11"
};

// Inicializace v11 instancí s neprůstřelnou vestavěnou persistentní cache a Multi-Tab správcem disku
const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
    }),
    experimentalAutoDetectLongPolling: true // 🧠 RESILIENT TRANSPORT TUNING: Automatický fallback při chybách QUIC/HTTP3 na Localhostu a proxy firewallech
});
const auth = getAuth(app);

// Exponování instancí do window, aby na ně viděly ostatní moduly (auth.js, render.js)
window.app = app;
window.db = db;
window.auth = auth;

// 🛡️ AKTIVACE ULTIMÁTNÍHO FINANČNÍHO ŠTÍTU (FIREBASE APP CHECK V11) S LOCALHOST BYPASSEM
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    console.log("🐛 APP CHECK: Detekován localhost. Aktivuji debug providera pro lokální vývoj.");
}

initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider('6LemMiEtAAAAAH_PrIFI0yeP06zY1IQoelK9-q8K'),
    isTokenAutoRefreshEnabled: true
});

console.log("⚽ TIPNI TO! úspěšně propojeno přes moderní Firebase v11 SDK s čistou offline cache.");
// Globalni odhlašovače živých radarů
window.globalLiveMenuUnsubscribe = null;
window.globalLiveRozpisUnsubscribe = null;

// --- ALPINE.JS INITIALIZATION ---
document.addEventListener('alpine:init', () => {
    Alpine.store('appState', {
        currentScreen: 'splashScreen', 
        selectedLeague: localStorage.getItem('savedLeague') || null,
        selectedAdminLeague: null,
        isMenuOpen: false,
        isVip: false,
        isEditor: false,
        isAdmin: false,
        isSuperAdmin: false,
        nickname: '',
        isLive: false,
        
        // 🔒 SENIORNÍ DISKOVÝ INTERCEPTOR: Stoprocentní imunita vůči načítacím chybám pluginu
        _rozpisData: (() => { try { return JSON.parse(localStorage.getItem('tipni_cache_rozpis_data')); } catch(e) { return null; } })(),
        _leaderboardData: (() => { try { return JSON.parse(localStorage.getItem('tipni_cache_leaderboard_data')); } catch(e) { return null; } })(),

        get rozpisData() { return this._rozpisData; },
        set rozpisData(val) {
            this._rozpisData = val;
            if (val) localStorage.setItem('tipni_cache_rozpis_data', JSON.stringify(val));
            else localStorage.removeItem('tipni_cache_rozpis_data');
        },

        get leaderboardData() { return this._leaderboardData; },
        set leaderboardData(val) {
            this._leaderboardData = val;
            if (val) localStorage.setItem('tipni_cache_leaderboard_data', JSON.stringify(val));
            else localStorage.removeItem('tipni_cache_leaderboard_data');
        }
    });

    window.goToScreen = (screenName) => {
        const store = Alpine.store('appState');
        
        // 📡 OŽIVENÍ RADARU PŘI NÁVRATU: Respektujeme inteligentní herní plánovače (Bod 2)
            if (store.selectedLeague && typeof window.naplanujZiveKanaly === 'function') {
                window.naplanujZiveKanaly(store.selectedLeague);
            }

        // 🔐 BEZPEČNOSTNÍ GILOTINA
        if (screenName === 'adminScreen' && !store.isAdmin) {
            store.currentScreen = 'leaguesScreen';
            localStorage.setItem('savedScreen', 'leaguesScreen');
            return;
        }
        if (screenName === 'superAdminScreen' && !store.isSuperAdmin) {
            store.currentScreen = 'leaguesScreen';
            localStorage.setItem('savedScreen', 'leaguesScreen');
            return;
        }

        store.currentScreen = screenName;
        store.isMenuOpen = false;

        if (screenName !== 'splashScreen' && screenName !== 'loginScreen' && screenName !== 'nicknameScreen') {
            localStorage.setItem('savedScreen', screenName);
        }
        
        if (screenName === 'leaguesScreen') {
            store.selectedLeague = null;
            store.selectedAdminLeague = null;
            store.isLive = false;
            localStorage.removeItem('savedLeague');
            if (window.globalLiveMenuUnsubscribe) { window.globalLiveMenuUnsubscribe(); window.globalLiveMenuUnsubscribe = null; }
            if (window.globalLiveRozpisUnsubscribe) { window.globalLiveRozpisUnsubscribe(); window.globalLiveRozpisUnsubscribe = null; }
        }
        
        if (screenName === 'leaderboardScreen' && typeof window.renderLeaderboard === 'function') {
            window.renderLeaderboard();
            setTimeout(() => {
                const lbScreen = document.getElementById('leaderboardScreen');
                if (lbScreen) lbScreen.scrollTop = 0; 
            }, 50);
        }
        
        if (screenName === 'scoringScreen' && typeof window.renderScoring === 'function') {
            window.renderScoring();
        }
        
        if (screenName === 'matchesScreen' && store.selectedLeague && typeof window.renderMatches === 'function') {
            window.renderMatches(store.selectedLeague);
            if (typeof window.loadBonusTips === 'function') {
                window.loadBonusTips(store.selectedLeague);
            }
            setTimeout(() => {
                const bonusBox = document.querySelector('.bonus-collapse-box');
                if (bonusBox && window.Alpine) { Alpine.$data(bonusBox).open = false; } 
                const mScreen = document.getElementById('matchesScreen');
                if (mScreen) mScreen.scrollTop = 0; 
            }, 50);
        }

        if (screenName === 'superAdminScreen' && typeof window.renderSuperAdmin === 'function') {
            window.renderSuperAdmin();
        }
        
        if (screenName === 'adminScreen') {
            store.selectedLeague = null;
            store.selectedAdminLeague = null;
            if (typeof window.renderAdminMatches === 'function') {
                window.renderAdminMatches();
            }
        }
    };

    // 👑 GLOBÁLNÍ INTERNÍ PAMĚŤ PRO PULSNÍ SYSTÉM (Dostupná ihned po startu)
    window.lastVerzeRozpisu = -1;
    window.lastVerzeZebricku = -1;

    window.SEZONA_ID = "2025_2026"; // 🪐 GLOBÁLNÍ ŘÍDÍCÍ KLÍČ AKTUÁLNÍ SEZÓNY

    window.zapniZiveStreamy = (leagueName) => {
        if (window.globalLiveMenuUnsubscribe) return;
        console.log("📡 TUNING: Aktivuji úsporný Pulsní onSnapshot (Volba A)!");
        const store = Alpine.store('appState');
        
        window.globalLiveMenuUnsubscribe = onSnapshot(doc(window.db, 'ligy', leagueName, 'stav', 'puls'), async (pulsSnap) => {
            const { getDoc } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js");

            if (!pulsSnap.exists()) {
                const rSnap = await getDoc(doc(window.db, 'ligy', leagueName, 'stav', 'rozpis'));
                if (rSnap.exists()) {
                    store.rozpisData = rSnap.data();
                    const mapa = rSnap.data().zapasyMapa || {};
                    store.isLive = Object.values(mapa).some(zap => zap.apiStatus === "IN_PLAY" || zap.apiStatus === "PAUSED");
                }
                const lbSnap = await getDoc(doc(window.db, 'ligy', leagueName, 'stav', 'leaderboard'));
                if (lbSnap.exists()) store.leaderboardData = lbSnap.data();

                if (store.currentScreen === 'matchesScreen' && typeof window.renderMatches === 'function') window.renderMatches(leagueName);
                if (store.currentScreen === 'leaderboardScreen' && typeof window.renderLeaderboard === 'function') window.renderLeaderboard();
                return;
            }

            const data = pulsSnap.data();
            const vRozpis = data.verzeRozpisu || 0;
            const vZebricek = data.verzeZebricku || 0;

            if (vRozpis !== window.lastVerzeRozpisu) {
                window.lastVerzeRozpisu = vRozpis;
                const rSnap = await getDoc(doc(window.db, 'ligy', leagueName, 'stav', 'rozpis'));
                if (rSnap.exists()) {
                    store.rozpisData = rSnap.data();
                    const mapa = rSnap.data().zapasyMapa || {};
                    store.isLive = Object.values(mapa).some(zap => zap.apiStatus === "IN_PLAY" || zap.apiStatus === "PAUSED");
                    
                    if (store.currentScreen === 'matchesScreen' && typeof window.renderMatches === 'function') {
                        window.renderMatches(leagueName);
                    }

                    if (!store.isLive) {
                        setTimeout(() => window.naplanujZiveKanaly(leagueName), 10000);
                    }
                }
            }

            if (vZebricek !== window.lastVerzeZebricku) {
                window.lastVerzeZebricku = vZebricek;
                const lbSnap = await getDoc(doc(window.db, 'ligy', leagueName, 'stav', 'leaderboard'));
                if (lbSnap.exists()) {
                    store.leaderboardData = lbSnap.data();
                    if (store.currentScreen === 'leaderboardScreen' && typeof window.renderLeaderboard === 'function') {
                        window.renderLeaderboard();
                    }
                }
            }
        });
    };

    window.naplanujZiveKanaly = async (lName) => {
        const store = Alpine.store('appState');
        if (!store || store.currentScreen === 'leaguesScreen' || store.selectedLeague !== lName) return;
        try {
            const { getDoc } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js");
            const docSnap = await getDoc(doc(window.db, 'ligy', lName, 'stav', 'rozpis'));
            if (!docSnap.exists()) {
                window.zapniZiveStreamy(lName); return;
            }
            
            const mapa = docSnap.data().zapasyMapa || {};
            store.rozpisData = docSnap.data();

            if (store.currentScreen === 'matchesScreen' && typeof window.renderMatches === 'function') {
                window.renderMatches(lName);
            }

            const zapasy = Object.values(mapa);
            const nyni = Date.now();
            const beziZapas = zapasy.some(zap => {
                const dMs = zap.datum?.toDate ? zap.datum.toDate().getTime() : (zap.datum?.seconds ? zap.datum.seconds * 1000 : new Date(zap.datum).getTime());
                return zap.apiStatus === "IN_PLAY" || zap.apiStatus === "PAUSED" || (dMs <= nyni && zap.apiStatus !== "FINISHED");
            });
            
            if (beziZapas) {
                window.zapniZiveStreamy(lName); return;
            }

            let nejblizsiZapasMs = Infinity;
            zapasy.forEach(zap => {
                let dMs = zap.datum?.toDate ? zap.datum.toDate().getTime() : (zap.datum?.seconds ? zap.datum.seconds * 1000 : new Date(zap.datum).getTime());
                if (dMs > nyni && dMs < nejblizsiZapasMs) nejblizsiZapasMs = dMs;
            });

            const lbSnap = await getDoc(doc(window.db, 'ligy', lName, 'stav', 'leaderboard'));
            if (lbSnap.exists()) store.leaderboardData = lbSnap.data();

            if (nejblizsiZapasMs === Infinity) {
                console.log("⏱️ DETEKTOR: Žádné další budoucí zápasy. Stadion spí.");
                if (window.globalLiveMenuUnsubscribe) { window.globalLiveMenuUnsubscribe(); window.globalLiveMenuUnsubscribe = null; }
                if (window.globalLiveRozpisUnsubscribe) { window.globalLiveRozpisUnsubscribe(); window.globalLiveRozpisUnsubscribe = null; }
                return;
            }

            const msDoZapnuti = (nejblizsiZapasMs - nyni) - (15 * 60 * 1000);
            if (msDoZapnuti <= 0) {
                window.zapniZiveStreamy(lName);
            } else {
                console.log(`⏱️ DETEKTOR: Stadion spí. Živý stream se aktivuje za ${Math.round(msDoZapnuti / 60000)} minut.`);
                if (window.globalLiveMenuUnsubscribe) { window.globalLiveMenuUnsubscribe(); window.globalLiveMenuUnsubscribe = null; }
                if (window.globalLiveRozpisUnsubscribe) { window.globalLiveRozpisUnsubscribe(); window.globalLiveRozpisUnsubscribe = null; }
                if (window.liveSchedulerTimeout) clearTimeout(window.liveSchedulerTimeout);
                window.liveSchedulerTimeout = setTimeout(() => window.zapniZiveStreamy(lName), msDoZapnuti);
            }
        } catch (err) { console.error(err); window.zapniZiveStreamy(lName); }
    };

    window.selectLeague = (leagueName) => {
        const store = Alpine.store('appState');
        const bonusBox = document.querySelector('.bonus-collapse-box');

        if (!store.isSuperAdmin && (!store.leagues || !store.leagues.includes(leagueName))) {
            window.showToast("Do této tipovačky tě admin ještě neschválil! 🚧", true);
            return;
        }
        
        if (leagueName !== 'MS ve fotbale') {
            const container = document.querySelector('#matchesScreen .zebra-container');
            store.selectedLeague = leagueName;
            store.currentScreen = 'matchesScreen';
            store.isMenuOpen = false;
            if (bonusBox) bonusBox.style.display = 'none';
            
            if (container) {
                container.innerHTML = `
                    <div class="enterprise-lock-box">
                        <div class="lock-icon">🚧</div>
                        <h3 class="lock-title">PROJECT MANAGER DIRECTIVE #2026</h3>
                        <p class="lock-text">
                            <strong>Přístup odepřen z důvodu stoprocentního fotbalového focusu!</strong><br><br>
                            Naše IT oddělení momentálně alokovalo veškerou výpočetní kapacitu na <strong>MS VE FOTBALE</strong>. 
                        </p>
                        <button class="action-btn btn-tip" onclick="window.goToScreen('leaguesScreen')" style="margin: 15px auto 0 auto; display: block; width: auto; padding: 10px 20px;">Vrátit se k fotbalu ⚽</button>
                    </div>
                `;
            }
            return;
        }

        if (bonusBox) bonusBox.style.display = 'block';

        store.selectedLeague = leagueName;
        store.selectedAdminLeague = null;
        store.currentScreen = 'matchesScreen';
        store.isMenuOpen = false;

        localStorage.setItem('savedLeague', leagueName);
        localStorage.setItem('savedScreen', 'matchesScreen');
        
        if (window.globalLiveMenuUnsubscribe) { window.globalLiveMenuUnsubscribe(); window.globalLiveMenuUnsubscribe = null; }
        if (window.globalLiveRozpisUnsubscribe) { window.globalLiveRozpisUnsubscribe(); window.globalLiveRozpisUnsubscribe = null; }
        window.liveSchedulerTimeout = window.liveSchedulerTimeout || null;
        if (window.liveSchedulerTimeout) { clearTimeout(window.liveSchedulerTimeout); window.liveSchedulerTimeout = null; }

        window.lastVerzeRozpisu = -1;
        window.lastVerzeZebricku = -1;

        window.naplanujZiveKanaly(leagueName);

        if (typeof window.renderMatches === 'function') {
            window.renderMatches(leagueName);
        }

        setTimeout(() => {
            const bonusBox = document.querySelector('.bonus-collapse-box');
            if (bonusBox && window.Alpine) { Alpine.$data(bonusBox).open = false; } 
            const mScreen = document.getElementById('matchesScreen');
            if (mScreen) mScreen.scrollTop = 0; 
        }, 50);
    };

    // 🪝 LIFECYCLE BOOTSTRAP: Automatické tiché navázání live spojení po Ctrl+F5 s garancí Auth ověření
    const activeLeague = localStorage.getItem('savedLeague');
    const activeScreen = localStorage.getItem('savedScreen');
    if (activeLeague && activeLeague !== 'null' && activeScreen && activeScreen !== 'leaguesScreen') {
        // Místo náhodného časovače navážeme oživení přímo na nativní potvrzení identity od Firebase
        onAuthStateChanged(window.auth, (user) => {
            if (user) {
                console.log(`⚡ BOOTSTRAP AUTH READY: Spolehlivě stahuji živé kanály a tipy pro ligu: ${activeLeague}`);
                window.naplanujZiveKanaly(activeLeague);
            }
        });
    }
}); 

// 📱 CENTRÁLNÍ SYSTÉMOVÝ LIFECYCLE MONITOR (PROBUZENÍ Z HYBERNACE BATERIE)
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        console.log("📱 Mobil se právě probral z režimu spánku! Obnovuji spojení...");
        
        const store = Alpine.store('appState');
        if (store && store.selectedLeague) {
            if (store.currentScreen === 'matchesScreen' && typeof window.renderMatches === 'function') {
                window.renderMatches(store.selectedLeague);
            } else if (store.currentScreen === 'leaderboardScreen' && typeof window.renderLeaderboard === 'function') {
                window.renderLeaderboard();
            }
        }
    }
});