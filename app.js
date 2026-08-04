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
			{ id: '2026_2027', label: 'Sezóna 2026/2027', archived: false }
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
        _leagues: [],
        leagueFilterTick: 0,

        // 🙈 INTELIGENTNÍ AUTOMATICKÝ FILTR LIG (Při prvním startu bez keše počká na kompletní stažení z R2)
        get leagues() {
            const _tick = this.leagueFilterTick;
            const MASTER_LIGY = ["Chance Liga", "Premier League", "Liga národů", "MS ve fotbale", "Tipsport Extraliga", "MS v hokeji"];
            const zakladniSeznam = this.isSuperAdmin ? MASTER_LIGY : (this._leagues || []);

            if (!zakladniSeznam || !Array.isArray(zakladniSeznam) || zakladniSeznam.length === 0) return [];

            const sezId = this.activeSeason || window.SEZONA_ID || "2026_2027";
            return zakladniSeznam.filter(liga => {
                const lKlic = String(liga).replace(/ /g, "_");
                try {
                    const cached = localStorage.getItem(`tipni_cache_rozpis_${sezId}_${lKlic}`);
                    if (cached) {
                        const parsed = JSON.parse(cached);
                        if (parsed && (parsed.hasMatches === false || (parsed.zapasyMapa && Object.keys(parsed.zapasyMapa).length === 0))) {
                            return false; // Skrýt ligu bez zápasů
                        }
                    } else {
                        // 🛡️ SENIOR GUARD: Dokud prefetch nedokončí prověření všech lig z R2, neověřené ligy nezobrazujeme
                        if (!this.isLeaguesReady) return false;
                    }
                } catch(e) {}
                return true;
            });
        },
        set leagues(val) {
            this._leagues = val;
            this.leagueFilterTick++;
        },
        rawSezonaData: {}, // 📦 Ukládá kompletní surový balík sezóny pro bleskové vytažení tipů
	mojeTipy: {},
        mojeBonusy: {},
        mojeStatistiky: {},
        matchViewMode: 'upcoming',
        rozvrtaneTipy: {},
        vysledkyKolaIndex: 0, // Nezávislý index pro listování výhradně v záložce Výsledky
        godModeActive: false, // 🔄 Vlajka pro filtraci a přepínání Admin / Player světů přes štítek
        showScrollTop: false, // ⦡ Reaktivní stav pro zobrazení chytré šipky v hlavičce
        canInstallPwa: false, // 📲 Reaktivní stav pro tlačítko instalace PWA

        adminKolaIndex: 0, // Index vybraného kola v Admin karuselu
        cacheTimeline: [], // 🚀 BLESKOVÁ MEMOIZOVANÁ PAMĚŤ (0ms zpoždění)

        // 👑 ADMIN: Unikátní seznam všech kol v administraci
        get unikatniKolaAdminu() {
            if (!this.adminMatches || this.adminMatches.length === 0) return [];
            const listKol = this.adminMatches.map(m => window.prelozFaziTurnaje(m.stage, m.kolo, m.isPlayoff));
            return [...new Set(listKol)].filter(k => String(k).trim() !== '');
        },

        // 👑 ADMIN: Dynamický feed zápasů vyfiltrovaných podle zvoleného kola v karuselu
        get dynamickyFeedAdminZapasu() {
            if (!this.adminMatches || this.adminMatches.length === 0) return [];
            const kola = this.unikatniKolaAdminu;
            if (kola.length === 0) return this.adminMatches;
            
            const vybraneKolo = kola[this.adminKolaIndex] || kola[0];
            return this.adminMatches.filter(m => window.prelozFaziTurnaje(m.stage, m.kolo, m.isPlayoff) === vybraneKolo);
        },

        obnovCacheTimeline() {
            if (!this._rozpisData || !this._rozpisData.zapasyMapa) {
                this.cacheTimeline = [];
                return;
            }
            const parsujDatumBezpecne = (d) => {
                if (!d) return new Date();
                if (typeof d.toDate === 'function') return d.toDate();
                if (d && typeof d.seconds === 'number') return new Date(d.seconds * 1000);
                return new Date(d);
            };
            this.cacheTimeline = Object.entries(this._rozpisData.zapasyMapa)
                .map(([id, z]) => {
                    const dObj = parsujDatumBezpecne(z.datum);
                    const dText = `${dObj.getDate()}. ${dObj.getMonth() + 1}. ${String(dObj.getHours()).padStart(2, '0')}:${String(dObj.getMinutes()).padStart(2, '0')}`;
                    return { ...z, id, datumObj: dObj, datumText: dText };
                })
                .sort((a, b) => a.datumObj - b.datumObj);
        },

        get serazenaTimelineZapasu() {
            if (this.cacheTimeline.length === 0 && this._rozpisData?.zapasyMapa) {
                this.obnovCacheTimeline();
            }
            return this.cacheTimeline;
        },

        // 🔍 DETEKTOR 2 NEJBLIŽŠÍCH NADCHÁZEJÍCÍCH KOL PRO PROGRAM
        get nejblizsi2KolaProgramu() {
            const budouciZapasy = this.serazenaTimelineZapasu.filter(z => {
                const jeVyhodnoceny = (z.vysledek_domaci !== undefined && z.apiStatus !== 'IN_PLAY' && z.apiStatus !== 'PAUSED');
                const obaNeznamy = (z.domaci === 'Neznámý' && z.hoste === 'Neznámý');
                return !jeVyhodnoceny && !obaNeznamy;
            });
            const kola = [];
            for (const z of budouciZapasy) {
                const k = window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff);
                if (k && !kola.includes(k)) {
                    kola.push(k);
                    if (kola.length === 2) break;
                }
            }
            return kola;
        },

        // 🔍 DETEKTOR 2 POSLEDNÍCH ODEHRANÝCH KOL PRO VÝSLEDKY
        get posledni2KolaVysledku() {
            const odehrane = this.serazenaTimelineZapasu.filter(z => 
                z.vysledek_domaci !== undefined && z.apiStatus !== 'IN_PLAY' && z.apiStatus !== 'PAUSED'
            );
            const kola = [];
            for (let i = odehrane.length - 1; i >= 0; i--) {
                const k = window.prelozFaziTurnaje(odehrane[i].stage, odehrane[i].kolo, odehrane[i].isPlayoff);
                if (k && !kola.includes(k)) {
                    kola.push(k);
                    if (kola.length === 2) break;
                }
            }
            return kola;
        },

        // Dynamická roletka pro Výsledky
        get unikatniKolaVysledku() {
            const vyhodnocene = this.serazenaTimelineZapasu.filter(z => 
                z.vysledek_domaci !== undefined && z.apiStatus !== 'IN_PLAY' && z.apiStatus !== 'PAUSED'
            );
            const listKol = vyhodnocene.map(z => window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff));
            const unikatni = [...new Set(listKol)].filter(k => String(k).trim() !== '');
            return ['Poslední zápasy', ...unikatni];
        },

        // Dynamická roletka pro Program utkání
        get unikatniKolaProgramu() {
            const budouci = this.serazenaTimelineZapasu.filter(z => {
                const jeVyhodnoceny = (z.vysledek_domaci !== undefined && z.apiStatus !== 'IN_PLAY' && z.apiStatus !== 'PAUSED');
                const obaNeznamy = (z.domaci === 'Neznámý' && z.hoste === 'Neznámý');
                return !jeVyhodnoceny && !obaNeznamy;
            });
            const listKol = budouci.map(z => window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff));
            const unikatni = [...new Set(listKol)].filter(k => String(k).trim() !== '');
            return ['Nadcházející zápasy', ...unikatni];
        },

        // Rozhodovací pipeline, která plní HTML šablonu čistými daty
        get dynamickyFeedZapasu() {
            if (this.matchViewMode === 'results') {
                const vyhodnocene = this.serazenaTimelineZapasu.filter(z => 
                    z.vysledek_domaci !== undefined && z.apiStatus !== 'IN_PLAY' && z.apiStatus !== 'PAUSED'
                );
                const vybranaVolba = this.unikatniKolaVysledku[this.vysledkyKolaIndex] || 'Poslední zápasy';

                if (this.vysledkyKolaIndex === 0 || vybranaVolba === 'Poslední zápasy') {
                    const posl2 = this.posledni2KolaVysledku;
                    return vyhodnocene.filter(z => posl2.includes(window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff)));
                } else {
                    return vyhodnocene.filter(z => window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff) === vybranaVolba);
                }
            } else {
                const budouciZapasy = this.serazenaTimelineZapasu.filter(z => {
                    const jeVyhodnoceny = (z.vysledek_domaci !== undefined && z.apiStatus !== 'IN_PLAY' && z.apiStatus !== 'PAUSED');
                    const obaNeznamy = (z.domaci === 'Neznámý' && z.hoste === 'Neznámý');
                    return !jeVyhodnoceny && !obaNeznamy;
                });

                const vybranaVolba = this.unikatniKolaProgramu[this.programKolaIndex] || 'Nadcházející zápasy';

                if (this.programKolaIndex === 0 || vybranaVolba === 'Nadcházející zápasy') {
                    const nej2 = this.nejblizsi2KolaProgramu;
                    return budouciZapasy.filter(z => nej2.includes(window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff)));
                } else {
                    return budouciZapasy.filter(z => window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff) === vybranaVolba);
                }
            }
        },

        // 🧮 AUTOMATICKÝ SOUČET BODŮ PRO PRÁVĚ ZOBRAZENÉ KOLO VE VÝSLEDCÍCH
        get bodyAktualnihoFeedu() {
            const feed = this.serazenaTimelineZapasu;
			if (!feed || feed.length === 0) return 0;
			const league = this.selectedLeague;
			let total = 0;

            feed.forEach(match => {
                const tip = this.mojeTipy[match.id];
                const tDomaci = tip ? tip.tip_domaci : undefined;
                const tHoste = tip ? tip.tip_hoste : undefined;
				const tPostup = tip ? tip.postup : '';

				if (match.vysledek_domaci !== undefined || match.apiStatus === 'IN_PLAY' || match.apiStatus === 'PAUSED') {
					const jeNenatipovano = tDomaci === undefined || tDomaci === null || tDomaci === '';
					if (jeNenatipovano) {
						const pravidla = window.PRAVIDLA_LIG?.[league] || window.PRAVIDLA_LIG?.["DEFAULT"];
						total += (pravidla?.penaltyNenatipovano || 0);
					} else if (typeof window.vypocitejBodyZapasu === 'function') {
						total += window.vypocitejBodyZapasu(tDomaci, tHoste, match.vysledek_domaci, match.vysledek_hoste, league, tPostup, match.postup, match.isPlayoff, match.isTopMatch);
					}
				}
			});

			return total;
		},

        _rozpisData: null,
        _leaderboardData: null,

        get rozpisData() { return this._rozpisData; },
        set rozpisData(val) {
            this._rozpisData = val;
            if (val && this.selectedLeague) {
                const sezId = this.activeSeason || '2026_2027';
                const lKlic = String(this.selectedLeague).replace(/ /g, '_');
                try { localStorage.setItem(`tipni_cache_rozpis_${sezId}_${lKlic}`, JSON.stringify(val)); } catch(e){}
            }
            this.obnovCacheTimeline();
        },

        get leaderboardData() { return this._leaderboardData; },
        set leaderboardData(val) {
            this._leaderboardData = val;
            if (val && this.selectedLeague) {
                const sezId = this.activeSeason || '2026_2027';
                const lKlic = String(this.selectedLeague).replace(/ /g, '_');
                try { localStorage.setItem(`tipni_cache_lb_${sezId}_${lKlic}`, JSON.stringify(val)); } catch(e){}
            }
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
            // 🎯 RESET DRŽÁKU POZICE PŘI VSTUPU DO ADMINU ODJINUD
            window.adminLeagueKoloInitialized = false;
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
        
        if (isPlayoff) return 'Play-off';

        const k = String(kolo || '').trim();
        if (k && k !== 'Šampionát') return k;
        
        return 'Základní skupiny';
    };

       // Čisté klientské přepínání stránek v uzavřeném karuselu Výsledků
    // Čisté klientské přepínání stránek v karuselu Výsledků
    window.posunKoloVysledky = (smer) => {
        const store = Alpine.store('appState');
        
        // Skok doleva z "Poslední zápasy": Přeskočíme kola, která už jsou v posledních zápasech
        if (smer < 0 && store.vysledkyKolaIndex === 0) {
            const posl2 = store.posledni2KolaVysledku || [];
            let novyIdx = store.unikatniKolaVysledku.length - 1;
            for (let i = store.unikatniKolaVysledku.length - 1; i >= 1; i--) {
                const koloNazev = store.unikatniKolaVysledku[i];
                if (!posl2.includes(koloNazev)) {
                    novyIdx = i;
                    break;
                }
            }
            if (novyIdx >= 1) {
                store.vysledkyKolaIndex = novyIdx;
            }
            return;
        }

        let novyIndex = store.vysledkyKolaIndex + smer;
        if (novyIndex >= 0 && novyIndex < store.unikatniKolaVysledku.length) {
            store.vysledkyKolaIndex = novyIndex;
        }
    };

    // 🎯 CHYTRÝ KARUSEL PROGRAMU: Skok z "Nadcházející zápasy" (Index 0) přeskočí všechna již zobrazená kola
    window.posunKoloProgram = (smer) => {
        const store = Alpine.store('appState');
        if (!store || !store.unikatniKolaProgramu || store.unikatniKolaProgramu.length === 0) return;

        // Skok DOPRAVA z "Nadcházející zápasy" (Index 0)
        if (smer > 0 && store.programKolaIndex === 0) {
            const nej2 = store.nejblizsi2KolaProgramu || []; // Např. ["1. kolo", "2. kolo"]
            let targetIdx = 1;
            while (targetIdx < store.unikatniKolaProgramu.length) {
                const koloNazev = store.unikatniKolaProgramu[targetIdx];
                if (!nej2.includes(koloNazev)) {
                    break; // Najde první kolo, které NENÍ zobrazené na displeji (např. "3. kolo")
                }
                targetIdx++;
            }
            if (targetIdx < store.unikatniKolaProgramu.length) {
                store.programKolaIndex = targetIdx;
                return;
            } else {
                // Pokud jsou všechna nadcházející kola již na displeji, nikam dál neskáče
                return;
            }
        }

        // Standardní posun o krok
        let novyIndex = store.programKolaIndex + smer;
        if (novyIndex >= 0 && novyIndex < store.unikatniKolaProgramu.length) {
            store.programKolaIndex = novyIndex;
        }
    };

    // Čisté klientské přepínání stránek v karuselu Admin panelu
    window.posunKoloAdmin = (smer) => {
        const store = Alpine.store('appState');
        let novyIndex = store.adminKolaIndex + smer;
        if (novyIndex >= 0 && novyIndex < store.unikatniKolaAdminu.length) {
            store.adminKolaIndex = novyIndex;
            if (typeof window.autoSmrskniPismoTymu === 'function') {
                setTimeout(() => window.autoSmrskniPismoTymu('#adminMatchesContainer'), 50);
            }
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
        const sezonaId = store?.activeSeason || window.SEZONA_ID || "2026_2027";
        const pathPrefix = `sezony/${sezonaId}/${ligaKlic}`;

        const sosniDataZR2 = async () => {
            try {
                // ⚡ CHYTRÁ KEŠ: Razítko se mění max 1x za 30 sekund -> mobil tak zbytečně nesype stejný soubor
                const keshRazitko = Math.floor(Date.now() / 30000);
                const [resLeaderboard, resRozpis] = await Promise.all([
                    fetch(`${R2_BASE_URL}/${pathPrefix}/leaderboard.json?v=${keshRazitko}`),
                    fetch(`${R2_BASE_URL}/${pathPrefix}/rozpis.json?v=${keshRazitko}`)
                ]);

                if (resRozpis.ok) {
                    const rData = await resRozpis.json();
                    
                    // 🧠 SENIORNÍ DOM DIFFING: Zamezí re-renderu Alpine Storu, pokud jsou data z R2 totožná s pamětí
                    const novyHash = JSON.stringify(rData);
                    if (window.__lastRozpisHash !== novyHash) {
                        window.__lastRozpisHash = novyHash;
                        store.rozpisData = rData;
                    }

                    store.isLive = rData.isLive || Object.values(rData.zapasyMapa || {}).some(zap => zap.apiStatus === "IN_PLAY" || zap.apiStatus === "PAUSED");
                    
                    if (typeof Alpine !== 'undefined' && Alpine.nextTick) {
                        Alpine.nextTick(() => {
                            if (typeof window.autoSmrskniPismoTymu === 'function') window.autoSmrskniPismoTymu('#userMatchesContainer');
                        });
                    }
                }

                if (resLeaderboard.ok) {
                    const lbData = await resLeaderboard.json();
                    
                    const novyLbHash = JSON.stringify(lbData);
                    if (window.__lastLbHash !== novyLbHash) {
                        window.__lastLbHash = novyLbHash;
                        store.leaderboardData = lbData;
                    }
                    
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

    window.changeSeason = (sezonaId) => {
        const store = Alpine.store('appState');
        if (!store) return;
        
        store.activeSeason = sezonaId;
        localStorage.setItem('savedSeason', sezonaId);
        window.SEZONA_ID = sezonaId;

        const label = store.dostupneSezony.find(s => s.id === sezonaId)?.label || sezonaId;
        if (typeof window.showToast === 'function') {
            window.showToast(`📅 Přepnuto: ${label}`);
        }

        // 🎯 BLESKOVÝ RE-SUBSCRIBE SLUCHÁTKA TIPŮ PRO NOVOU SEZÓNU
        const currentUser = window.auth?.currentUser;
        if (currentUser && typeof window.obnovSluchatkoMojeTipy === 'function') {
            window.obnovSluchatkoMojeTipy(currentUser.uid);
        }

        store.leagueFilterTick++; // 🔔 Okamžitá reevaluace filtru lig pro novou sezónu

        if (store.selectedLeague) {
            if (window.globalLiveMenuUnsubscribe) { window.globalLiveMenuUnsubscribe(); window.globalLiveMenuUnsubscribe = null; }
            window.naplanujZiveKanaly(store.selectedLeague);
        }

        if (typeof window.prefetchVsechnyLigy === 'function') {
            window.prefetchVsechnyLigy();
        }
    };

    // 🏎️ PROFI SENIOR LEAGUE SELECTOR (0 ms LATENCY / SWR PATTERN)
    window.selectLeague = (leagueName) => {
        const store = Alpine.store('appState');
        const bonusBox = document.querySelector('.bonus-collapse-box');

        const povoleneLigy = store._leagues && store._leagues.length > 0 ? store._leagues : store.leagues;
        if (!store.isSuperAdmin && (!povoleneLigy || !povoleneLigy.includes(leagueName))) {
            if (typeof window.showToast === 'function') window.showToast("Do této tipovačky tě admin ještě neschválil! 🚧", true);
            if (typeof window.hideSplash === 'function') window.hideSplash();
            return;
        }

        // 🚀 BLESKOVÝ INSTANT RENDER Z LOCALSTORAGE (0 ms prodleva)
        const sezId = store.activeSeason || window.SEZONA_ID || "2026_2027";
        const lKlic = String(leagueName).replace(/ /g, "_");
        let maNacitanouKesi = false;

        try {
            const cachedRozpis = localStorage.getItem(`tipni_cache_rozpis_${sezId}_${lKlic}`);
            if (cachedRozpis) {
                window.__lastRozpisHash = cachedRozpis;
                store.rozpisData = JSON.parse(cachedRozpis);
                maNacitanouKesi = true;
            }
            const cachedLb = localStorage.getItem(`tipni_cache_lb_${sezId}_${lKlic}`);
            if (cachedLb) {
                window.__lastLbHash = cachedLb;
                store.leaderboardData = JSON.parse(cachedLb);
            }
        } catch (e) {}

        // 🛡️ SPLASH OTEVÍRÁME POUZE POKUD JE CACHE ZCELA PRÁZDNÁ (První start appky)
        if (!maNacitanouKesi && typeof window.showSplash === 'function') {
            window.showSplash("Načítání...");
        }

        store.selectedLeague = leagueName;
		store.selectedAdminLeague = null;
		store.currentScreen = 'matchesScreen';
		store.matchViewMode = 'upcoming';
		store.programKolaIndex = 0;
		store.isMenuOpen = false;

		// 🎯 BLESKOVÝ PROPOJOVAČ: Vytáhne z paměti tipy přesně pro tuto vybranou ligu!
		if (typeof window.aktualizujMojeTipyProLigu === 'function') {
			window.aktualizujMojeTipyProLigu(leagueName);
		}

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

        // 📡 TICHÁ KONTROLA Z R2 NA POZADÍ
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

        // 🔮 BACKGROUND PREFETCHER: Tichý předehřev ostatních lig do cache
        if (typeof window.prefetchVsechnyLigy === 'function') {
            setTimeout(() => window.prefetchVsechnyLigy(), 1000);
        }
    };

    // 🔮 ASYNC PREFETCHER: Počká na kompletní prověření všech lig a zobrazí je až po stažení
    window.prefetchVsechnyLigy = async () => {
        const store = Alpine.store('appState');
        if (store) store.isLeaguesReady = false;

        const MASTER_LIGY = ["Chance Liga", "Premier League", "Liga národů", "MS ve fotbale", "Tipsport Extraliga", "MS v hokeji"];
        const seznamKeKontrole = store?._leagues && store._leagues.length > 0 ? store._leagues : MASTER_LIGY;
        if (!seznamKeKontrole || seznamKeKontrole.length === 0) return;
        
        const sezId = store?.activeSeason || window.SEZONA_ID || "2026_2027";
        const keshRazitko = Math.floor(Date.now() / 30000);

        const sliby = seznamKeKontrole.map(lName => {
            const lKlic = String(lName).replace(/ /g, "_");
            const pathPrefix = `sezony/${sezId}/${lKlic}`;
            
            return fetch(`${R2_BASE_URL}/${pathPrefix}/rozpis.json?v=${keshRazitko}`)
                .then(r => {
                    if (r.status === 404) {
                        return { zapasyMapa: {}, hasMatches: false };
                    }
                    return r.ok ? r.json() : null;
                })
                .then(rData => {
                    if (rData) {
                        try { 
                            localStorage.setItem(`tipni_cache_rozpis_${sezId}_${lKlic}`, JSON.stringify(rData)); 
                        } catch(e){}
                    }
                }).catch(() => {});
        });

        await Promise.all(sliby);
        if (store) {
            store.isLeaguesReady = true;
            store.leagueFilterTick++;
        }
    };

    // 🚀 OKAMŽITÝ START PREFETCHERU PŘI SPOŠTĚNÍ
    if (typeof window.prefetchVsechnyLigy === 'function') {
        window.prefetchVsechnyLigy();
    }

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

// 🎯 POMOCNÝ VYTAHOVAČ A SYNCHRONIZÁTOR TIPŮ PRO VYBRANOU LIGU
	window.aktualizujMojeTipyProLigu = (leagueName) => {
		const store = Alpine.store('appState');
		if (!store) return;
		const lName = leagueName || store.selectedLeague || localStorage.getItem('savedLeague') || 'Chance Liga';
		const ligaKlic = String(lName).replace(/ /g, '_');
		const souteze = store.rawSezonaData?.souteze || {};
		const soutezData = souteze[ligaKlic] || {};

		store.mojeTipy = soutezData.tipy || {};
		store.mojeBonusy = soutezData.bonusy || {};
		store.mojeStatistiky = soutezData.statistiky || {};

		// 🚦 AUTO-FILL ROLETOEK: Předvyplníme živé roletky z DB pro bílý stav (is-saved)
		if (store.mojeTipy) {
			Object.keys(store.mojeTipy).forEach(matchId => {
				const tip = store.mojeTipy[matchId];
				if (tip && tip.tip_domaci !== undefined && tip.tip_hoste !== undefined) {
					store.rozvrtaneTipy[`${matchId}_domaci`] = String(tip.tip_domaci);
					store.rozvrtaneTipy[`${matchId}_hoste`] = String(tip.tip_hoste);
				}
			});
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

// 🎯 SMART NAVIGATOR: Otevře výsledky a při přechodu odjinud nastaví první náhled kola
window.otevriVysledky = () => {
    const store = Alpine.store('appState');
    if (store) {
        store.matchViewMode = 'results';
        store.vysledkyKolaIndex = 0; // Skok na "Poslední zápasy" pouze při kliknutí na tlačitko v navigaci
    }
    window.goToScreen('matchesScreen');
};

// 🎯 SMART PROGRAM: Otevře program utkání a při přechodu odjinud nastaví prvotní náhled nadcházejících kol
window.otevriProgramUtkani = () => {
    const store = Alpine.store('appState');
    if (store) {
        store.matchViewMode = 'upcoming';
        store.programKolaIndex = 0; // Skok na "Nadcházející zápasy" pouze při kliknutí na tlačítko v navigaci
    }
    window.goToScreen('matchesScreen');
};

// =========================================================================
// 📲 PWA INSTALLATION ENGINE (PŘÍMÁ INSTALACE Z HAMBURGER MENU)
// =========================================================================
let deferredPwaPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPwaPrompt = e;
    const store = window.Alpine?.store('appState');
    if (store && !window.matchMedia('(display-mode: standalone)').matches) {
        store.canInstallPwa = true;
    }
});

window.addEventListener('appinstalled', () => {
    deferredPwaPrompt = null;
    const store = window.Alpine?.store('appState');
    if (store) store.canInstallPwa = false;
    console.log("🎉 PWA Aplikace úspěšně nainstalována do zařízení!");
});

window.triggerPwaInstall = async () => {
    if (!deferredPwaPrompt) return;
    deferredPwaPrompt.prompt();
    const { outcome } = await deferredPwaPrompt.userChoice;
    if (outcome === 'accepted') {
        const store = window.Alpine?.store('appState');
        if (store) store.canInstallPwa = false;
    }
    deferredPwaPrompt = null;
};