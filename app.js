// =========================================================================
// 🚀 TIPNI TO! - HLAVNÍ CORE SOUBOR V11 MODULAR (app.js)
// =========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app-check.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAuJyI2f1sJP1GiBjW8019Bg6U7sq9ocr4",
  authDomain: "tipni-to.firebaseapp.com",
  projectId: "tipni-to",
  storageBucket: "tipni-to.firebasestorage.app",
  messagingSenderId: "528796783428",
  appId: "1:528796783428:web:08b0333dca077d88be3d11"
};

// Inicializace v11 instancí jako čisté ES6 pojmenované exporty
export const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    experimentalAutoDetectLongPolling: true 
});
export const auth = getAuth(app);

// Zpětná kompatibilita pro vanilkové provázání modulů
window.app = app; window.db = db; window.auth = auth;

// 👑 NEPRŮSTŘELNÝ ASYNC HYBRIDNÍ BOOTSTRAP: Garantuje registraci storu bez ohledu na Race Condition sítě
const vstrikniStoresDoPameti = () => {
    if (window.__tipniToStoresReady) return;
    window.__tipniToStoresReady = true;

    Alpine.store('appState', {
        currentScreen: 'splashScreen', 
        activeSeason: localStorage.getItem('savedSeason') || '2026_2027',
        dostupneSezony: [
            { id: '2026_2027', label: 'Sezóna 2026/2027', archived: false },
            { id: '2025_2026', label: 'Sezóna 2025/2026 (Archiv)', archived: true }
        ],
        get isArchived() {
            const vybranaSezona = this.dostupneSezony.find(s => s.id === this.activeSeason);
            return vybranaSezona ? vybranaSezona.archived : false;
        },
        selectedLeague: localStorage.getItem('savedLeague') || null,
        selectedAdminLeague: null,
        adminActiveTab: 'matches',
        adminMatches: [],
        adminUsers: [],
        adminMatchesLoaded: false,
        adminUsersLoaded: false,
        adminGlobalVitez: '',
        adminGlobalStrelec: '',
        loutkovodicOpen: false,
        loutkovodicTargetUid: '',
        loutkovodicTargetEmail: '',
        loutkovodicTargetNickname: '',
        loutkovodicSelectedLeague: '',
        loutkovodicBonusVitez: '',
        loutkovodicBonusStrelec: '',
        loutkovodicMatches: [],
        loutkovodicMatchesLoaded: false,
        isMenuOpen: false,
        isAdmin: false,
        isSuperAdmin: false,
        nickname: '',
        isLive: false,
        leagues: [],
        mojeTipy: {},
        mojeBonusy: {},
        mojeStatistiky: {},
        matchViewMode: 'upcoming',
        rozvrtaneTipy: {},
        vysledkyKolaIndex: 0, // Nezávislý index pro listování výhradně v záložce Výsledky
        godModeActive: false, // 🔄 Vlajka pro filtraci a přepínání Admin / Player světů přes štítek
        showScrollTop: false, // ⦡ Reaktivní stav pro zobrazení chytré šipky v hlavičce

        // Kontinuální časová osa se 100% bezpečným parsováním Firebase Timestampů pro localhost i produkci
        get serazenaTimelineZapasu() {
            if (!this._rozpisData || !this._rozpisData.zapasyMapa) return [];
            const parsujDatumBezpecne = (d) => {
                if (!d) return new Date();
                if (typeof d.toDate === 'function') return d.toDate();
                if (d && typeof d.seconds === 'number') return new Date(d.seconds * 1000);
                return new Date(d);
            };
            return Object.entries(this._rozpisData.zapasyMapa)
                .map(([id, z]) => {
                    const dObj = parsujDatumBezpecne(z.datum);
                    const dText = `${dObj.getDate()}. ${dObj.getMonth() + 1}. ${String(dObj.getHours()).padStart(2, '0')}:${String(dObj.getMinutes()).padStart(2, '0')}`;
                    return { ...z, id, datumObj: dObj, datumText: dText };
                })
                .sort((a, b) => a.datumObj - b.datumObj);
        },

        // Dynamická roletka pro Výsledky: Pouze kola, kde už existuje aspoň jeden zapsaný výsledek
        get unikatniKolaVysledku() {
            const vyhodnoceneZapasy = this.serazenaTimelineZapasu.filter(z => 
                z.vysledek_domaci !== undefined && z.apiStatus !== 'IN_PLAY' && z.apiStatus !== 'PAUSED'
            );
            const listKol = vyhodnoceneZapasy.map(z => window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff));
            return [...new Set(listKol)].filter(k => String(k).trim() !== '');
        },

        // Rozhodovací pipeline, která plní HTML šablonu čistými daty podle aktivní záložky
        get dynamickyFeedZapasu() {
            if (this.matchViewMode === 'results') {
                const vybraneKoloText = this.unikatniKolaVysledku[this.vysledkyKolaIndex];
                if (!vybraneKoloText) return [];
                return this.serazenaTimelineZapasu.filter(z => {
                    const jeVyhodnoceny = (z.vysledek_domaci !== undefined && z.apiStatus !== 'IN_PLAY' && z.apiStatus !== 'PAUSED');
                    return jeVyhodnoceny && window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff) === vybraneKoloText;
                });
            } else {
                // Budoucí zápasy: Botem předfiltrovaná osa bez Neznámých dvojic
                return this.serazenaTimelineZapasu.filter(z => {
                    const jeVyhodnoceny = (z.vysledek_domaci !== undefined && z.apiStatus !== 'IN_PLAY' && z.apiStatus !== 'PAUSED');
                    const obaNeznamy = (z.domaci === 'Neznámý' && z.hoste === 'Neznámý');
                    return !jeVyhodnoceny && !obaNeznamy;
                });
            }
        },

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
    
    // Aktivujeme kompletní navigační strom funkcí
    initTipniToAlpine();
};

