// =========================================================================
// 🚀 TIPNI TO! - HLAVNÍ CORE SOUBOR V11 MODULAR (app.js)
// =========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app-check.js";
import { initializeFirestore, persistentLocalCache, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAuJyI2f1sJP1GiBjW8019Bg6U7sq9ocr4",
  authDomain: "tipni-to.firebaseapp.com",
  projectId: "tipni-to",
  storageBucket: "tipni-to.firebasestorage.app",
  messagingSenderId: "528796783428",
  appId: "1:528796783428:web:08b0333dca077d88be3d11"
};

// Inicializace v11 instancí s neprůstřelnou vestavěnou persistentní cache
const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
    localCache: persistentLocalCache()
});
const auth = getAuth(app);

// Exponování instancí do window, aby na ně viděly ostatní moduly (auth.js, render.js)
window.db = db;
window.auth = auth;

// 🛡️ AKTIVACE ULTIMÁTNÍHO FINANČNÍHO ŠTÍTU (FIREBASE APP CHECK V11)
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
        selectedLeague: null,
        selectedAdminLeague: null,
        isMenuOpen: false,
        isVip: false,
        isEditor: false,
        isAdmin: false,
        isSuperAdmin: false,
        nickname: '',
        isLive: false,
        leaderboardData: null
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

    window.selectLeague = (leagueName) => {
        const store = Alpine.store('appState');
        const bonusBox = document.querySelector('.bonus-collapse-box');

        // 🔐 PROFI ARCHITEKTURA: Čisté ID bez letopočtů. Rok je jen vizuální dekorace v HTML.
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

        let lastVerzeRozpisu = -1;
        let lastVerzeZebricku = -1;

        // Spínač pro otevření úsporného Pulsního real-time sledování (Bod 3)
        const zapniZiveStreamy = () => {
            if (window.globalLiveMenuUnsubscribe) return;
            console.log("📡 TUNING: Aktivuji úsporný Pulsní onSnapshot (Bod 3)!");
            
            window.globalLiveMenuUnsubscribe = onSnapshot(doc(window.db, 'ligy', leagueName, 'stav', 'puls'), async (pulsSnap) => {
                const { getDoc } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js");

                if (!pulsSnap.exists()) {
                    // Fallback ochrana: pokud puls neexistuje, jednorázově sosneme data natvrdo z cache/serveru
                    const rSnap = await getDoc(doc(window.db, 'ligy', leagueName, 'stav', 'rozpis'));
                    if (rSnap.exists()) {
                        const mapa = rSnap.data().zapasyMapa || {};
                        store.isLive = Object.values(mapa).some(zap => zap.apiStatus === "IN_PLAY" || zap.apiStatus === "PAUSED");
                    }
                    const lbSnap = await getDoc(doc(window.db, 'ligy', leagueName, 'stav', 'leaderboard'));
                    if (lbSnap.exists()) store.leaderboardData = lbSnap.data();
                    return;
                }

                const data = pulsSnap.data();
                const vRozpis = data.verzeRozpisu || 0;
                const vZebricek = data.verzeZebricku || 0;

                if (vRozpis !== lastVerzeRozpisu) {
                    lastVerzeRozpisu = vRozpis;
                    const rSnap = await getDoc(doc(window.db, 'ligy', leagueName, 'stav', 'rozpis'));
                    if (rSnap.exists()) {
                        const mapa = rSnap.data().zapasyMapa || {};
                        store.isLive = Object.values(mapa).some(zap => zap.apiStatus === "IN_PLAY" || zap.apiStatus === "PAUSED");
                        if (!store.isLive) {
                            setTimeout(() => window.naplanujZiveKanaly(leagueName), 10000);
                        }
                    }
                }

                if (vZebricek !== lastVerzeZebricku) {
                    lastVerzeZebricku = vZebricek;
                    const lbSnap = await getDoc(doc(window.db, 'ligy', leagueName, 'stav', 'leaderboard'));
                    if (lbSnap.exists()) store.leaderboardData = lbSnap.data();
                }
            });
        };

        // Seniorský plánovač: analyzuje rozpis a uspává aplikaci mimo hrací hodiny
        window.naplanujZiveKanaly = async (lName) => {
            if (store.currentScreen === 'leaguesScreen' || store.selectedLeague !== lName) return;
            try {
                const { getDoc } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js");
                const docSnap = await getDoc(doc(window.db, 'ligy', lName, 'stav', 'rozpis'));
                if (!docSnap.exists()) {
                    zapniZiveStreamy(); return;
                }
                
                const mapa = docSnap.data().zapasyMapa || {};
                const zapasy = Object.values(mapa);
                const nyni = Date.now();
                const beziZapas = zapasy.some(zap => zap.apiStatus === "IN_PLAY" || zap.apiStatus === "PAUSED");
                
                // Pokud zrovna teď na hřišti něco tiká, okamžitě držíme live stream zapnutý
                if (beziZapas) {
                    zapniZiveStreamy(); return;
                }

                let nejblizsiZapasMs = Infinity;
                zapasy.forEach(zap => {
                    let dMs = zap.datum?.toDate ? zap.datum.toDate().getTime() : (zap.datum?.seconds ? zap.datum.seconds * 1000 : new Date(zap.datum).getTime());
                    if (dMs > nyni && dMs < nejblizsiZapasMs) nejblizsiZapasMs = dMs;
                });

                // Naplníme store statickými daty z lokální cache bez spouštění onSnapshotu
                const lbSnap = await getDoc(doc(window.db, 'ligy', lName, 'stav', 'leaderboard'));
                if (lbSnap.exists()) store.leaderboardData = lbSnap.data();

                if (nejblizsiZapasMs === Infinity) {
                    console.log("⏱️ DETEKTOR: Žádné další budoucí zápasy. Stadion spí.");
                    if (window.globalLiveMenuUnsubscribe) { window.globalLiveMenuUnsubscribe(); window.globalLiveMenuUnsubscribe = null; }
                    if (window.globalLiveRozpisUnsubscribe) { window.globalLiveRozpisUnsubscribe(); window.globalLiveRozpisUnsubscribe = null; }
                    return;
                }

                // Spočítáme čas probuzení (15 minut před výkopem)
                const msDoZapnuti = (nejblizsiZapasMs - nyni) - (15 * 60 * 1000);
                if (msDoZapnuti <= 0) {
                    zapniZiveStreamy();
                } else {
                    console.log(`⏱️ DETEKTOR: Stadion spí. Živý stream se aktivuje za ${Math.round(msDoZapnuti / 60000)} minut.`);
                    if (window.globalLiveMenuUnsubscribe) { window.globalLiveMenuUnsubscribe(); window.globalLiveMenuUnsubscribe = null; }
                    if (window.globalLiveRozpisUnsubscribe) { window.globalLiveRozpisUnsubscribe(); window.globalLiveRozpisUnsubscribe = null; }
                    if (window.liveSchedulerTimeout) clearTimeout(window.liveSchedulerTimeout);
                    window.liveSchedulerTimeout = setTimeout(() => zapniZiveStreamy(), msDoZapnuti);
                }
            } catch (err) { console.error(err); zapniZiveStreamy(); }
        };

        window.naplanujZiveKanaly(leagueName);

        if (typeof window.renderMatches === 'function') {
            window.renderMatches(leagueName);
        }

        if (typeof window.loadBonusTips === 'function') {
            window.loadBonusTips(leagueName);
        }

        setTimeout(() => {
            const bonusBox = document.querySelector('.bonus-collapse-box');
            if (bonusBox && window.Alpine) { Alpine.$data(bonusBox).open = false; } 
            const mScreen = document.getElementById('matchesScreen');
            if (mScreen) mScreen.scrollTop = 0; 
        }, 50);
    };
});