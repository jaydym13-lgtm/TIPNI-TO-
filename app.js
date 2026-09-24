// =========================================================================
// 🚀 TIPNI TO! - HLAVNÍ CORE SOUBOR V11 MODULAR (app.js)
// =========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app-check.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, doc, getDoc, setDoc, onSnapshot, updateDoc, serverTimestamp, disableNetwork, enableNetwork } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js";
import { CONFIG } from "./config.js";
import { getActiveChangelog, formatChangelogDate } from "./changelog.js";

import { getDatabase, ref as rtdbRef, onValue as onRtdbValue, update as rtdbUpdate } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";

export const app = initializeApp(CONFIG.FIREBASE_CONFIG);

let firestoreDb;
try {
    firestoreDb = initializeFirestore(app, {
        localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager()
        })
    });
} catch (err) {
    console.warn("⚠️ IndexedDB persistence selhala, aktivuji nouzovou paměťovou cache:", err);
    firestoreDb = initializeFirestore(app, {
        localCache: memoryLocalCache()
    });
}
export const db = firestoreDb;
export const auth = getAuth(app);
export const functions = getFunctions(app, "europe-west1");
export const rtdb = getDatabase(app);

// Zpětná kompatibilita pro vanilkové provázání modulů
window.app = app; window.db = db; window.auth = auth; window.functions = functions; window.rtdb = rtdb;