if (window.Alpine) {
    vstrikniStoresDoPameti();
} else {
    document.addEventListener('alpine:init', vstrikniStoresDoPameti);
}
// 🛡️ INTELIGENTNÍ SÍŤOVÝ JISTIČ (Balíček 3): Na localhostu App Check vypínáme, abychom zlikvidovali chybu 403 a odemkli možnost okamžitého přihlášení.
if (location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider('6LemMiEtAAAAAH_PrIFI0yeP06zY1IQoelK9-q8K'),
        isTokenAutoRefreshEnabled: true
    });
    console.log("🛡️ APP CHECK: Finanční štít aktivován pro produkční stadion.");
} else {
    console.log("🐛 APP CHECK BYPASS: Detekován lokální stadion. App Check dočasně odpojen pro bezchybný login.");
}

console.log("⚽ TIPNI TO! úspěšně propojeno přes moderní Firebase v11 SDK s čistou offline cache.");
// Globalni odhlašovače živých radarů
window.globalLiveMenuUnsubscribe = null;

// --- ALPINE.JS INITIALIZATION ---
const initTipniToAlpine = () => {

    // ⚡ BLESKOVÉ CDN ÚLOŽIŠTĚ PRO ŽEBŘÍČKY A ROZPISY (CLOUDFLARE R2)
    const R2_BASE_URL = "https://pub-03310472e0f0459ab78ec11236373cd6.r2.dev";
    window.liveIntervalRadar = null;
    window.SEZONA_ID = localStorage.getItem('savedSeason') || "2026_2027";
    window.goToScreen = (screenName) => {
        if (typeof window.showSplash === 'function') window.showSplash("Načítání...");
        const store = Alpine.store('appState');
        
        store.showScrollTop = false; // ⦡ RESET ŠIPKY: Nová scrollovací scéna začíná vždy od absolutní nuly

        // 🚨 BALÍČEK 4: HYBRIDNÍ SÍŤOVÝ RADAR (Uspávání pro ochranu administrace)
        if (screenName === 'adminScreen' || screenName === 'superAdminScreen') {
            if (typeof window.globalLiveMenuUnsubscribe === 'function') {
                window.globalLiveMenuUnsubscribe();
            }
        } else if (store.selectedLeague && typeof window.naplanujZiveKanaly === 'function') {
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
            if (typeof window.globalLiveMenuUnsubscribe === 'function') { window.globalLiveMenuUnsubscribe(); }
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

        // 👑 UNIVERSÁLNÍ SCROLL JISTIČ: Počká na dokončení Alpine cyklu a zaručí 100% čistý start každé obrazovky od nuly
            if (typeof window.hideSplash === 'function') {
                if (typeof Alpine !== 'undefined' && Alpine.nextTick) {
                    Alpine.nextTick(() => {
                        window.hideSplash();
                        const scr = document.getElementById(screenName);
                        if (scr) scr.scrollTop = 0;
                    });
                } else {
                    window.hideSplash();
                    const scr = document.getElementById(screenName);
                    if (scr) scr.scrollTop = 0;
                }
            } else {
                const scr = document.getElementById(screenName);
                if (scr) scr.scrollTop = 0;
            }
    };

    // Seniorní enterprise překladový engine s inteligentní detekcí vyřazovacích bojů
    window.prelozFaziTurnaje = (stage, kolo, isPlayoff) => {
        const s = String(stage || '').toUpperCase();
        if (s === 'LAST_32') return 'Šestnáctifinále';
        if (s === 'LAST_16') return 'Osmifinále';
        if (s === 'QUARTER_FINALS') return 'Čtvrtfinále';
        if (s === 'SEMI_FINALS') return 'Semifinále';
        if (s === 'THIRD_PLACE') return 'Zápas o 3. místo';
        if (s === 'FINAL') return 'Finále';
        
        const k = String(kolo || '');
        if (k.includes('1')) return '1. kolo';
        if (k.includes('2')) return '2. kolo';
        if (k.includes('3')) return '3. kolo';
        
        // Pokud selžou specifické ligové dny, vytěžíme hardwarový příznak zápasu
        if (isPlayoff) return 'Play-off';
        return 'Základní skupiny';
    };

       // Čisté klientské přepínání stránek v uzavřeném karuselu Výsledků
    window.posunKoloVysledky = (smer) => {
        const store = Alpine.store('appState');
        // Pokud jsme v globálním přehledu (-1) a mačkáme šipku vpravo, skočíme elegantně na index 0
        if (store.vysledkyKolaIndex === -1 && smer === 1) {
            store.vysledkyKolaIndex = 0;
            return;
        }
        
        let novyIndex = store.vysledkyKolaIndex + smer;
        if (novyIndex >= 0 && novyIndex < store.unikatniKolaVysledku.length) {
            store.vysledkyKolaIndex = novyIndex;
        }
    };

    // ⦡ SMART SCROLL ENGINE: Najde aktivní běžící screen a plynule ho vyveze na absolutní vrchol
    window.scrollToTop = () => {
        const store = Alpine.store('appState');
        const aktivniScreenId = store.currentScreen;
        if (!aktivniScreenId) return;

        const kontejner = document.getElementById(aktivniScreenId);
        if (kontejner) {
            kontejner.scrollTo({
                top: 0,
                behavior: 'smooth' /* Plynulý prémiový dojezd bez trhání displeje */
            });
        }
    };

    window.zapniZiveStreamy = (leagueName) => {
        if (window.liveIntervalRadar) return;
        console.log("📡 TUNING: Aktivuji ultra-rychlý Cloudflare R2 Edge Radar!");
        const store = Alpine.store('appState');

        const ligaKlic = String(leagueName || '').replace(/ /g, "_");
        const sezonaId = store?.activeSeason || window.SEZONA_ID || "2025_2026";
        const pathPrefix = `sezony/${sezonaId}/${ligaKlic}`;

        const sosniDataZR2 = async () => {
            try {
                const [resLeaderboard, resRozpis] = await Promise.all([
                    fetch(`${R2_BASE_URL}/${pathPrefix}/leaderboard.json?t=${Date.now()}`),
                    fetch(`${R2_BASE_URL}/${pathPrefix}/rozpis.json?t=${Date.now()}`)
                ]);

                if (resRozpis.ok) {
                    const rData = await resRozpis.json();
                    store.rozpisData = rData;
                    store.isLive = rData.isLive || Object.values(rData.zapasyMapa || {}).some(zap => zap.apiStatus === "IN_PLAY" || zap.apiStatus === "PAUSED");
                    
                    if (store.currentScreen === 'matchesScreen' && typeof window.renderMatches === 'function') {
                        window.renderMatches(leagueName);
                    }
                }

                if (resLeaderboard.ok) {
                    const lbData = await resLeaderboard.json();
                    store.leaderboardData = lbData;
                    
                    // Zpětná klientská kompatibilita pro stávající logiku v render.js
                    window.globalniZebricek = lbData.zebricek || [];
                    window.globalniZebricekLive = lbData.zebricekLive || [];
                    window.mapaPrezdivek = lbData.mapaPrezdivek || {};
                    window.textKraliPresnosti = lbData.textKraliPresnosti || '–';
                    window.textRekordmaniKola = lbData.textRekordmaniKola || '–';

                    if (store.currentScreen === 'leaderboardScreen' && typeof window.renderLeaderboard === 'function') {
                        window.renderLeaderboard();
                    }
                }
            } catch (err) {
                console.warn("🚧 Cloudflare R2 Edge Radar: Soubory se na serveru připravují.");
            }
        };

        sosniDataZR2();
        window.liveIntervalRadar = setInterval(sosniDataZR2, 15000);

        window.globalLiveMenuUnsubscribe = () => {
            if (window.liveIntervalRadar) {
                clearInterval(window.liveIntervalRadar);
                window.liveIntervalRadar = null;
                console.log("💤 Cloudflare R2 Radar úspěšně vypnut a kompletně uspán.");
            }
        };
    };

    window.naplanujZiveKanaly = async (lName) => {
        window.zapniZiveStreamy(lName);
    };

    window.selectLeague = (leagueName) => {
        if (typeof window.showSplash === 'function') window.showSplash("Načítání...");
        const store = Alpine.store('appState');
        const bonusBox = document.querySelector('.bonus-collapse-box');

    window.changeSeason = (sezonaId) => {
        const store = Alpine.store('appState');
        if (!store) return;
        
        store.activeSeason = sezonaId;
        localStorage.setItem('savedSeason', sezonaId);
        window.SEZONA_ID = sezonaId;

        const label = store.dostupneSezony.find(s => s.id === sezonaId)?.label || sezonaId;
        window.showToast(`📅 Přepnuto: ${label}`);

        // Pokud máme vybranou ligu, restartujeme R2 stream pro stažení dat dané sezóny
        if (store.selectedLeague) {
            if (window.globalLiveMenuUnsubscribe) { window.globalLiveMenuUnsubscribe(); window.globalLiveMenuUnsubscribe = null; }
            window.naplanujZiveKanaly(store.selectedLeague);
        }
    };

        if (!store.isSuperAdmin && (!store.leagues || !store.leagues.includes(leagueName))) {
            window.showToast("Do této tipovačky tě admin ještě neschválil! 🚧", true);
            if (typeof window.hideSplash === 'function') window.hideSplash();
            return;
        }
        
        store.selectedLeague = leagueName;
        store.selectedAdminLeague = null;
        store.currentScreen = 'matchesScreen';
        store.isMenuOpen = false;
        
        store.rozpisData = null;
        store.leaderboardData = null;

        localStorage.setItem('savedLeague', leagueName);
        localStorage.setItem('savedScreen', 'matchesScreen');

        if (bonusBox) {
            bonusBox.style.display = (leagueName === 'MS ve fotbale') ? 'block' : 'none';
        }
        
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
// ⦡ LASEROVÁ FOTOBUNKA UTKÁNÍ: Sleduje viditelnost toolbarů bez zatěžování procesoru telefonu
    const inicializujLaseroveSledovaniScrollu = () => {
        const store = Alpine.store('appState');
        
        const laserovyObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const srovnavaciScreen = entry.target.closest('.screen-scroll');
                
                // 🛡️ SENIORNÍ POJISTKA: Reagujeme pouze na toolbar, který žije v zrovna aktivní obrazovce
                if (srovnavaciScreen && srovnavaciScreen.id === store.currentScreen) {
                    if (entry.isIntersecting) {
                        store.showScrollTop = false; // Toolbar je na očích, šipku netřeba
                    } else if (entry.boundingClientRect.top < 0) {
                        store.showScrollTop = true; // Toolbar ujel nahoru pod zelenou lištu -> ROZSVÍTIT ŠIPKU!
                    }
                }
            });
        }, {
            root: null, // Sleduje výřez průzoru globálního viewportu
            threshold: 0 // Sepne okamžitě, jakmile zmizí poslední pixel lišty
        });

        // Připíchneme sledování na všechny navigační toolbary napříč celou aplikací
        document.querySelectorAll('.menu-inline-micro-toolbar').forEach(toolbar => {
            laserovyObserver.observe(toolbar);
        });
    };

    // Odpálíme fotobuňku bezpečně a bez časovačů na základě stavu Alpine enginu
    if (typeof Alpine !== 'undefined') {
        Alpine.nextTick(() => inicializujLaseroveSledovaniScrollu());
    } else {
        /* 🛡️ SENIORNÍ POJISTKA: Neuhadujeme milisekundy. Počkáme, až Alpine nativně ohlásí kompletní inicializaci DOMu */
        document.addEventListener('alpine:initialized', () => {
            inicializujLaseroveSledovaniScrollu();
        });
    }
