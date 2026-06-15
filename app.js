// =========================================================================
// 🚀 TIPNI TO! - HLAVNÍ CORE SOUBOR (app.js)
// =========================================================================

const firebaseConfig = {
  apiKey: "AIzaSyAuJyI2f1sJP1GiBjW8019Bg6U7sq9ocr4",
  authDomain: "tipni-to.firebaseapp.com",
  projectId: "tipni-to",
  storageBucket: "tipni-to.firebasestorage.app",
  messagingSenderId: "528796783428",
  appId: "1:528796783428:web:08b0333dca077d88be3d11"
};

firebase.initializeApp(firebaseConfig);
// 🛡️ AKTIVACE ULTIMÁTNÍHO FINANČNÍHO ŠTÍTU (FIREBASE APP CHECK)
const appCheck = firebase.appCheck();
appCheck.activate(
    new firebase.appCheck.ReCaptchaV3Provider('6LemMiEtAAAAAH_PrIFI0yeP06zY1IQoelK9-q8K'),
    true // Automatické obnovování tokenu na pozadí appky
);

const db = firebase.firestore();
const auth = firebase.auth();

console.log("⚽ TIPNI TO! úspěšně propojeno s Firebase.");

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
        isLive: false // 🔥 Výchozí globální stav pro detekci LIVE zápasů
    });

    window.goToScreen = (screenName) => {
        const store = Alpine.store('appState');
        // 🔐 BEZPEČNOSTNÍ GILOTINA: Okamžitě zablokujeme pokusy o podvádění přes konzoli
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

        // 💾 PERSISTENCE: Uložení obrazovky do paměti telefonu (vyjma systémových oken)
        if (screenName !== 'splashScreen' && screenName !== 'loginScreen' && screenName !== 'nicknameScreen') {
            localStorage.setItem('savedScreen', screenName);
        }
        
        if (screenName === 'leaguesScreen') {
            store.selectedLeague = null;
            store.selectedAdminLeague = null;
            store.isLive = false;
            localStorage.removeItem('savedLeague');
            if (window.globalLiveMenuUnsubscribe) {
                window.globalLiveMenuUnsubscribe();
                window.globalLiveMenuUnsubscribe = null;
            }
        }
        
        if (screenName === 'leaderboardScreen' && typeof window.renderLeaderboard === 'function') {
            window.renderLeaderboard();
            setTimeout(() => {
                const lbScreen = document.getElementById('leaderboardScreen');
                if (lbScreen) lbScreen.scrollTop = 0; // 🔥 Vždy vyhodí žebříček nahoru na 1. místo!
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
                if (bonusBox && window.Alpine) { Alpine.$data(bonusBox).open = false; } // 🔒 Vždy zavře bonusovou roletku
                const mScreen = document.getElementById('matchesScreen');
                if (mScreen) mScreen.scrollTop = 0; // 🔥 Vždy přetočí zápasy na začátek rozpisu
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
        
        // 🚧 ENTERPRISE BLOKÁDA: Pustíme uživatele výhradně na MS ve fotbale
        if (leagueName !== 'MS ve fotbale' && leagueName !== 'MS ve fotbale 2026') {
            const container = document.querySelector('#matchesScreen .zebra-container');
            store.selectedLeague = leagueName;
            store.currentScreen = 'matchesScreen';
            store.isMenuOpen = false;
            
            // Schováme roletku s dlouhodobými bonusy, protože pro zamčenou ligu nedává smysl
            if (bonusBox) bonusBox.style.display = 'none';
            
            if (container) {
                container.innerHTML = `
                    <div class="enterprise-lock-box">
                        <div class="lock-icon">🚧</div>
                        <h3 class="lock-title">PROJECT MANAGER DIRECTIVE #2026</h3>
                        <p class="lock-text">
                            <strong>Přístup odepřen z důvodu stoprocentního fotbalového focusu!</strong><br><br>
                            Naše IT oddělení momentálně alokovalo veškerou výpočetní kapacitu, kofeinové zásoby a kreativní energii na <strong>MS VE FOTBALE</strong>. 
                        </p>
                        <div class="lock-status">STAV: Schováno pod kobercem na neurčito.</div>
                        <button class="action-btn btn-tip" onclick="window.goToScreen('leaguesScreen')" style="margin: 15px auto 0 auto; display: block; width: auto; padding: 10px 20px;">Vrátit se k fotbalu ⚽</button>
                    </div>
                `;
            }
            return;
        }

        // Pokud se vracíme na fotbal, roletku zase krásně ukážeme
        if (bonusBox) bonusBox.style.display = 'block';

        store.selectedLeague = leagueName;
        store.selectedAdminLeague = null;
        store.currentScreen = 'matchesScreen';
        store.isMenuOpen = false;
        console.log("Přepnuto na ligu:", leagueName);

        // 💾 PERSISTENCE: Uložíme vybranou ligu i novou cílovou obrazovku zápasů do paměti mobilu
        localStorage.setItem('savedLeague', leagueName);
        localStorage.setItem('savedScreen', 'matchesScreen');
        
        if (window.globalLiveMenuUnsubscribe) {
            window.globalLiveMenuUnsubscribe();
        }

        // 📡 RADAR: Nonstop sleduje stav bota a reaktivně mění text v menu i chování obrazovek
        window.globalLiveMenuUnsubscribe = db.collection('ligy').doc(leagueName).collection('stav').doc('zebricek')
            .onSnapshot(docSnap => {
                if (docSnap.exists) {
                    const lZapasy = docSnap.data().lZapasy || {};
                    store.isLive = Object.values(lZapasy).some(zap => zap.apiStatus === "IN_PLAY" || zap.apiStatus === "PAUSED");
                } else {
                    store.isLive = false;
                }
            });

        if (typeof window.renderMatches === 'function') {
            window.renderMatches(leagueName);
        }

        if (typeof window.loadBonusTips === 'function') {
            window.loadBonusTips(leagueName);
        }

        setTimeout(() => {
            const bonusBox = document.querySelector('.bonus-collapse-box');
            if (bonusBox && window.Alpine) { Alpine.$data(bonusBox).open = false; } // 🔒 Zavře bonusy při kliku z rozcestníku
            const mScreen = document.getElementById('matchesScreen');
            if (mScreen) mScreen.scrollTop = 0; // 🔥 Hodí zápasy na vrchol po kliku na ligu
        }, 50);
    };
});