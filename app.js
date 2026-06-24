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
        leagues: [],
        mojeTipy: {},
        mojeBonusy: {},
        mojeStatistiky: {},
        
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
        if (typeof window.showSplash === 'function') window.showSplash("Načítání...");
        const store = Alpine.store('appState');
        
        if (store.selectedLeague && typeof window.naplanujZiveKanaly === 'function') {
            window.naplanujZiveKanaly(store.selectedLeague);
        }

        if (screenName === 'adminScreen' && !store.isAdmin) {
            store.currentScreen = 'leaguesScreen';
            localStorage.setItem('savedScreen', 'leaguesScreen');
            if (typeof window.hideSplash === 'function') window.hideSplash();
            return;
        }
        if (screenName === 'superAdminScreen' && !store.isSuperAdmin) {
            store.currentScreen = 'leaguesScreen';
            localStorage.setItem('savedScreen', 'leaguesScreen');
            if (typeof window.hideSplash === 'function') window.hideSplash();
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
            const lbScreen = document.getElementById('leaderboardScreen');
            if (lbScreen) lbScreen.scrollTop = 0; 
        }
        
        if (screenName === 'scoringScreen' && typeof window.renderScoring === 'function') {
            window.renderScoring();
        }
        
        if (screenName === 'matchesScreen' && store.selectedLeague && typeof window.renderMatches === 'function') {
            window.renderMatches(store.selectedLeague);
            if (typeof window.loadBonusTips === 'function') {
                window.loadBonusTips(store.selectedLeague);
            }
            const bonusBox = document.querySelector('.bonus-collapse-box');
            if (bonusBox && window.Alpine) { Alpine.$data(bonusBox).open = false; } 
            const mScreen = document.getElementById('matchesScreen');
            if (mScreen) mScreen.scrollTop = 0; 
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

        // Čisté stažení opony až po reálném překreslení DOMu přes Alpine.nextTick
        if (typeof window.hideSplash === 'function') {
            if (typeof Alpine !== 'undefined' && Alpine.nextTick) {
                Alpine.nextTick(() => window.hideSplash());
            } else {
                window.hideSplash();
            }
        }
    };

    window.lastVerzeRozpisu = -1;
    window.lastVerzeZebricku = -1;

    window.SEZONA_ID = "2025_2026";

    window.liveIntervalRadar = null;

    window.zapniZiveStreamy = (leagueName) => {
        if (window.liveIntervalRadar) return;
        console.log("📡 TUNING: Aktivuji ultra lehký Netlify CDN Radar s nulovou spotřebou Firebase!");
        const store = Alpine.store('appState');

        const kontrolujPulsEngine = async () => {
            try {
                // Dynamická detekce: Pokud jsme na localhostu, sosáme data z ostrého Netlify, jinak relativně z produkce
                const cdnBase = (location.hostname === "localhost" || location.hostname === "127.0.0.1") ? "https://tipni-to.netlify.app" : "";

                // Stáhneme mikro textový soubor z Netlify CDN bypassující cache paměť pomocí timestampu (?t=)
                const resPuls = await fetch(`${cdnBase}/public/data/puls.json?t=${Date.now()}`);
                if (!resPuls.ok) return;
                const data = await resPuls.json();

                const vRozpis = data.verzeRozpisu || 0;
                const vZebricek = data.verzeZebricku || 0;

                // 1. REAKTIVNÍ VSTŘIK ROZPISU (Když padne gól nebo se změní čas)
                if (vRozpis !== window.lastVerzeRozpisu) {
                    window.lastVerzeRozpisu = vRozpis;
                    const resRozpis = await fetch(`${cdnBase}/public/data/rozpis.json?t=${Date.now()}`);
                    if (resRozpis.ok) {
                        const rData = await resRozpis.json();
                        store.rozpisData = rData;
                        const mapa = rData.zapasyMapa || {};
                        store.isLive = Object.values(mapa).some(zap => zap.apiStatus === "IN_PLAY" || zap.apiStatus === "PAUSED");
                        
                        if (store.currentScreen === 'matchesScreen' && typeof window.renderMatches === 'function') {
                            window.renderMatches(leagueName);
                        }
                    }
                }

                // 2. REAKTIVNÍ VSTŘIK ŽEBŘÍČKU (Když bot dopočítá body)
                if (vZebricek !== window.lastVerzeZebricku) {
                    window.lastVerzeZebricku = vZebricek;
                    const resLeaderboard = await fetch(`${cdnBase}/public/data/leaderboard.json?t=${Date.now()}`);
                    if (resLeaderboard.ok) {
                        const lbData = await resLeaderboard.json();
                        store.leaderboardData = lbData;
                        if (store.currentScreen === 'leaderboardScreen' && typeof window.renderLeaderboard === 'function') {
                            window.renderLeaderboard();
                        }
                    }
                }
            } catch (err) {
                console.error("Chyba Netlify CDN radaru:", err);
            }
        };

        // První okamžitý výstřel při otevření appky
        kontrolujPulsEngine();

        // Short-polling interval (15 vteřin) - pro statický JSON soubor z CDN naprosto bezplatná zátěž
        window.liveIntervalRadar = setInterval(kontrolujPulsEngine, 15000);

        // Chytře zachováme původní název odhlašovače, abychom nemuseli přepisovat zbytek app.js souboru!
        window.globalLiveMenuUnsubscribe = () => {
            if (window.liveIntervalRadar) {
                clearInterval(window.liveIntervalRadar);
                window.liveIntervalRadar = null;
                console.log("💤 Netlify CDN Radar úspěšně vypnut a kompletně uspán.");
            }
        };
    };

    window.naplanujZiveKanaly = async (lName) => {
        // Na bezplatném a cachovaném Netlify CDN hostingu už nepotřebujeme složitě uspávat a plánovat budíky.
        // Dotazy na textový soubor nestojí výkon ani peníze, takže radar rovnou bezpečně roztočíme!
        window.zapniZiveStreamy(lName);
    };

    window.selectLeague = (leagueName) => {
        if (typeof window.showSplash === 'function') window.showSplash("Načítání...");
        const store = Alpine.store('appState');
        const bonusBox = document.querySelector('.bonus-collapse-box');

        if (!store.isSuperAdmin && (!store.leagues || !store.leagues.includes(leagueName))) {
            window.showToast("Do této tipovačky tě admin ještě neschválil! 🚧", true);
            if (typeof window.hideSplash === 'function') window.hideSplash();
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
            if (typeof window.hideSplash === 'function') window.hideSplash();
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

        const mScreen = document.getElementById('matchesScreen');
        if (mScreen) mScreen.scrollTop = 0; 

        if (typeof window.hideSplash === 'function') {
            if (typeof Alpine !== 'undefined' && Alpine.nextTick) {
                Alpine.nextTick(() => window.hideSplash());
            } else {
                window.hideSplash();
            }
        }
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

// 📱 CENTRÁLNÍ JISTIČ BATERIE A DAT (PAGE VISIBILITY API)
document.addEventListener("visibilitychange", () => {
    const store = Alpine.store('appState');
    if (!store || !store.selectedLeague) return;

    if (document.hidden) {
        // Mobil schovaný v kapse nebo zhasnutý displej -> okamžitě zmrazíme internetovou aktivitu
        if (window.globalLiveMenuUnsubscribe) {
            window.globalLiveMenuUnsubscribe();
            window.globalLiveMenuUnsubscribe = null;
        }
        console.log("🔋 BATERIE ŠTÍT: Aplikace na pozadí, Netlify radar kompletně USPAZ.");
    } else {
        // Uživatel otevřel oči a rozsvítil appku -> radar bleskově probudíme k životu
        console.log("📱 BATERIE ŠTÍT: Uživatel je zpět, probouzím Netlify radar...");
        window.lastVerzeRozpisu = -1;
        window.lastVerzeZebricku = -1;
        window.naplanujZiveKanaly(store.selectedLeague);
    }
});