// 📊 TOURNAMENT LIFECYCLE: Bezpečně spočítá, zda už padl první herní gól nebo uplynul čas výkopu
    window.isLeagueStarted = () => {
        const store = Alpine.store('appState');
        if (!store.serazenaTimelineZapasu || store.serazenaTimelineZapasu.length === 0) return false;

        // 1. Kontrola času: Je čas startu úplně prvního zápasu v minulosti?
        const prvniZapas = store.serazenaTimelineZapasu[0];
        const casStartu = prvniZapas.timestamp || prvniZapas.dateTimestamp || 0;
        if (casStartu > 0 && casStartu < Date.now()) return true;

        // 2. Kontrola stavu: Běží už live přenos, nebo už existuje nějaký hotový výsledek?
        const uzSeHrajeNeboDohralo = store.serazenaTimelineZapasu.some(m => 
            m.isLive || 
            m.status === 'live' || 
            m.status === 'finished' || 
            m.vysledek_domaci !== undefined && m.vysledek_domaci !== null
        );

        return uzSeHrajeNeboDohralo;
    };
// 🏆 PLAYOFF INTERACTIVE TOGGLER: Změní tip na postup na jeden klik a okamžitě seřadí UI
    window.nastavPostup = (matchId, volba) => {
        const store = Alpine.store('appState');
        if (!store.mojeTipy || !store.mojeTipy[matchId]) return;
        
        // 1. Okamžitý reaktivní flip v paměti pro bleskové překlopení zelené barvy a ruky 👉
        store.mojeTipy[matchId].postup = volba;
        
        // 2. Automatické natlačení změny do Firebase/LS přes existující ukládací rutiny, pokud jsou dostupné
        if (typeof window.ulozSingleTip === 'function') {
            window.ulozSingleTip(matchId);
        } else if (typeof window.saveTipToFirebase === 'function') {
            window.saveTipToFirebase(matchId);
        }
    };
};