// 🔇 PRODUKČNÍ ŠTÍT KONZOLE: Na mobilech hráčů kompletně umlčí logy a ušetří baterii i RAM
const isDev = location.hostname === "localhost" || location.hostname === "127.0.0.1";
if (!isDev) {
    console.log = () => {};
    console.info = () => {};
    console.warn = () => {};
}

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
        fanGraphics: localStorage.getItem('tipni_fan_graphics') === 'true',
        selectedLeague: null,
        selectedAdminLeague: null,
        adminActiveTab: 'matches',
        superAdminActiveTab: 'users', // 👑 Aktivní podzáložka SuperAdmin kokpitu ('users' | 'tools' | 'odds')
        adminMatches: [],
        adminUsers: [],
        adminOpenedUserId: null,
        adminOpenedUserId: null, // 🔒 Držák otevřeného uživatele v Admin panelu (null = vše zavřeno)
        myOvr: parseInt(localStorage.getItem('tipni_cache_my_ovr') || '0', 10),
        profileTargetUid: null,
        profileReturnScreen: 'leaguesScreen',
        hallOfFameData: (() => {
            try { return JSON.parse(localStorage.getItem('tipni_cache_hof_' + (localStorage.getItem('savedSeason') || '2026_2027')) || 'null'); } catch(e){ return null; }
        })(),

        // 👥 STAV KOMUNITY Z REALTIME DATABASE (0 FIRESTORE READS, LIVE WEBSOCKET)
        communityOnline: 1,
        communityTotal: (() => {
            try {
                const h = JSON.parse(localStorage.getItem('tipni_cache_hof_' + (localStorage.getItem('savedSeason') || '2026_2027')) || 'null');
                return (h?.all || h?.players || []).length || 35;
            } catch(e) { return 35; }
        })(),
        onlineUidsSet: new Set(),
        communityLastSeen: {},

        // 📊 POČÍTADLO ZÁPASŮ BEZ KURZŮ PRO NOTIFIKAČNÍ ODZNAK V MENU
        get missingOddsCount() {
            return this.missingOddsList.length;
        },

        // 🔍 SEZNAM ZÁPASŮ NA NEJBLIŽŠÍCH 7 DNÍ BEZ VYPSANÝCH KURZŮ
        get missingOddsList() {
            const _tick = this.leagueFilterTick;
            const MASTER_LIGY = CONFIG.MASTER_LEAGUES;
            const sezId = this.activeSeason || window.SEZONA_ID || "2026_2027";
            const now = Date.now();
            const result = [];

            const melByZapasUzMitKurz = (casZapasu, isHockey) => {
                // Zápasy vzdálenější než 7 dní zcela ignorujeme
                if (casZapasu > now + (7 * 24 * 60 * 60 * 1000)) return false;

                const mDate = new Date(casZapasu);
                const mDay = mDate.getDay(); // 0=Ne, 1=Po, 2=Út, 3=St, 4=Čt, 5=Pá, 6=So
                const mHour = mDate.getHours();
                const syncDate = new Date(casZapasu);

                if (isHockey) {
                    // 🏒 HOKEJ (Tipsport Extraliga): 3 synchronizační mantinely
                    // 1. Blok: Sobota 12:00 -> pokrývá Ne a Po do 10:00 (a So od 12:00)
                    if ((mDay === 6 && mHour >= 12) || mDay === 0 || (mDay === 1 && mHour < 10)) {
                        const daysBack = (mDay === 6) ? 0 : (mDay === 0 ? 1 : 2);
                        syncDate.setDate(syncDate.getDate() - daysBack);
                        syncDate.setHours(12, 0, 0, 0);
                    }
                    // 2. Blok: Pondělí 10:00 -> pokrývá Út a St, a Čt do 09:00
                    else if ((mDay === 1 && mHour >= 10) || mDay === 2 || mDay === 3 || (mDay === 4 && mHour < 9)) {
                        const daysBack = (mDay === 1) ? 0 : (mDay === 2 ? 1 : (mDay === 3 ? 2 : 3));
                        syncDate.setDate(syncDate.getDate() - daysBack);
                        syncDate.setHours(10, 0, 0, 0);
                    }
                    // 3. Blok: Čtvrtek 09:00 -> pokrývá Čt od 09:00, Pá a So do 12:00
                    else {
                        const daysBack = (mDay === 4) ? 0 : (mDay === 5 ? 1 : 2);
                        syncDate.setDate(syncDate.getDate() - daysBack);
                        syncDate.setHours(9, 0, 0, 0);
                    }
                } else {
                    // ⚽ FOTBAL: 2 herní bloky podle plánovače Cloud Functions
                    // Víkendový blok: Pátek až Pondělí -> stahuje se v Úterý v 17:00
                    if (mDay === 5 || mDay === 6 || mDay === 0 || mDay === 1) {
                        const daysBack = (mDay === 5 ? 3 : (mDay === 6 ? 4 : (mDay === 0 ? 5 : 6)));
                        syncDate.setDate(syncDate.getDate() - daysBack);
                        syncDate.setHours(17, 0, 0, 0);
                    }
                    // Všední blok: Úterý až Čtvrtek -> dočišťuje se v Pondělí ve 04:00
                    else {
                        const daysBack = mDay - 1; // Út(2)->1, St(3)->2, Čt(4)->3
                        syncDate.setDate(syncDate.getDate() - daysBack);
                        syncDate.setHours(4, 0, 0, 0);
                    }
                }

                return now >= syncDate.getTime();
            };

            MASTER_LIGY.forEach(leagueName => {
                const isHockey = leagueName.includes("Extraliga") || leagueName.includes("hokej");
                const lKlic = String(leagueName).replace(/ /g, "_");
                let rozpisObj = this.leaguesMemoryCache?.[leagueName]?.rozpisData;
                
                if (!rozpisObj) {
                    try {
                        const raw = localStorage.getItem(`tipni_cache_rozpis_${sezId}_${lKlic}`);
                        if (raw) rozpisObj = JSON.parse(raw);
                    } catch (e) {}
                }

                if (rozpisObj && rozpisObj.zapasyMapa) {
                    Object.entries(rozpisObj.zapasyMapa).forEach(([mId, z]) => {
                        const casZapasu = Date.parse(z.datum) || 0;
                        const jeOdehrany = z.vysledek_domaci !== undefined || z.apiStatus === "IN_PLAY" || z.apiStatus === "PAUSED" || z.apiStatus === "FINISHED";
                        const jeOdlozen = z.apiStatus === "POSTPONED";
                        const maKurz = z.odds && (z.odds["1"] || z.odds[1]);

                        // 🎯 Zápas se zařadí do chybějících POUZE tehdy, pokud už podle plánovače bota proběhl jeho termín stažení
                        if (!jeOdehrany && !jeOdlozen && !maKurz && casZapasu > now && melByZapasUzMitKurz(casZapasu, isHockey)) {
                            result.push({
                                ...z,
                                id: mId,
                                league: leagueName,
                                datumMs: casZapasu
                            });
                        }
                    });
                }
            });

            return result.sort((a, b) => a.datumMs - b.datumMs);
        },
        adminMatchesLoaded: false,
        adminUsersLoaded: false,
        adminGlobalVitez: '',
        adminGlobalStrelec: '',
        showSurveys: true,
        notifyUntipped: false,
        activeSurveyData: null,
        surveyModalOpen: false,
        loutkovodicReturnScreen: 'adminScreen',
        loutkovodicTargetUid: '',
        loutkovodicTargetEmail: '',
        loutkovodicTargetNickname: '',
        loutkovodicSelectedLeague: '',
        loutkovodicBonusVitez: '',
        loutkovodicBonusStrelec: '',
        loutkovodicBonusKanadske: '',
        loutkovodicInitialBonusVitez: '',
        loutkovodicInitialBonusStrelec: '',
        loutkovodicInitialBonusKanadske: '',
        loutkovodicMatches: [],
        loutkovodicMatchesLoaded: false,
        loutkovodicBonusOpen: false,
        loutkovodicKolaIndex: 0,
        get unikatniKolaLoutkovodic() {
            if (!this.loutkovodicMatches || this.loutkovodicMatches.length === 0) return [];
            const listKol = this.loutkovodicMatches.map(m => window.prelozFaziTurnaje ? window.prelozFaziTurnaje(m.stage, m.kolo, m.isPlayoff) : (m.kolo || 'Šampionát'));
            return [...new Set(listKol)].filter(k => String(k).trim() !== '');
        },
        get dynamickyFeedLoutkovodic() {
            if (!this.loutkovodicMatches || this.loutkovodicMatches.length === 0) return [];
            const kola = this.unikatniKolaLoutkovodic;
            if (kola.length === 0) return this.loutkovodicMatches;
            const vybraneKolo = kola[this.loutkovodicKolaIndex] || kola[0];
            return this.loutkovodicMatches.filter(m => (window.prelozFaziTurnaje ? window.prelozFaziTurnaje(m.stage, m.kolo, m.isPlayoff) : (m.kolo || 'Šampionát')) === vybraneKolo);
        },
        isMenuOpen: false,
        isAdmin: false,
        isSuperAdmin: false,
        tutorialOpen: false,
        tutorialStep: 0,
        tutorialTotalSteps: 10,
        nickname: '',
        isLive: false,
        // 🔴 Okamžitá paměťová hydratace LIVE odznaků (0 ms bez probliknutí rozhraní)
        liveLeaguesMap: (() => {
            try { return JSON.parse(localStorage.getItem('tipni_cache_live_map') || '{}'); } catch(e) { return {}; }
        })(),
        isLeaguesReady: true, // ⚡ Okamžitý start: Zobrazí obsah ihned z disku telefonu
        _leagues: [],
        leagueFilterTick: 0,
        leaguesMemoryCache: {}, // ⚡ L1 RAM CACHE: Instantní paměť lig pro přepínání za 0 ms
        reorderModalOpen: false,
        reorderList: [],
        lastLeagueOrderChange: 0,

        leagueOrder: [],
        // 👥 Okamžitá paměťová hydratace počtu hráčů v soutěžích
        leaguePlayerCounts: (() => {
            try { return JSON.parse(localStorage.getItem('tipni_cache_player_counts') || '{}'); } catch(e) { return {}; }
        })(),
        getLeagueSubtext(liga) {
            const _tick = this.leagueFilterTick;
            let pocet = this.leaguePlayerCounts[liga];
            
            // ⚡ Instantní fallback z cache, aby číslo neprobliklo na 0
            if (pocet === undefined) {
                const sezId = this.activeSeason || window.SEZONA_ID || "2026_2027";
                const lKlic = String(liga || '').replace(/ /g, "_");
                try {
                    const cachedLb = localStorage.getItem(`tipni_cache_lb_${sezId}_${lKlic}`);
                    if (cachedLb) {
                        const parsed = JSON.parse(cachedLb);
                        if (parsed && parsed.zebricek) {
                            pocet = parsed.zebricek.length;
                            this.leaguePlayerCounts[liga] = pocet;
                        }
                    }
                } catch(e) {}
            }

            const finalCount = pocet ?? 0;
            if (finalCount === 1) return '1 hráč v tipovačce';
            if (finalCount >= 2 && finalCount <= 4) return `${finalCount} hráči v tipovačce`;
            return `${finalCount} hráčů v tipovačce`;
        },

        getSportIcon(liga) {
            const l = String(liga || this.selectedLeague || '').toLowerCase();
            return (l.includes('extraliga') || l.includes('hokej')) ? '🏒' : '⚽';
        },

        // 🙈 INTELIGENTNÍ AUTOMATICKÝ FILTR & SEŘAZOVAČ LIG PODLE VOLBY HRÁČE
        get leagues() {
            const _tick = this.leagueFilterTick;
            const MASTER_LIGY = CONFIG.MASTER_LEAGUES;
            let zakladniSeznam = this.isSuperAdmin ? MASTER_LIGY : [...(this._leagues || [])];

            if (!zakladniSeznam || !Array.isArray(zakladniSeznam) || zakladniSeznam.length === 0) return [];

            const sezId = this.activeSeason || window.SEZONA_ID || "2026_2027";
            const vyfiltrovane = zakladniSeznam.filter(liga => {
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

            // ↕️ APLIKACE UŽIVATELSKÉHO POŘADÍ (leagueOrder)
            const poradi = this.leagueOrder || [];
            if (poradi.length > 0) {
                vyfiltrovane.sort((a, b) => {
                    let idxA = poradi.indexOf(a);
                    let idxB = poradi.indexOf(b);
                    if (idxA === -1) idxA = 999;
                    if (idxB === -1) idxB = 999;
                    return idxA - idxB;
                });
            }

            return vyfiltrovane;
        },

        get isEnrolledInSelectedLeague() {
            return true;
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
        isIos: /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
        isStandalone: window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true,
        toggleGodMode() {
            if (this.isSuperAdmin) {
                this.godModeActive = !this.godModeActive;
            }
        },

        changelogList: [],
        hasUnreadChangelog: false,
        appVersion: localStorage.getItem('tipni_app_version') || '',

        obnovChangelogStav() {
            const aktivni = getActiveChangelog();
            this.changelogList = aktivni;
            if (aktivni.length === 0) {
                this.hasUnreadChangelog = false;
                return;
            }
            const nejnovejsiId = aktivni[0].id;
            const posledniPrecteneId = localStorage.getItem('tipni_last_changelog_id');
            this.hasUnreadChangelog = (nejnovejsiId !== posledniPrecteneId);
        },

        openChangelogModal() {
            if (this.changelogList.length > 0) {
                const nejnovejsiId = this.changelogList[0].id;
                localStorage.setItem('tipni_last_changelog_id', nejnovejsiId);
            }
            this.hasUnreadChangelog = false;

            const zpravy = this.changelogList;
            if (zpravy.length === 0) {
                window.openGlobalUiModal('CO JE NOVÉHO? 🚀', '<div style="text-align:center; padding:25px; color:#9ca3af; font-size:0.9rem;">Za posledních 30 dní neproběhly žádné nové aktualizace.</div>');
                return;
            }

            let html = '<div class="changelog-modal-wrapper">';
            zpravy.forEach(item => {
                let badgeClass = 'badge-feature';
                let badgeLabel = '🚀 NOVINKA';
                if (item.type === 'IMPROVEMENT') { badgeClass = 'badge-improvement'; badgeLabel = '⚡ VYLEPŠENÍ'; }
                else if (item.type === 'FIX') { badgeClass = 'badge-fix'; badgeLabel = '🛠️ OPRAVA'; }
                else if (item.type === 'SECURITY') { badgeClass = 'badge-security'; badgeLabel = '🔒 BEZPEČNOST'; }

                const datumFormatted = formatChangelogDate(item.datetime);

                html += `
                    <div class="changelog-card">
                        <div class="changelog-card-header">
                            <span class="changelog-badge ${badgeClass}">${badgeLabel}</span>
                            <span class="changelog-card-date">🕒 ${datumFormatted}</span>
                        </div>
                        <div class="changelog-card-title">${item.title}</div>
                        <div class="changelog-card-desc">${item.desc}</div>
                    </div>
                `;
            });
            html += '</div>';

            window.openGlobalUiModal('CO JE NOVÉHO? 🚀', html);
        },

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

        // 📊 REAKTIVNÍ DETEKTOR STARTU LIGY PRO ALPINE.JS
        get isLeagueStarted() {
            if (!this.serazenaTimelineZapasu || this.serazenaTimelineZapasu.length === 0) return false;
            const prvniZapas = this.serazenaTimelineZapasu[0];
            const casStartu = prvniZapas.datumObj ? prvniZapas.datumObj.getTime() : 0;
            if (casStartu > 0 && casStartu < Date.now()) return true;
            return this.serazenaTimelineZapasu.some(m => 
                m.isLive || m.apiStatus === 'IN_PLAY' || m.apiStatus === 'PAUSED' || m.apiStatus === 'FINISHED' || (m.vysledek_domaci !== undefined && m.vysledek_domaci !== null)
            );
        },

        // 🛡️ POMOCNÝ DETEKTOR: Prověří, zda je zápas odložený bez nového budoucího termínu
        jeZapasOdlozenyBezTerminu(z) {
            const now = Date.now();
            const zMs = z.datumObj ? z.datumObj.getTime() : 0;
            const jeOficialneOdlozen = z.apiStatus === 'POSTPONED' || z.status === 'POSTPONED';

            // 1. Zápas je v API označen jako odložený a nemá nové datum v budoucnosti
            if (jeOficialneOdlozen && (!zMs || zMs <= now)) return true;

            // 2. Záchranný štít: Zápas měl výkop před více než 3,5 hodinami, nemá výsledek a neběží live
            const nemaSkore = z.vysledek_domaci === undefined || z.vysledek_domaci === null;
            const nebeziLive = z.apiStatus !== 'IN_PLAY' && z.apiStatus !== 'PAUSED' && !z.isLive;
            const jeStaraMinulost = zMs > 0 && (now - zMs > 3.5 * 60 * 60 * 1000);

            if (nemaSkore && nebeziLive && jeStaraMinulost) return true;

            return false;
        },

        // 🔍 DETEKTOR 2 NEJBLIŽŠÍCH NADCHÁZEJÍCÍCH KOL PRO PROGRAM (Seřazeno podle logického pořadí kol)
        get nejblizsi2KolaProgramu() {
            const budouciZapasy = this.serazenaTimelineZapasu.filter(z => {
                const jeVyhodnoceny = (z.vysledek_domaci !== undefined && z.apiStatus !== 'IN_PLAY' && z.apiStatus !== 'PAUSED');
                const obaNeznamy = (z.domaci === 'Neznámý' && z.hoste === 'Neznámý');
                return !jeVyhodnoceny && !obaNeznamy && !this.jeZapasOdlozenyBezTerminu(z);
            });
            const unikatni = [];
            for (const z of budouciZapasy) {
                const k = window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff);
                if (k && !unikatni.includes(k)) {
                    unikatni.push(k);
                }
            }
            const maCisla = unikatni.some(k => /\d+/.test(k));
            if (maCisla) {
                unikatni.sort((a, b) => {
                    const numA = parseInt(String(a).replace(/[^0-9]/g, ''), 10) || 0;
                    const numB = parseInt(String(b).replace(/[^0-9]/g, ''), 10) || 0;
                    return numA - numB;
                });
            }
            return unikatni.slice(0, 2);
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
			return ['Poslední zápasy', ...unikatni.reverse()];
        },

        // Dynamická roletka pro Program utkání (Ignoruje odložené zápasy bez nového data)
        get unikatniKolaProgramu() {
            const budouci = this.serazenaTimelineZapasu.filter(z => {
                const jeVyhodnoceny = (z.vysledek_domaci !== undefined && z.apiStatus !== 'IN_PLAY' && z.apiStatus !== 'PAUSED');
                const obaNeznamy = (z.domaci === 'Neznámý' && z.hoste === 'Neznámý');
                return !jeVyhodnoceny && !obaNeznamy && !this.jeZapasOdlozenyBezTerminu(z);
            });
            const listKol = budouci.map(z => window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff));
            const unikatni = [...new Set(listKol)].filter(k => String(k).trim() !== '');
            const maCisla = unikatni.some(k => /\d+/.test(k));
            if (maCisla) {
                unikatni.sort((a, b) => {
                    const numA = parseInt(String(a).replace(/[^0-9]/g, ''), 10) || 0;
                    const numB = parseInt(String(b).replace(/[^0-9]/g, ''), 10) || 0;
                    return numA - numB;
                });
            }
            return ['Nadcházející zápasy', ...unikatni];
        },

        // Rozhodovací pipeline, která plní HTML šablonu čistými daty (Filtruje odložené zápasy bez data)
        get dynamickyFeedZapasu() {
            if (this.matchViewMode === 'results') {
				const vyhodnocene = this.serazenaTimelineZapasu.filter(z => 
					z.vysledek_domaci !== undefined && z.apiStatus !== 'IN_PLAY' && z.apiStatus !== 'PAUSED'
				);
				const vybranaVolba = this.unikatniKolaVysledku[this.vysledkyKolaIndex] || 'Poslední zápasy';

				if (this.vysledkyKolaIndex === 0 || vybranaVolba === 'Poslední zápasy') {
					const posl2 = this.posledni2KolaVysledku;
					return vyhodnocene.slice().reverse().filter(z => posl2.includes(window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff)));
				} else {
					return vyhodnocene.filter(z => window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff) === vybranaVolba);
				}
			} else {
                const budouciZapasy = this.serazenaTimelineZapasu.filter(z => {
                    const jeVyhodnoceny = (z.vysledek_domaci !== undefined && z.apiStatus !== 'IN_PLAY' && z.apiStatus !== 'PAUSED');
                    const obaNeznamy = (z.domaci === 'Neznámý' && z.hoste === 'Neznámý');
                    return !jeVyhodnoceny && !obaNeznamy && !this.jeZapasOdlozenyBezTerminu(z);
                });

                const vybranaVolba = this.unikatniKolaProgramu[this.programKolaIndex] || 'Nadcházející zápasy';

                if (this.programKolaIndex === 0 || vybranaVolba === 'Nadcházející zápasy') {
                    const nej2 = this.nejblizsi2KolaProgramu;
                    const nej2ZapasoveCasy = budouciZapasy
                        .filter(z => nej2.includes(window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff)))
                        .map(z => z.datumObj ? z.datumObj.getTime() : 0);
                    const maxDatumNej2 = nej2ZapasoveCasy.length > 0 ? Math.max(...nej2ZapasoveCasy) : Infinity;

                    return budouciZapasy.filter(z => {
                        const kolo = window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff);
                        if (nej2.includes(kolo)) return true;
                        const cas = z.datumObj ? z.datumObj.getTime() : 0;
                        return cas > 0 && cas <= maxDatumNej2;
                    });
                } else {
                    return budouciZapasy.filter(z => window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff) === vybranaVolba);
                }
            }
        },

        // 🧮 AUTOMATICKÝ SOUČET BODŮ (POUZE PRO SKUTEČNĚ UKONČENÉ A VYHODNOCENÉ ZÁPASY)
        get bodyAktualnihoFeedu() {
            const feed = this.serazenaTimelineZapasu;
            if (!feed || feed.length === 0) return 0;
            const league = this.selectedLeague;
            let total = 0;

            feed.forEach(match => {
                const isEvaluated = match.vysledek_domaci !== undefined && 
                                    match.vysledek_domaci !== null && 
                                    match.apiStatus !== 'IN_PLAY' && 
                                    match.apiStatus !== 'PAUSED' && 
                                    match.apiStatus !== 'POSTPONED';

                if (isEvaluated) {
                    const tip = this.mojeTipy[match.id];
                    const tDomaci = tip ? tip.tip_domaci : undefined;
                    const tHoste = tip ? tip.tip_hoste : undefined;
                    const tPostup = tip ? tip.postup : '';
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

    // 🚀 Aktivujeme kontrolu nepřečtených novinek
    Alpine.store('appState').obnovChangelogStav();

    // 🟢 NATIVNÍ ŽIVÝ RADAR PŘÍTOMNOSTI Z REALTIME DATABASE (0 KČ, 0 FIRESTORE READS)
    const statusRef = rtdbRef(rtdb, 'status');
    onRtdbValue(statusRef, (snap) => {
        const data = snap.val() || {};
        const allUids = Object.keys(data);
        const onlineUids = allUids.filter(uid => data[uid] && data[uid].online === true);
        const store = Alpine.store('appState');
        if (store) {
            store.communityOnline = onlineUids.length;
            store.onlineUidsSet = new Set(onlineUids);
            store.communityPresenceMap = data;
            // 🎨 Synchronizace stavu grafiky z RTDB pro přihlášeného uživatele
            const myUid = window.auth?.currentUser?.uid;
            if (myUid && data[myUid] && typeof data[myUid].richGraphics === 'boolean') {
                if (store.fanGraphics !== data[myUid].richGraphics) {
                    store.fanGraphics = data[myUid].richGraphics;
                    localStorage.setItem('tipni_fan_graphics', data[myUid].richGraphics ? 'true' : 'false');
                    store.leagueFilterTick++;
                }
            }
        }
    });

    const statsRef = rtdbRef(rtdb, 'stats/totalUsers');
    onRtdbValue(statsRef, (snap) => {
        const val = snap.val();
        const store = Alpine.store('appState');
        if (store && typeof val === 'number' && val > 0) {
            store.communityTotal = val;
        }
    });
};

if (window.Alpine) {
    vstrikniStoresDoPameti();
} else {
    document.addEventListener('alpine:init', vstrikniStoresDoPameti);
}

// 🏷️ PŘÍJEM CENTRÁLNÍ VERZE & AUTOMATICKÝ ENGINE AKTUALIZACÍ (ZERO DOWNTIME)
let isAppReloading = false;
window.pendingAppReload = false;

if ('serviceWorker' in navigator) {
    // 1. Řádná registrace Service Workera a uložení instance pro ping
    navigator.serviceWorker.register('/sw.js').then((reg) => {
        window.swRegistration = reg;
        reg.update().catch(() => {});

        if (reg.active) {
            reg.active.postMessage({ type: 'GET_VERSION' });
        }
    }).catch(err => console.error("❌ SW Registrace selhala:", err));

    navigator.serviceWorker.ready.then((reg) => {
        window.swRegistration = reg;
        if (reg.active) {
            reg.active.postMessage({ type: 'GET_VERSION' });
        }
    });

    // 2. Příjem verze pro zobrazení v pravém dolním rohu
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'APP_VERSION') {
            const ver = event.data.version;
            const store = window.Alpine?.store('appState');
            if (store) store.appVersion = ver;
            localStorage.setItem('tipni_app_version', ver);
        }
    // 🖼️ ŽIVÁ VÝMĚNA LOGA NA DISPLEJI (BEZ NUTNOSTI REFRESHOVAT STRÁNKU)
        if (event.data && event.data.type === 'AUTO_IMAGE_UPDATED') {
            const updatedUrl = event.data.url;
            document.querySelectorAll('img').forEach((img) => {
                if (img.src && img.src.split('?')[0] === updatedUrl.split('?')[0]) {
                    img.src = `${updatedUrl}?t=${Date.now()}`;
                }
            });
        }
    });

    // 3. 🚀 AUTOMATICKÝ SIGNÁL: Jakmile nový SW převezme vládu, provedeme tichý reload
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (isAppReloading) return;
        isAppReloading = true;

        // 🛡️ OCHRANNÝ ŠTÍT: Pokud má hráč zrovna rozepsaný formulář, reload počká
        if (window.isAppFormDirty) {
            window.pendingAppReload = true;
            console.log("⏳ DETEKOVÁNA NOVÁ VERZE: Formulář rozepsán, reload odložen po uložení.");
        } else {
            console.log("🚀 DETEKOVÁNA NOVÁ VERZE: Provádím automatický bleskový update...");
            window.location.reload();
        }
    });
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