// 📱 CENTRÁLNÍ JISTIČ BATERIE A DAT (PAGE VISIBILITY API)
document.addEventListener("visibilitychange", () => {
    const store = window.Alpine?.store('appState');
    if (!store || !store.selectedLeague) return;

    if (document.hidden) {
        // Mobil schovaný v kapse nebo zhasnutý displej -> okamžitě zmrazíme internetovou aktivitu
        if (window.globalLiveMenuUnsubscribe) {
            window.globalLiveMenuUnsubscribe();
            window.globalLiveMenuUnsubscribe = null;
        }
        console.log("🔋 BATERIE ŠTÍT: Aplikace na pozadí, Netlify radar kompletně USPÁN.");
    } else {
        // Uživatel otevřel oči a rozsvítil appku -> radar bleskově probudíme k životu
        console.log("📱 BATERIE ŠTÍT: Uživatel je zpět, probouzím Netlify radar...");
        window.lastVerzeRozpisu = -1;
        window.lastVerzeZebricku = -1;
        window.naplanujZiveKanaly(store.selectedLeague);
    }
});

// 🎯 SMART NAVIGATOR: Otevře výsledky a okamžitě nalistuje poslední dostupné kolo v roletce
window.otevriVysledky = () => {
    window.goToScreen('matchesScreen');
    const store = Alpine.store('appState');
    if (!store) return;
    
    store.matchViewMode = 'results';

    // Pokud nemáme žádná vyhodnocená kola, začínáme bezpečně na indexu 0
    if (!store.unikatniKolaVysledku || store.unikatniKolaVysledku.length === 0) {
        store.vysledkyKolaIndex = 0;
        return;
    }

    // 🚀 POSLEDNÍ PRVEK: Skočíme rovnou na konec pole, kde žije nejčerstvější odehraná fáze
    store.vysledkyKolaIndex = store.unikatniKolaVysledku.length - 1;
};