// 🛡️ DYNAMICKÝ LAZY-LOADING PRO ADMIN MODUL (Pouze pro oprávněné)
let adminModulePromise = null;
window.nacistAdminModul = () => {
    if (!adminModulePromise) {
        adminModulePromise = import('./admin.js');
    }
    return adminModulePromise;
};

// --- ALPINE.JS INITIALIZATION ---
const initTipniToAlpine = () => {

    // ⚡ BLESKOVÉ CDN ÚLOŽIŠTĚ PRO ŽEBŘÍČKY A ROZPISY (CLOUDFLARE R2)
    const R2_BASE_URL = CONFIG.R2_BASE_URL;
    window.liveIntervalRadar = null;
    window.SEZONA_ID = localStorage.getItem('savedSeason') || "2026_2027";
    // ⚙️ PŘEPÍNAČ ZOBRAZOVÁNÍ ANKET V NASTAVENÍ
    window.toggleShowSurveys = async (checked) => {
        const store = Alpine.store('appState');
        const user = window.auth?.currentUser;
        if (store) store.showSurveys = checked;
        if (!user) return;
        try {
            await updateDoc(doc(db, 'users', user.uid), {
                showSurveys: checked
            });
            if (typeof window.showToast === 'function') {
                window.showToast(checked ? "🔔 Ankety povoleny." : "🔕 Ankety vypnuty.");
            }
            if (checked && typeof window.zkontrolujAktivniAnketu === 'function') {
                window.zkontrolujAktivniAnketu();
            }
        } catch (e) {
            console.error("Chyba nastavení anket:", e);
        }
    };

    // 🔔 PŘEPÍNAČ NOTIFIKACÍ PŘED VÝKOPEM (ČISTÝ R2 ZÁPIS PŘES CLOUD FUNCTION)
    window.toggleUntippedNotifications = async (checked) => {
        const store = Alpine.store('appState');
        const user = window.auth?.currentUser;
        if (!user || !store) return;

        const { httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js");
        const togglePushCF = httpsCallable(window.functions, 'togglePushSubscriptionCF');

        if (!checked) {
            store.notifyUntipped = false;
            localStorage.setItem('tipni_notify_untipped', 'false');
            try {
                await togglePushCF({ enabled: false });
                window.showToast("🔕 Upozornění před výkopem vypnuto.");
            } catch (e) {
                console.error("Chyba vypnutí notifikací:", e);
            }
            return;
        }

        if (!('Notification' in window)) {
            window.showToast("Tento prohlížeč nepodporuje notifikace ❌", true);
            store.notifyUntipped = false;
            return;
        }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            window.showToast("Oprávnění pro notifikace bylo zamítnuto 🔕", true);
            store.notifyUntipped = false;
            return;
        }

        window.showToast("⏳ Registruji zařízení pro push notifikace...", false);

        try {
            const reg = await navigator.serviceWorker.ready;
            const { getMessaging, getToken } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging.js");
            
            const messaging = getMessaging(window.app);
            const token = await getToken(messaging, {
                serviceWorkerRegistration: reg,
                vapidKey: CONFIG.VAPID_KEY
            });

            if (!token) throw new Error("Nepodařilo se vygenerovat registrační token.");

            await togglePushCF({ enabled: true, token: token });

            store.notifyUntipped = true;
            localStorage.setItem('tipni_notify_untipped', 'true');
            window.showToast("🔔 Upozornění před výkopem úspěšně aktivováno!");
        } catch (err) {
            console.error("Chyba aktivace push notifikací:", err);
            store.notifyUntipped = false;
            window.showToast("❌ Chyba aktivace: " + (err.message || "Registrace selhala"), true);
        }
    };

    // 🗑️ IN-APP VÝMAZ ÚČTU (POVINNÉ PRO GOOGLE PLAY)
    window.deleteMyAccount = async () => {
        const potvrdil = confirm("🚨 OPRAVDU CHCEŠ TRVALE SMAZAT SVŮJ ÚČET?\n\nTato akce je nevratná. Tvůj přihlašovací účet i e-mail budou okamžitě zničeny. Tvé odehrané body v probíhajících soutěžích zůstanou zafixované pod anonymním označením, aby se nerozbila tabulka ostatním hráčům.");
        if (!potvrdil) return;

        if (typeof window.showSplash === 'function') window.showSplash("Mažu účet...");

        try {
            const { httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js");
            const deleteMyAccountCF = httpsCallable(window.functions, 'deleteMyAccountCF');
            await deleteMyAccountCF();

            localStorage.clear();
            alert("Tvůj účet byl úspěšně smazán. Děkujeme za účast ve hře!");
            window.location.reload();
        } catch (err) {
            console.error("Chyba při mazání účtu:", err);
            if (typeof window.hideSplash === 'function') window.hideSplash();
            window.showToast("❌ Chyba při mazání účtu: " + (err.message || "Požadavek selhal"), true);
        }
    };

    // 📊 KONTROLOR A HLASOVACÍ ENGINE DYNAMICKÝCH ANKET
    window.zkontrolujAktivniAnketu = async () => {
        const store = Alpine.store('appState');
        const user = window.auth?.currentUser;
        if (!store || !user || store.showSurveys === false) return;

        try {
            const surveyRef = doc(db, "ankety", "aktivni");
            const surveySnap = await getDoc(surveyRef);
            if (!surveySnap.exists()) return;

            const sData = surveySnap.data();
            if (sData.isOpen === false || sData.stav === 'UZAVRENO') return;

            // 1. Kontrola časového limitu (Deadlinu)
            if (sData.konecDatum) {
                const kMs = sData.konecDatum.toDate ? sData.konecDatum.toDate().getTime() : (sData.konecDatum.seconds ? sData.konecDatum.seconds * 1000 : new Date(sData.konecDatum).getTime());
                if (kMs && Date.now() > kMs) return;
                
                const dObj = new Date(kMs);
                sData.konecText = `${dObj.getDate()}. ${dObj.getMonth() + 1}. ${String(dObj.getHours()).padStart(2, '0')}:${String(dObj.getMinutes()).padStart(2, '0')}`;
            }

            // 2. Kontrola cílových soutěží
            const cilove = sData.ciloveLigy || ['all'];
            if (!cilove.includes('all')) {
                const userLeagues = store._leagues || store.leagues || [];
                const maOpravnenouLigu = cilove.some(l => userLeagues.includes(l));
                if (!maOpravnenouLigu) return;
            }

            // 3. Kontrola, zda hráč již nehlasoval
            const voteRef = doc(db, "ankety", "aktivni", "hlasy", user.uid);
            const voteSnap = await getDoc(voteRef);
            if (voteSnap.exists()) return;

            store.activeSurveyData = sData;
            store.surveyModalOpen = true;
        } catch (e) {
            console.error("Chyba kontroly aktivní ankety:", e);
        }
    };

    window.submitDynamicSurveyVote = async (optionIndex, optionText) => {
        const store = Alpine.store('appState');
        const user = window.auth?.currentUser;
        if (!user || !store) return;

        const nick = store.nickname || document.getElementById('userMenuNickname')?.textContent || 'Hráč';
        store.surveyModalOpen = false;

        try {
            const voteRef = doc(db, "ankety", "aktivni", "hlasy", user.uid);
            await setDoc(voteRef, {
                uid: user.uid,
                nickname: nick,
                optionIndex: optionIndex,
                optionText: optionText || '',
                hlasovanoAt: serverTimestamp()
            });
            if (typeof window.showToast === 'function') {
                window.showToast(optionIndex === 'declined' ? "Volba uložena." : "Díky za tvůj hlas v anketě! 🗳️");
            }
        } catch (e) {
            console.error("Chyba zápisu hlasu:", e);
            if (typeof window.showToast === 'function') {
                window.showToast("❌ Hlasování již skončilo nebo nastala chyba.", true);
            }
        }
    };

    window.skipDynamicSurvey = () => {
        const store = Alpine.store('appState');
        if (store) store.surveyModalOpen = false;
    };

    window.goToScreen = async (screenName, pushHistory = true) => {
        if (window.pendingAppReload && !window.isAppFormDirty) {
            window.location.reload();
            return;
        }

        const store = Alpine.store('appState');
        store.showScrollTop = false;

        if (screenName === 'adminScreen' || screenName === 'superAdminScreen' || screenName === 'loutkovodicScreen') {
            await window.nacistAdminModul();
        }

            // 🔒 AUTO-RESET: Při odchodu ze žebříčku automaticky zavřeme roletku rekordů i všechny rozbalené karty hráčů
            if (screenName !== 'leaderboardScreen') {
                window.leaderboardRecordsOpen = false;
                window.rozbaleneUidsCacheGlobal = [];
            }

            // 🔒 AUTO-RESET ADMIN & SUPERADMIN: Zavření všech roletek hráčů
            store.adminOpenedUserId = null;
            document.querySelectorAll('#superAdminUsersRoletyWrapper .leaderboard-row-dropdown').forEach(el => {
                el.style.display = 'none';
            });
            document.querySelectorAll('#superAdminUsersRoletyWrapper .super-arrow-icon').forEach(el => {
                el.innerText = '▼';
            });

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
                if (pushHistory) {
                    const curSt = history.state;
                    const nSt = {
                        screen: screenName,
                        mode: store.matchViewMode || 'upcoming',
                        league: store.selectedLeague || null
                    };
                    if (!curSt || curSt.screen !== nSt.screen || curSt.mode !== nSt.mode || curSt.league !== nSt.league) {
                        history.pushState(nSt, '', '#' + screenName);
                    }
                }
            }
            
            if (screenName === 'leaguesScreen') {
                store.selectedLeague = null;
                store.selectedAdminLeague = null;
                store.isLive = false;
                localStorage.removeItem('savedLeague');
                if (typeof window.globalLiveMenuUnsubscribe === 'function') { window.globalLiveMenuUnsubscribe(); }
                if (window.globalLiveRozpisUnsubscribe) { window.globalLiveRozpisUnsubscribe(); window.globalLiveRozpisUnsubscribe = null; }
            }
            
            if (screenName === 'leaguesScreen') {
                document.documentElement.style.setProperty('--league-bg', 'none');
            }

            if (screenName === 'hallOfFameScreen') {
                store.selectedLeague = null;
                store.selectedAdminLeague = null;
                document.documentElement.style.setProperty('--league-bg', 'none');
                if (typeof window.renderHallOfFame === 'function') {
                    window.renderHallOfFame('ALL');
                }
                const hofScreen = document.getElementById('hallOfFameScreen');
                if (hofScreen) hofScreen.scrollTop = 0;
            }

            if (screenName === 'leaderboardScreen' && typeof window.renderLeaderboard === 'function') {
                window.leaderboardActiveSubTab = 'table';
                window.renderLeaderboard(true);
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

            if (screenName === 'cupScreen' && typeof window.renderCupScreen === 'function') {
                const lName = store.selectedLeague || localStorage.getItem('savedLeague') || 'Premier League';
                window.renderCupScreen(lName);
            }

            if (screenName === 'profileScreen' && typeof window.renderPlayerProfile === 'function') {
                window.renderPlayerProfile(store.profileTargetUid);
            }

            if (screenName === 'superAdminScreen' && typeof window.renderSuperAdmin === 'function') {
                window.renderSuperAdmin();
            }
            
            if (screenName === 'adminScreen') {
                store.selectedLeague = null;
                // 🎯 RESET DRŽÁKU POZICE PŘI VSTUPU DO ADMINU ODJINUD
                window.adminLeagueKoloInitialized = false;
                store.selectedAdminLeague = null;
                if (store.adminActiveTab === 'survey' && typeof window.renderAdminSurvey === 'function') {
                    window.renderAdminSurvey();
                } else if (typeof window.renderAdminMatches === 'function') {
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

       // 🎯 LOGICKÝ KARUSEL VÝSLEDKŮ: ◀ DOLEVA (MINULOST / STARŠÍ KOLA) | ▶ DOPRAVA (NOVĚJŠÍ KOLA / NEJNOVĚJŠÍ)
    window.posunKoloVysledky = (smer) => {
        const store = Alpine.store('appState');
        if (!store || !store.unikatniKolaVysledku || store.unikatniKolaVysledku.length === 0) return;

        // ◀ KLIK DOLEVA (Do minulosti / k nižším / starším kolům)
        if (smer < 0) {
            // Z "Poslední zápasy" (Index 0) skočíme na první starší kolo, které už není v posledních 2 kolech
            if (store.vysledkyKolaIndex === 0) {
                const posl2 = store.posledni2KolaVysledku || [];
                let targetIdx = 1;
                while (targetIdx < store.unikatniKolaVysledku.length) {
                    const koloNazev = store.unikatniKolaVysledku[targetIdx];
                    if (!posl2.includes(koloNazev)) {
                        break;
                    }
                    targetIdx++;
                }
                if (targetIdx < store.unikatniKolaVysledku.length) {
                    store.vysledkyKolaIndex = targetIdx;
                } else if (store.unikatniKolaVysledku.length > 1) {
                    store.vysledkyKolaIndex = 1;
                }
                return;
            }

            // Z konkrétního kola jdeme dál do minulosti (zvětšujeme index v poli unikatniKolaVysledku)
            let novyIndex = store.vysledkyKolaIndex + 1;
            if (novyIndex < store.unikatniKolaVysledku.length) {
                store.vysledkyKolaIndex = novyIndex;
            }
        } 
        // ▶ KLIK DOPRAVA (K novějším kolům / k nejnovějšímu stavu)
        else if (smer > 0) {
            // Snižujeme index (např. 1. kolo -> 2. kolo -> 3. kolo -> 4. kolo -> Poslední zápasy)
            let novyIndex = store.vysledkyKolaIndex - 1;
            if (novyIndex >= 0) {
                store.vysledkyKolaIndex = novyIndex;
            }
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

    // =========================================================================
    // ↕️ MANUÁLNÍ ŘAZENÍ SOUTĚŽÍ UŽIVATELE (S 24H COOLDOWN POJISTKOU)
    // =========================================================================
    window.openReorderLeaguesModal = () => {
        const store = Alpine.store('appState');
        if (!store || !store.leagues) return;
        store.reorderList = [...store.leagues];
        store.reorderModalOpen = true;
    };

    window.moveLeagueOrder = (index, direction) => {
        const store = Alpine.store('appState');
        if (!store || !store.reorderList) return;
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= store.reorderList.length) return;
        
        const list = [...store.reorderList];
        const [movedItem] = list.splice(index, 1);
        list.splice(newIndex, 0, movedItem);
        store.reorderList = list;
    };

    window.saveLeagueOrder = async () => {
        const store = Alpine.store('appState');
        const currentUser = window.auth?.currentUser;
        if (!store || !currentUser) return;

        // ⏱️ FRONTEND COOLDOWN KONTROLA (24 HODIN)
        const lastChange = store.lastLeagueOrderChange || 0;
        const now = Date.now();
        const cooldownMs = 24 * 60 * 60 * 1000;
        
        if (lastChange && (now - lastChange < cooldownMs) && !store.isSuperAdmin) {
            const zbyvaHodin = Math.ceil((cooldownMs - (now - lastChange)) / (60 * 60 * 1000));
            if (typeof window.showToast === 'function') {
                window.showToast(`Pořadí můžeš změnit až za ${zbyvaHodin} hod. ⏳`, true);
            }
            return;
        }

        try {
            const userRef = doc(db, 'users', currentUser.uid);
            await updateDoc(userRef, {
                leagueOrder: store.reorderList,
                lastLeagueOrderChange: serverTimestamp()
            });

            store.leagueOrder = [...store.reorderList];
            store.lastLeagueOrderChange = now;
            store.leagueFilterTick++; // 🔔 Bleskové překreslení katalogu a menu
            store.reorderModalOpen = false;

            if (typeof window.showToast === 'function') {
                window.showToast("✅ Pořadí tipovaček úspěšně uloženo!");
            }
        } catch (err) {
            console.error("Chyba při ukládání pořadí lig:", err);
            if (typeof window.showToast === 'function') {
                window.showToast("Změna byla zablokována (limit 24h) ❌", true);
            }
        }
    };

    window.globalLivePulsUnsubscribe = window.globalLivePulsUnsubscribe || null;
    window.lastKnownPulsSignatures = window.lastKnownPulsSignatures || {};

    window.zapniZiveStreamy = (leagueName) => {
        if (window.globalLivePulsUnsubscribe) {
            window.globalLivePulsUnsubscribe();
            window.globalLivePulsUnsubscribe = null;
        }
        if (window.liveIntervalRadar) {
            clearInterval(window.liveIntervalRadar);
            window.liveIntervalRadar = null;
        }

        const store = Alpine.store('appState');
        const ligaKlic = String(leagueName || '').replace(/ /g, "_");
        const sezonaId = store?.activeSeason || window.SEZONA_ID || "2026_2027";
        const pathPrefix = `sezony/${sezonaId}/${ligaKlic}`;

        const sosniDataZR2 = async () => {
            if (document.hidden) return;
            try {
                const keshRazitko = Date.now();
                const isChanceLiga = String(leagueName || '').toLowerCase().includes('chance');

                // ⚡ 1. KROK: Bleskové paralelní stažení HTTP odpovědí ze sítě
                const [resLb, resRozpis, resCup] = await Promise.all([
                    fetch(`${R2_BASE_URL}/${pathPrefix}/leaderboard.json?v=${keshRazitko}`),
                    fetch(`${R2_BASE_URL}/${pathPrefix}/rozpis.json?v=${keshRazitko}`),
                    isChanceLiga ? fetch(`${R2_BASE_URL}/${pathPrefix}/cup.json?v=${keshRazitko}`).catch(() => null) : Promise.resolve(null)
                ]);

                // ⚡ 2. KROK: Bleskové paralelní rozparsování všech JSONů současně
                const [lbData, rData, cData] = await Promise.all([
                    resLb && resLb.ok ? resLb.json().catch(() => null) : null,
                    resRozpis && resRozpis.ok ? resRozpis.json().catch(() => null) : null,
                    resCup && resCup.ok ? resCup.json().catch(() => null) : null
                ]);

                if (cData) {
                    if (!store.cupData) store.cupData = {};
                    store.cupData[leagueName] = cData;
                    window.tipniCupData = window.tipniCupData || {};
                    window.tipniCupData[leagueName] = cData;
                }

                let jeZivyZapas = false;

                if (rData) {
                    const staryRozpisJson = JSON.stringify(store._rozpisData?.zapasyMapa || {});
                    const novyRozpisJson = JSON.stringify(rData.zapasyMapa || {});

                    if (staryRozpisJson !== novyRozpisJson) {
                        store.rozpisData = rData;
                    }

                    jeZivyZapas = rData.isLive || Object.values(rData.zapasyMapa || {}).some(zap => zap.apiStatus === "IN_PLAY" || zap.apiStatus === "PAUSED");
                    store.isLive = jeZivyZapas;
                    if (!store.liveLeaguesMap) store.liveLeaguesMap = {};
                    store.liveLeaguesMap[leagueName] = Boolean(jeZivyZapas);
                    try { localStorage.setItem('tipni_cache_live_map', JSON.stringify(store.liveLeaguesMap)); } catch(e){}

                    if (!store.isLive && window.leaderboardActiveTab === 'live') {
                        window.leaderboardActiveTab = 'total';
                    }
                }

                if (lbData) {
                    const staryLbJson = JSON.stringify(store._leaderboardData || {});
                    const novyLbJson = JSON.stringify(lbData || {});

                    if (staryLbJson !== novyLbJson) {
                        store.leaderboardData = lbData;
                        if (!store.leaguesMemoryCache) store.leaguesMemoryCache = {};
                        if (!store.leaguesMemoryCache[leagueName]) store.leaguesMemoryCache[leagueName] = {};
                        store.leaguesMemoryCache[leagueName].leaderboardData = lbData;

                        window.globalniZebricek = lbData.zebricek || [];
                        window.globalniZebricekLive = lbData.zebricekLive || [];
                        window.mapaPrezdivek = lbData.mapaPrezdivek || {};

                        if (store.currentScreen === 'leaderboardScreen' && typeof window.renderLeaderboard === 'function') {
                            window.renderLeaderboard();
                        }
                        if (store.currentScreen === 'cupScreen' && typeof window.renderCupScreen === 'function') {
                            window.renderCupScreen(leagueName);
                        }
                        if (store.currentScreen === 'profileScreen' && typeof window.renderPlayerProfile === 'function') {
                            window.renderPlayerProfile(store.profileTargetUid);
                        }
                    }
                }

                // ⚡ Uložení rozparsovaných objektů do L1 RAM pro instantní přepínání (0 ms)
                if (!store.leaguesMemoryCache) store.leaguesMemoryCache = {};
                store.leaguesMemoryCache[leagueName] = {
                    rozpisData: rData || store.rozpisData,
                    leaderboardData: lbData || store.leaderboardData,
                    cupData: cData || store.cupData?.[leagueName]
                };

                // 🔄 ZÁLOŽNÍ RADAR: Běží pouze v případě aktivního live zápasu
                if (jeZivyZapas && !window.liveIntervalRadar) {
                    window.liveIntervalRadar = setInterval(() => sosniDataZR2(), 20000);
                } else if (!jeZivyZapas && window.liveIntervalRadar) {
                    clearInterval(window.liveIntervalRadar);
                    window.liveIntervalRadar = null;
                }

            } catch (err) {
                console.warn("🚧 Cloudflare R2 Radar: Soubory se na serveru připravují.");
            }
        };

        // 🔴 CHYTRÝ WEBSOCKET MAJÁK (FIRESTORE PULS S KONTROLOU VERZE)
        try {
            window.globalLivePulsUnsubscribe = onSnapshot(doc(db, 'ligy', leagueName, 'stav', 'puls'), (pulsSnap) => {
                if (pulsSnap.exists()) {
                    const data = pulsSnap.data() || {};
                    // Vytvoření podpisu verze z časového razítka nebo čísla verze
                    const podpis = data.verze || data.updatedAt?.seconds || JSON.stringify(data);
                    
                    if (window.lastKnownPulsSignatures[leagueName] !== podpis) {
                        window.lastKnownPulsSignatures[leagueName] = podpis;
                        sosniDataZR2();
                    }
                }
            }, (err) => console.warn("Puls listener warning:", err));
        } catch(e) {}

        window.globalLiveMenuUnsubscribe = () => {
            if (window.globalLivePulsUnsubscribe) {
                window.globalLivePulsUnsubscribe();
                window.globalLivePulsUnsubscribe = null;
            }
            if (window.liveIntervalRadar) {
                clearInterval(window.liveIntervalRadar);
                window.liveIntervalRadar = null;
            }
            window.globalLiveMenuUnsubscribe = null;
        };

        return sosniDataZR2();
    };

    window.naplanujZiveKanaly = async (lName) => {
        return window.zapniZiveStreamy(lName);
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

    // 🏎️ PROFI SENIOR LEAGUE SELECTOR (EAGER PARALLEL BOOTSTRAP / 0 ms LATENCY)
    window.selectLeague = async (leagueName, targetScreen = 'matchesScreen') => {
        const store = Alpine.store('appState');

        // 🛑 OCHRANA ROZPRACOVANÝCH TIPŮ PŘED PŘEPNUTÍM SOUTĚŽE
        if (window.isAppFormDirty) {
            if (store) store.isMenuOpen = false;
            if (typeof window.zobrazVarovnyModal === 'function') {
                window.zobrazVarovnyModal(() => {
                    window.isAppFormDirty = false;
                    window.selectLeague(leagueName, targetScreen);
                });
            } else {
                window.isAppFormDirty = false;
                window.selectLeague(leagueName, targetScreen);
            }
            return;
        }

            const povoleneLigy = store._leagues && store._leagues.length > 0 ? store._leagues : store.leagues;
            if (!store.isSuperAdmin && (!povoleneLigy || !povoleneLigy.includes(leagueName))) {
                if (typeof window.showToast === 'function') window.showToast("Do této tipovačky tě admin ještě neschválil! 🚧", true);
                if (typeof window.hideSplash === 'function') window.hideSplash();
                return;
            }

            // 🔒 AUTO-RESET: Při změně ligy vždy startujeme se zavřenou roletkou rekordů i karet hráčů
            window.leaderboardRecordsOpen = false;
            window.rozbaleneUidsCacheGlobal = [];

            // 🚀 1. ÚROVEŇ: BLESKOVÝ VÝBĚR PŘÍMO Z L1 RAM PAMĚTI (0.001 ms)
            let maNacitanouKesi = false;
            const memoryHit = store.leaguesMemoryCache?.[leagueName];

            if (memoryHit) {
                if (memoryHit.rozpisData) store.rozpisData = memoryHit.rozpisData;
                if (memoryHit.leaderboardData) store.leaderboardData = memoryHit.leaderboardData;
                if (memoryHit.cupData) {
                    if (!store.cupData) store.cupData = {};
                    store.cupData[leagueName] = memoryHit.cupData;
                    window.tipniCupData = window.tipniCupData || {};
                    window.tipniCupData[leagueName] = memoryHit.cupData;
                }
                maNacitanouKesi = true;
            } else {
                // 💽 2. ÚROVEŇ: ZÁLOŽNÍ RYCHLÁ KONTROLA Z DISKU (LOCALSTORAGE)
                const sezId = store.activeSeason || window.SEZONA_ID || "2026_2027";
                const lKlic = String(leagueName).replace(/ /g, "_");
                try {
                    const cachedRozpis = localStorage.getItem(`tipni_cache_rozpis_${sezId}_${lKlic}`);
                    if (cachedRozpis) {
                        store.rozpisData = JSON.parse(cachedRozpis);
                        maNacitanouKesi = true;
                    }
                    const cachedLb = localStorage.getItem(`tipni_cache_lb_${sezId}_${lKlic}`);
                    if (cachedLb) {
                        store.leaderboardData = JSON.parse(cachedLb);
                    }
                } catch (e) {}
            }

            if (!maNacitanouKesi && typeof window.showSplash === 'function') {
                window.showSplash("Načítání...");
            }

            store.selectedLeague = leagueName;
            store.selectedAdminLeague = null;
            store.currentScreen = targetScreen;
            if (targetScreen === 'matchesScreen') {
                store.matchViewMode = 'upcoming';
                store.programKolaIndex = 0;
            }

            if (typeof window.getLeagueStadium === 'function') {
                document.documentElement.style.setProperty('--league-bg', `url('${window.getLeagueStadium(leagueName)}')`);
            }

            // 🎯 BLESKOVÝ PROPOJOVAČ: Vytáhne z paměti tipy pro tuto vybranou ligu
            if (typeof window.aktualizujMojeTipyProLigu === 'function') {
                window.aktualizujMojeTipyProLigu(leagueName);
            }

            localStorage.setItem('savedLeague', leagueName);
            localStorage.setItem('savedScreen', targetScreen);
            
            if (window.globalLiveMenuUnsubscribe) { window.globalLiveMenuUnsubscribe(); window.globalLiveMenuUnsubscribe = null; }
            if (window.globalLiveRozpisUnsubscribe) { window.globalLiveRozpisUnsubscribe(); window.globalLiveRozpisUnsubscribe = null; }
            window.liveSchedulerTimeout = window.liveSchedulerTimeout || null;
            if (window.liveSchedulerTimeout) { clearTimeout(window.liveSchedulerTimeout); window.liveSchedulerTimeout = null; }

            window.lastVerzeRozpisu = -1;
            window.lastVerzeZebricku = -1;

            // 🚀 ČISTÁ REAKTIVITA: Zavřeme menu bez čekání, animace odjíždí plynule přes GPU
            store.isMenuOpen = false;

            if (targetScreen === 'matchesScreen' && typeof window.renderMatches === 'function') {
                window.renderMatches(leagueName);
            } else if (targetScreen === 'leaderboardScreen' && typeof window.renderLeaderboard === 'function') {
                window.renderLeaderboard();
            } else if (targetScreen === 'cupScreen' && typeof window.renderCupScreen === 'function') {
                window.renderCupScreen(leagueName);
            }

            const scr = document.getElementById(targetScreen);
            if (scr) scr.scrollTop = 0;

            if (typeof window.hideSplash === 'function') {
                window.hideSplash();
            }

            // 📡 ASYNCHRONNÍ RADAR: Živé kanály se napojí neblokovaně na pozadí
            window.naplanujZiveKanaly(leagueName);
        };

    // 🔮 TICHÝ NEBLOKUJÍCÍ PREFETCHER: Aktualizuje data na pozadí bez zdržení startu a bez probliknutí
    window.prefetchVsechnyLigy = async () => {
        const store = Alpine.store('appState');
        const seznamKeKontrole = CONFIG.MASTER_LEAGUES;
        if (!seznamKeKontrole || seznamKeKontrole.length === 0 || !navigator.onLine) return;
        
        const sezId = store?.activeSeason || window.SEZONA_ID || "2026_2027";
        const keshRazitko = Math.floor(Date.now() / 30000);

        const sliby = seznamKeKontrole.map(lName => {
            const lKlic = String(lName).replace(/ /g, "_");
            const pathPrefix = `sezony/${sezId}/${lKlic}`;
            
            const fetchRozpis = fetch(`${R2_BASE_URL}/${pathPrefix}/rozpis.json?v=${keshRazitko}`)
                .then(r => r.status === 404 ? { zapasyMapa: {}, hasMatches: false } : (r.ok ? r.json() : null))
                .then(rData => {
                    if (rData) {
                        try { localStorage.setItem(`tipni_cache_rozpis_${sezId}_${lKlic}`, JSON.stringify(rData)); } catch(e){}
                        const jeLive = rData.isLive || Object.values(rData.zapasyMapa || {}).some(zap => zap.apiStatus === "IN_PLAY" || zap.apiStatus === "PAUSED");
                        if (store) {
                            if (!store.liveLeaguesMap) store.liveLeaguesMap = {};
                            store.liveLeaguesMap[lName] = Boolean(jeLive);
                            try { localStorage.setItem('tipni_cache_live_map', JSON.stringify(store.liveLeaguesMap)); } catch(e){}
                        }
                    }
                }).catch(() => {});

            const fetchLeaderboard = fetch(`${R2_BASE_URL}/${pathPrefix}/leaderboard.json?v=${keshRazitko}`)
                .then(r => r.ok ? r.json() : null)
                .then(lbData => {
                    if (lbData) {
                        try { localStorage.setItem(`tipni_cache_lb_${sezId}_${lKlic}`, JSON.stringify(lbData)); } catch(e){}
                        if (store) {
                            store.leaguePlayerCounts[lName] = lbData.zebricek?.length || 0;
                            try { localStorage.setItem('tipni_cache_player_counts', JSON.stringify(store.leaguePlayerCounts)); } catch(e){}
                        }
                    }
                }).catch(() => {});

            return Promise.all([fetchRozpis, fetchLeaderboard]);
        });

        // 🏛️ PREFETCH OFICIÁLNÍHO SOUBORU SÍNĚ SLÁVY Z R2 (AKTUALIZUJE I CELKOVÝ POČET HRÁČŮ)
        const fetchHof = fetch(`${R2_BASE_URL}/sezony/${sezId}/hall_of_fame.json?v=${keshRazitko}`)
            .then(r => r.ok ? r.json() : null)
            .then(hofData => {
                if (hofData && store) {
                    store.hallOfFameData = hofData;
                    const totalPlayers = (hofData.all || hofData.players || []).length;
                    if (totalPlayers > 0) store.communityTotal = totalPlayers;
                    try { localStorage.setItem(`tipni_cache_hof_${sezId}`, JSON.stringify(hofData)); } catch(e){}
                    const currentUid = window.auth?.currentUser?.uid;
                    const meInHof = (hofData.all || hofData.players)?.find(p => p.uid === currentUid);
                    if (meInHof) {
                        store.myOvr = meInHof.masterOvr || meInHof.ovr;
                        localStorage.setItem('tipni_cache_my_ovr', String(store.myOvr));
                    }
                }
            }).catch(() => {});

        sliby.push(fetchHof);
        await Promise.all(sliby);
        if (store) {
            store.leagueFilterTick++;
        }
    };

    // 🚀 DETERMINISTICKÝ START PREFETCHERU: 100% bez časovačů (přesně po vykreslení snímku na GPU)
    const naplanujPrefetch = () => {
        if (typeof window.prefetchVsechnyLigy !== 'function') return;

        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(() => window.prefetchVsechnyLigy());
        } else {
            // Dvojitý rAF počká na dokončení kompozice prvního snímku prohlížeče
            requestAnimationFrame(() => {
                requestAnimationFrame(() => window.prefetchVsechnyLigy());
            });
        }
    };

    if (document.readyState === 'complete') {
        naplanujPrefetch();
    } else {
        window.addEventListener('load', naplanujPrefetch, { once: true });
    }

    // 🔗 DEEP-LINK HANDLER PRO PUSH NOTIFIKACE (Předání do bezpečné fronty pro Auth)
    const urlParams = new URLSearchParams(window.location.search);
    const deepLeagueParam = urlParams.get('league');

    if (deepLeagueParam) {
        const cleanLeague = decodeURIComponent(deepLeagueParam).replace(/_/g, " ");
        const targetScreen = window.location.hash ? window.location.hash.replace('#', '') : 'matchesScreen';

        // 1. Zápis do startovní paměti aplikace
        localStorage.setItem('savedLeague', cleanLeague);
        localStorage.setItem('savedScreen', targetScreen);

        // 2. Čisté odstranění parametru z URL lišty bez reloadu
        window.history.replaceState(null, '', window.location.pathname + '#' + targetScreen);

        // 3. Uložíme do fronty pro Auth router (odpálí se až po načtení profilu a práv hráče)
        window.pendingDeepLink = { league: cleanLeague, screen: targetScreen };
    }

    // 🪝 LIFECYCLE BOOTSTRAP: Globální autentizace
    onAuthStateChanged(window.auth, async (user) => {
        if (!user) return;
    });

// ⦡ UNIVERZÁLNÍ PASIVNÍ DETEKTOR SCROLLU (FUNGUJE NA VŠECH OBRAZOVKÁCH I V ADMINU)
    window.addEventListener('scroll', (e) => {
        const target = e.target;
        if (target && target.classList && target.classList.contains('screen-scroll')) {
            const store = window.Alpine?.store('appState');
            if (!store) return;
            const shouldShow = target.scrollTop > 100;
            if (store.showScrollTop !== shouldShow) {
                store.showScrollTop = shouldShow;
            }
        }
    }, { passive: true, capture: true });

// 📊 TOURNAMENT LIFECYCLE: Bezpečně spočítá, zda už padl první herní gól nebo uplynul čas výkopu
    window.isLeagueStarted = () => {
        const store = Alpine.store('appState');
        if (!store.serazenaTimelineZapasu || store.serazenaTimelineZapasu.length === 0) return false;

        // 1. Kontrola času: Je čas startu úplně prvního zápasu v minulosti?
        const prvniZapas = store.serazenaTimelineZapasu[0];
        const casStartu = prvniZapas.datumObj ? prvniZapas.datumObj.getTime() : 0;
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
// 🏆 PLAYOFF / HOKEJ OT INTERACTIVE TOGGLER: Okamžitý reaktivní flip volby vítěze (i před uložením)
    window.nastavPostup = (matchId, volba) => {
        const store = Alpine.store('appState');
        if (!store) return;
        
        if (!store.rozvrtaneTipy) store.rozvrtaneTipy = {};
        store.rozvrtaneTipy[`${matchId}_postup`] = volba;

        // Synchronizace se skrytým inputem v DOMu pro hromadný zápis
        const hiddenEl = document.getElementById(`playoff-user-val-${matchId}`);
        if (hiddenEl) hiddenEl.value = volba;

        const klicRegistru = `playoff-user-val-${matchId}`;
        const savedPostup = store.mojeTipy?.[matchId]?.postup || '';

        if (volba !== savedPostup) {
            window.dirtyInputsRegistry.add(klicRegistru);
        } else {
            window.dirtyInputsRegistry.delete(klicRegistru);
        }
        window.isAppFormDirty = (window.dirtyInputsRegistry.size > 0);
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
		store.mojeBonusy = {
			vitez: soutezData.bonusy?.vitez || '',
			strelec: soutezData.bonusy?.strelec || '',
			kanadske: soutezData.bonusy?.kanadske || ''
		};
		store.mojeStatistiky = soutezData.statistiky || {};

		// 🚦 BATCH AUTO-FILL: Příprava všech roletek naráz bez zbytečných cyklů Alpine reaktivity
		if (store.mojeTipy) {
			const bleskoveRozvrtane = { ...(store.rozvrtaneTipy || {}) };
			Object.keys(store.mojeTipy).forEach(matchId => {
				const tip = store.mojeTipy[matchId];
				if (tip && tip.tip_domaci !== undefined && tip.tip_hoste !== undefined) {
					bleskoveRozvrtane[`${matchId}_domaci`] = String(tip.tip_domaci);
					bleskoveRozvrtane[`${matchId}_hoste`] = String(tip.tip_hoste);
				}
			});
			store.rozvrtaneTipy = bleskoveRozvrtane;
		}
	};
};

// 📡 GLOBÁLNÍ LIVE RADAR Z R2 (0 FIRESTORE READS, 0 KČ)
window.zkontrolujLiveRadarGlobalne = async () => {
    if (document.hidden || !navigator.onLine) return;
    const store = window.Alpine?.store('appState');
    if (!store) return;
    const sezId = store.activeSeason || window.SEZONA_ID || "2026_2027";

    try {
        const res = await fetch(`${CONFIG.R2_BASE_URL}/sezony/${sezId}/live_radar.json?v=${Date.now()}`);
        if (res.ok) {
            const data = await res.json();
            if (data && typeof data === 'object') {
                const staryStr = JSON.stringify(store.liveLeaguesMap || {});
                const novyStr = JSON.stringify(data);
                if (staryStr !== novyStr) {
                    store.liveLeaguesMap = data;
                    try { localStorage.setItem('tipni_cache_live_map', novyStr); } catch(e){}
                }
            }
        }
    } catch (e) {}
};

// 🔋 NÍZKOENERGETICKÝ RADAROVÝ ČASOVAČ (BĚŽÍ POUZE PŘI ROZSVÍCENÉM DISPLEJI)
window.liveRadarIntervalGlobal = setInterval(window.zkontrolujLiveRadarGlobalne, 25000);

// 📱 INTELIGENTNÍ REŽIM SPÁNKU & PROBUZENÍ SÍTĚ (ZERO BATTERY DRAIN)
document.addEventListener("visibilitychange", async () => {
    const store = window.Alpine?.store('appState');

    // 💤 1. MOBIL JDE DO KAPSY (USPAT VŠECHNO)
    if (document.hidden) {
        if (window.liveRadarIntervalGlobal) {
            clearInterval(window.liveRadarIntervalGlobal);
            window.liveRadarIntervalGlobal = null;
        }
        if (window.liveIntervalRadar) {
            clearInterval(window.liveIntervalRadar);
            window.liveIntervalRadar = null;
        }
        if (typeof window.globalLiveMenuUnsubscribe === 'function') {
            window.globalLiveMenuUnsubscribe();
        }
        try { await disableNetwork(db); } catch (e) {}
    } 
    // ⚡ 2. MOBIL VYTAŽEN Z KAPSY (BLESKOVÉ PROBUZENÍ)
    else {
        try { await enableNetwork(db); } catch (e) {}

        if (!window.liveRadarIntervalGlobal) {
            window.liveRadarIntervalGlobal = setInterval(window.zkontrolujLiveRadarGlobalne, 25000);
        }

        if (window.pendingAppReload && !window.isAppFormDirty) {
            window.location.reload();
            return;
        }

        if (window.swRegistration) {
            window.swRegistration.update().catch(() => {});
        }

        window.zkontrolujLiveRadarGlobalne();
        if (store?.selectedLeague) {
            window.zapniZiveStreamy(store.selectedLeague);
        }
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

// 👑 SUPERADMIN NAVIGATOR: Přímý skok ze jména v menu do konkrétní záložky Vládního kokpitu
window.openSuperAdminTab = async (tabName = 'users') => {
    const store = Alpine.store('appState');
    if (store) {
        store.superAdminActiveTab = tabName;
        store.isMenuOpen = false;
    }
    window.superAdminActiveTab = tabName;
    await window.nacistAdminModul();
    window.goToScreen('superAdminScreen');
    if (typeof window.switchSuperAdminTab === 'function') {
        window.switchSuperAdminTab(tabName);
    } else if (typeof window.renderSuperAdmin === 'function') {
        window.renderSuperAdmin(tabName);
    }
};

// 🎓 STORY TUTORIAL ENGINE: REAKTIVNÍ OVLÁDÁNÍ 10KROKOVÉHO PRŮVODCE
window.openTutorial = () => {
    const store = Alpine.store('appState');
    if (!store) return;
    store.tutorialStep = 0;
    store.tutorialOpen = true;
};

window.closeTutorial = () => {
    const store = Alpine.store('appState');
    if (!store) return;
    store.tutorialOpen = false;
    if (typeof window.completeTutorial === 'function') {
        window.completeTutorial();
    }
};

window.nextTutorialStep = () => {
    const store = Alpine.store('appState');
    if (!store) return;
    if (store.tutorialStep < store.tutorialTotalSteps - 1) {
        store.tutorialStep++;
    } else {
        window.closeTutorial();
    }
};

window.prevTutorialStep = () => {
    const store = Alpine.store('appState');
    if (!store) return;
    if (store.tutorialStep > 0) {
        store.tutorialStep--;
    }
};

window.setTutorialStep = (idx) => {
    const store = Alpine.store('appState');
    if (!store) return;
    if (idx >= 0 && idx < store.tutorialTotalSteps) {
        store.tutorialStep = idx;
    }
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

// 🏷️ POMOCNÉ VYTAHOVAČE LOG, ŠTÍTKŮ A POPISŮ PRO KATALOG
window.getLeagueBadge = (liga) => {
    const l = String(liga || '').toLowerCase();
    if (l.includes('premier')) return 'EN • ANGLIE';
    if (l.includes('chance')) return 'CZ • ČESKO';
    if (l.includes('mistr') || l.includes('ucl') || l.includes('champions')) return 'UEFA • EVROPA';
    if (l.includes('extraliga')) return 'CZ • EXTRALIGA';
    if (l.includes('hokeji')) return 'MS • HOKEJ';
    return 'FIFA • SVĚT';
};

// 🎨 TAJNÝ 3VTEŘINOVÝ SPÍNAČ FANOUŠKOVSKÉ GRAFIKY
let dotHoldTimer = null;
window.startDotHoldTimer = () => {
    window.clearDotHoldTimer();
    const dot = document.getElementById('presencePulseDot');
    if (dot) dot.classList.add('is-holding');

    dotHoldTimer = setTimeout(() => {
        window.clearDotHoldTimer();
        window.toggleFanGraphics();
    }, 3000);
};

window.clearDotHoldTimer = () => {
    if (dotHoldTimer) {
        clearTimeout(dotHoldTimer);
        dotHoldTimer = null;
    }
    const dot = document.getElementById('presencePulseDot');
    if (dot) dot.classList.remove('is-holding');
};

window.toggleFanGraphics = () => {
    const store = Alpine.store('appState');
    if (!store) return;
    const novyStav = !store.fanGraphics;
    store.fanGraphics = novyStav;
    localStorage.setItem('tipni_fan_graphics', novyStav ? 'true' : 'false');

    // 📡 Okamžitý zápis do RTDB pro aktuálního uživatele
    const user = window.auth?.currentUser;
    if (user && window.rtdb) {
        rtdbUpdate(rtdbRef(window.rtdb, `status/${user.uid}`), {
            richGraphics: novyStav
        }).catch(() => {});
    }

    // 📳 Haptická odezva
    if (navigator.vibrate) {
        navigator.vibrate([100, 50, 100, 50, 150]);
    }

    if (typeof window.showToast === 'function') {
        window.showToast(novyStav ? "🎨 Fanouškovský režim aktivován!" : "🛡️ Bezpečný režim aktivován");
    }

    // 🔄 Okamžité překreslení rozhraní
    store.leagueFilterTick++;
    if (store.selectedLeague && typeof window.getLeagueStadium === 'function') {
        const bgVal = window.getLeagueStadium(store.selectedLeague);
        document.documentElement.style.setProperty('--league-bg', bgVal ? `url('${bgVal}')` : 'none');
    }
    if (store.currentScreen === 'leaderboardScreen' && typeof window.renderLeaderboard === 'function') {
        window.renderLeaderboard(false);
    }
    if (store.currentScreen === 'profileScreen' && typeof window.renderPlayerProfile === 'function') {
        window.renderPlayerProfile(store.profileTargetUid);
    }
};

window.getLeagueTrophy = (liga) => {
    const isFan = Boolean(Alpine.store('appState')?.fanGraphics);
    if (!isFan) return '';

    const l = String(liga || '').toLowerCase();
    const r2Base = CONFIG.R2_BASE_URL;
    if (l.includes('premier')) return `${r2Base}/leagues/trophies/premier_league.png`;
    if (l.includes('chance')) return `${r2Base}/leagues/trophies/chance_liga.png`;
    if (l.includes('mistr') || l.includes('ucl')) return `${r2Base}/leagues/trophies/liga_mistru.png`;
    if (l.includes('extraliga')) return `${r2Base}/leagues/trophies/extraliga.png`;
    if (l.includes('hokeji')) return `${r2Base}/leagues/trophies/ms_hokej.png`;
    return `${r2Base}/leagues/trophies/ms_fotbal.png`;
};

window.getLeagueStadium = (liga) => {
    const isFan = Boolean(Alpine.store('appState')?.fanGraphics);
    if (!isFan) return '';

    const l = String(liga || '').toLowerCase();
    const r2Base = CONFIG.R2_BASE_URL;
    if (l.includes('premier')) return `${r2Base}/leagues/stadiums/premier_league.webp`;
    if (l.includes('chance')) return `${r2Base}/leagues/stadiums/chance_liga.webp`;
    if (l.includes('mistr') || l.includes('ucl')) return `${r2Base}/leagues/stadiums/liga_mistru.webp`;
    if (l.includes('extraliga')) return `${r2Base}/leagues/stadiums/extraliga.webp`;
    if (l.includes('hokeji')) return `${r2Base}/leagues/stadiums/ms_hokej.webp`;
    return `${r2Base}/leagues/stadiums/ms_fotbal.webp`;
};

// 🛡️ KRUHOVÉ SVG VLAJKY (BEZPEČNÝ MÓD) vs. OFICIÁLNÍ LOGA Z R2 (FANOUŠKOVSKÝ MÓD)
const SAFE_SVG_FLAGS = {
    // 🇨🇿 Česká vlajka (Chance Liga i Tipsport Extraliga)
    cz: `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><clipPath id="c"><circle cx="16" cy="16" r="16"/></clipPath></defs><g clip-path="url(#c)"><rect width="32" height="16" fill="#ffffff"/><rect y="16" width="32" height="16" fill="#d7141a"/><polygon points="0,0 16,16 0,32" fill="#11457e"/></g></svg>')}`,
    // 🇬🇧 Premier League (Union Jack v kruhu)
    gb: `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><clipPath id="c"><circle cx="16" cy="16" r="16"/></clipPath></defs><g clip-path="url(#c)"><rect width="32" height="32" fill="#012169"/><path d="M0,0 L32,32 M32,0 L0,32" stroke="#ffffff" stroke-width="5.5"/><path d="M0,0 L32,32 M32,0 L0,32" stroke="#c8102e" stroke-width="2.5"/><path d="M16,0 V32 M0,16 H32" stroke="#ffffff" stroke-width="8.5"/><path d="M16,0 V32 M0,16 H32" stroke="#c8102e" stroke-width="5"/></g></svg>')}`,
    // 🌍 Stylový kruhový glóbus (Liga mistrů, MS ve fotbale, MS v hokeji)
    globe: `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><clipPath id="c"><circle cx="16" cy="16" r="16"/></clipPath></defs><g clip-path="url(#c)"><rect width="32" height="32" fill="#0284c7"/><path d="M4,10 Q10,6 16,9 Q20,12 18,18 Q14,24 8,22 Z" fill="#10b981"/><path d="M19,6 Q25,4 28,10 Q26,16 23,17 Q20,14 19,6 Z" fill="#10b981"/><path d="M16,21 Q24,20 25,27 Q18,31 14,28 Z" fill="#10b981"/><circle cx="16" cy="16" r="15.5" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1"/></g></svg>')}`
};

window.getLeagueLogo = (liga) => {
    const isFan = Boolean(Alpine.store('appState')?.fanGraphics);
    const l = String(liga || '').toLowerCase();
    const r2Base = CONFIG.R2_BASE_URL;

    if (isFan) {
        if (l.includes('premier')) return `${r2Base}/leagues/logos/premier_league.png`;
        if (l.includes('chance')) return `${r2Base}/leagues/logos/chance_liga.png`;
        if (l.includes('mistr') || l.includes('ucl')) return `${r2Base}/leagues/logos/liga_mistru.png`;
        if (l.includes('extraliga')) return `${r2Base}/leagues/logos/extraliga.png`;
        if (l.includes('hokeji')) return `${r2Base}/leagues/logos/ms_hokej.png`;
        return `${r2Base}/leagues/logos/ms_fotbal.png`;
    }

    if (l.includes('premier')) return SAFE_SVG_FLAGS.gb;
    if (l.includes('chance')) return SAFE_SVG_FLAGS.cz;
    if (l.includes('extraliga')) return SAFE_SVG_FLAGS.cz;
    return SAFE_SVG_FLAGS.globe;
};