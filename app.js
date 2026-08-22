// =========================================================================
// 🚀 TIPNI TO! - HLAVNÍ CORE SOUBOR V11 MODULAR (app.js)
// =========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app-check.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, onSnapshot, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { CONFIG } from "./config.js";
import { getActiveChangelog, formatChangelogDate } from "./changelog.js";

// Inicializace v11 instancí jako čisté ES6 pojmenované exporty
export const app = initializeApp(CONFIG.FIREBASE_CONFIG);
export const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
export const auth = getAuth(app);

// Zpětná kompatibilita pro vanilkové provázání modulů
window.app = app; window.db = db; window.auth = auth;

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
        selectedLeague: localStorage.getItem('savedLeague') || null,
        selectedAdminLeague: null,
        adminActiveTab: 'matches',
        adminMatches: [],
        adminUsers: [],
        adminMatchesLoaded: false,
        adminUsersLoaded: false,
        adminGlobalVitez: '',
        adminGlobalStrelec: '',
        cupPremierVisitedTabs: [], // Sleduje 'groups', 'bracket', 'rules'
        premierCupSurveyOpen: false,
        hasVotedPremierCup: false,
        surveyUserStatus: null,
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
        liveLeaguesMap: {}, // 🔴 Živá reaktivní mapa LIVE stavu jednotlivých lig
        isLeaguesReady: false, // 🛡️ REAKTIVNÍ BRÁNA: Drží oponu dole, dokud R2 neprověří existenci zápasů
        _leagues: [],
        leagueFilterTick: 0,
        leaguesMemoryCache: {}, // ⚡ L1 RAM CACHE: Instantní paměť lig pro přepínání za 0 ms
        reorderModalOpen: false, // ↕️ Otevřený modál řazení lig
        reorderList: [], // ↕️ Pracovní pole pro manuální posouvání šipkami
        lastLeagueOrderChange: 0, // ⏱️ Razítko posledního uložení pro 24h cooldown

        leagueOrder: [],
        leaguePlayerCounts: {}, // 👥 Živá reaktivní mapa počtů hráčů
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

        // 🙈 INTELIGENTNÍ AUTOMATICKÝ FILTR & SEŘAZOVAČ LIG PODLE VOLBY HRÁČE
        get leagues() {
            const _tick = this.leagueFilterTick;
            const MASTER_LIGY = ["Chance Liga", "Premier League", "MS ve fotbale", "Tipsport Extraliga", "MS v hokeji"];
            const zakladniSeznam = this.isSuperAdmin ? MASTER_LIGY : (this._leagues || []);

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
			return ['Poslední zápasy', ...unikatni.reverse()];
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
					// Pro "Poslední zápasy" otočíme chronologii, aby byly nejnovější výsledky nahoře
					return vyhodnocene.slice().reverse().filter(z => posl2.includes(window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff)));
				} else {
					// Pro konkrétní kolo z roletky vrátíme zápasy v pořadí, jak se v daném kole hrály (od prvního po poslední)
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

    // 🚀 Aktivujeme kontrolu nepřečtených novinek
    Alpine.store('appState').obnovChangelogStav();
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
    const R2_BASE_URL = CONFIG.R2_BASE_URL;
    window.liveIntervalRadar = null;
    window.SEZONA_ID = localStorage.getItem('savedSeason') || "2026_2027";
    // 🎯 TRACKING ZÁLOŽEK PREMIER CUPU
    window.trackPremierCupTab = (tabName) => {
        const store = Alpine.store('appState');
        if (!store || store.selectedLeague !== 'Premier League') return;
        if (!store.cupPremierVisitedTabs) store.cupPremierVisitedTabs = [];

        if (store.hasVotedPremierCup || store.surveyUserStatus === 'VOTED' || store.surveyUserStatus === 'SKIPPED') return;
        if (!store.cupPremierVisitedTabs) store.cupPremierVisitedTabs = [];

        if (!store.cupPremierVisitedTabs.includes(tabName)) {
            store.cupPremierVisitedTabs.push(tabName);
        }
    };

    // 🛑 EXIT GUARD INTERCEPTOR PRO PREMIER CUP (IMUTABILNÍ OCHRANA FIRESTORE)
    let pendingCupExitCallback = null;
    window.interceptCupExit = (proceedCallback) => {
        const store = Alpine.store('appState');
        const myUid = window.auth?.currentUser?.uid;
        const isSuperAdmin = Boolean(store?.isSuperAdmin);

        const isLeavingPremierCup = store?.currentScreen === 'cupScreen' && store?.selectedLeague === 'Premier League';

        // 🔒 OCHRANNÝ ŠTÍT: Pokud má hráč v DB hotovo (VOTED / SKIPPED), ihned pouštíme a DB se ani nedotkneme
        if (store?.hasVotedPremierCup || store?.surveyUserStatus === 'VOTED' || store?.surveyUserStatus === 'SKIPPED') {
            proceedCallback();
            return;
        }

        const visited = store?.cupPremierVisitedTabs || [];
        const hasSeenAll3Tabs = visited.includes('groups') && visited.includes('bracket') && visited.includes('rules');

        if (isLeavingPremierCup && !isSuperAdmin && myUid) {
            if (hasSeenAll3Tabs) {
                pendingCupExitCallback = proceedCallback;
                store.premierCupSurveyOpen = true;
                return;
            } else {
                // 🛡️ ZÁKAZ PŘEPISOVÁNÍ: Zapisujeme INCOMPLETE pouze pokud hráč ještě nemá finální hlas
                if (store.surveyUserStatus !== 'VOTED' && store.surveyUserStatus !== 'SKIPPED') {
                    const db = window.db;
                    if (db) {
                        import("https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js").then(({ doc, setDoc }) => {
                            const ref = doc(db, "ankety", "premier_cup", "hraci", myUid);
                            const nick = document.getElementById('userMenuNickname')?.textContent || 'Hráč';
                            setDoc(ref, {
                                uid: myUid,
                                nickname: nick,
                                status: "VISITED_INCOMPLETE",
                                visitedTabs: store.cupPremierVisitedTabs || [],
                                lastSeenAt: new Date().toISOString()
                            }, { merge: true }).catch(() => {});
                        });
                    }
                }
            }
        }

        proceedCallback();
    };

    // 🗳️ ZÁPIS HLASU DO FIRESTORE
    window.submitPremierCupVote = async (choiceNum) => {
        const store = Alpine.store('appState');
        const myUid = window.auth?.currentUser?.uid;
        const nick = document.getElementById('userMenuNickname')?.textContent || 'Hráč';
        const db = window.db;

        if (store) {
            store.premierCupSurveyOpen = false;
            store.hasVotedPremierCup = true;
            store.surveyUserStatus = 'VOTED';
        }

        if (db && myUid) {
            try {
                const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js");
                const ref = doc(db, "ankety", "premier_cup", "hraci", myUid);
                await setDoc(ref, {
                    uid: myUid,
                    nickname: nick,
                    status: "VOTED",
                    volba: choiceNum,
                    visitedTabs: store?.cupPremierVisitedTabs || [],
                    votedAt: new Date().toISOString()
                }, { merge: true });
                if (typeof window.showToast === 'function') {
                    window.showToast("Díky za tvůj hlas k Premier Cupu! 🗳️");
                }
            } catch (e) {
                console.error("Chyba zápisu ankety:", e);
            }
        }

        if (typeof pendingCupExitCallback === 'function') {
            const cb = pendingCupExitCallback;
            pendingCupExitCallback = null;
            cb();
        }
    };

    // ⏩ PŘESKOČENÍ ANKETY
    window.skipPremierCupSurvey = async () => {
        const store = Alpine.store('appState');
        const myUid = window.auth?.currentUser?.uid;
        const nick = document.getElementById('userMenuNickname')?.textContent || 'Hráč';
        const db = window.db;

        if (store) {
            store.premierCupSurveyOpen = false;
            store.surveyUserStatus = 'SKIPPED';
        }

        if (db && myUid) {
            try {
                const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js");
                const ref = doc(db, "ankety", "premier_cup", "hraci", myUid);
                await setDoc(ref, {
                    uid: myUid,
                    nickname: nick,
                    status: "SKIPPED",
                    visitedTabs: store?.cupPremierVisitedTabs || [],
                    skippedAt: new Date().toISOString()
                }, { merge: true });
            } catch (e) {}
        }

        if (typeof pendingCupExitCallback === 'function') {
            const cb = pendingCupExitCallback;
            pendingCupExitCallback = null;
            cb();
        }
    };

    window.goToScreen = (screenName) => {
        window.interceptCupExit(() => {
            const store = Alpine.store('appState');
            
            store.showScrollTop = false; // ⦡ RESET ŠIPKY: Nová scrollovací scéna začíná vždy od absolutní nuly

            // 🔒 AUTO-RESET: Při odchodu ze žebříčku automaticky zavřeme roletku rekordů
            if (screenName !== 'leaderboardScreen') {
                window.leaderboardRecordsOpen = false;
            }

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
        });
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
                    // ⚡ CHIRURGICKÝ UPDATE: Porovnáme změnu v datech, Alpine sám přepíše jen změněné pixely
                    const staryRozpisJson = JSON.stringify(store._rozpisData?.zapasyMapa || {});
                    const novyRozpisJson = JSON.stringify(rData.zapasyMapa || {});

                    if (staryRozpisJson !== novyRozpisJson) {
                        store.rozpisData = rData;
                    }

                    jeZivyZapas = rData.isLive || Object.values(rData.zapasyMapa || {}).some(zap => zap.apiStatus === "IN_PLAY" || zap.apiStatus === "PAUSED");
                    store.isLive = jeZivyZapas;
                    if (!store.liveLeaguesMap) store.liveLeaguesMap = {};
                    store.liveLeaguesMap[leagueName] = Boolean(jeZivyZapas);
                    // 🔄 AUTOMATICKÝ PŘECHOD PO SKONČENÍ UTKÁNÍ:
                    if (!store.isLive && window.leaderboardActiveTab === 'live') {
                        window.leaderboardActiveTab = 'total';
                    }
                }

                if (lbData) {
                    const staryLbJson = JSON.stringify(store._leaderboardData || {});
                    const novyLbJson = JSON.stringify(lbData || {});

                    if (staryLbJson !== novyLbJson) {
                        store.leaderboardData = lbData;
                        window.globalniZebricek = lbData.zebricek || [];
                        window.globalniZebricekLive = lbData.zebricekLive || [];
                        window.mapaPrezdivek = lbData.mapaPrezdivek || {};

                        if (store.currentScreen === 'leaderboardScreen' && typeof window.renderLeaderboard === 'function') {
                            window.renderLeaderboard();
                        }
                        if (store.currentScreen === 'cupScreen' && typeof window.renderCupScreen === 'function') {
                            window.renderCupScreen(leagueName);
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

            } catch (err) {
                console.warn("🚧 Cloudflare R2 Radar: Soubory se na serveru připravují.");
            }
        };

        // 🔴 REAL-TIME WEBSOCKET MAJÁK (FIRESTORE PULS): Bot zapíše gól -> mobil do 50 ms stahuje R2!
        try {
            window.globalLivePulsUnsubscribe = onSnapshot(doc(db, 'ligy', leagueName, 'stav', 'puls'), (pulsSnap) => {
                if (pulsSnap.exists()) {
                    console.log(`📡 REAL-TIME PULS DETEKOVÁN [${leagueName}]! Okamžitě stahuji čerstvá data z R2...`);
                    sosniDataZR2();
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
            console.log("💤 Turbo radar i Puls pro ligu bezpečně odpojeny.");
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
        window.interceptCupExit(async () => {
            const store = Alpine.store('appState');

            const povoleneLigy = store._leagues && store._leagues.length > 0 ? store._leagues : store.leagues;
            if (!store.isSuperAdmin && (!povoleneLigy || !povoleneLigy.includes(leagueName))) {
                if (typeof window.showToast === 'function') window.showToast("Do této tipovačky tě admin ještě neschválil! 🚧", true);
                if (typeof window.hideSplash === 'function') window.hideSplash();
                return;
            }

            // 🔒 AUTO-RESET: Při změně ligy vždy startujeme se zavřenou roletkou rekordů
            window.leaderboardRecordsOpen = false;

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
            store.isMenuOpen = false;

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

            // 📡 PARALELNÍ PRELOAD Z R2 (OKAMŽITÉ NAČTENÍ ROZPISU I ŽEBŘÍČKU)
            const livePromise = window.naplanujZiveKanaly(leagueName);
            if (!maNacitanouKesi) {
                await livePromise;
            }

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
        });
    };

    // 🔮 ASYNC PREFETCHER: Počká na kompletní prověření všech lig a zobrazí je až po stažení
    window.prefetchVsechnyLigy = async () => {
        const store = Alpine.store('appState');
        if (store) store.isLeaguesReady = false;

        const MASTER_LIGY = ["Chance Liga", "Premier League", "MS ve fotbale", "Tipsport Extraliga", "MS v hokeji"];
        const seznamKeKontrole = MASTER_LIGY;
        if (!seznamKeKontrole || seznamKeKontrole.length === 0) return;
        
        const sezId = store?.activeSeason || window.SEZONA_ID || "2026_2027";
        const keshRazitko = Math.floor(Date.now() / 30000);

        // 🌐 OFFLINE JISTIČ: Pokud je mobil zcela bez signálu, nečekáme na chyby sítě a odemykáme lokální cache
        if (!navigator.onLine) {
            if (store) {
                store.isLeaguesReady = true;
                store.leagueFilterTick++;
            }
            return;
        }

        const sliby = seznamKeKontrole.map(lName => {
            const lKlic = String(lName).replace(/ /g, "_");
            const pathPrefix = `sezony/${sezId}/${lKlic}`;
            
            // ⚡ PARALELNÍ PREFETCH ROZPISU I ŽEBŘÍČKU (PRO OKAMŽITÝ POČET HRÁČŮ)
            const fetchRozpis = fetch(`${R2_BASE_URL}/${pathPrefix}/rozpis.json?v=${keshRazitko}`)
                .then(r => r.status === 404 ? { zapasyMapa: {}, hasMatches: false } : (r.ok ? r.json() : null))
                .then(rData => {
                    if (rData) {
                        try { localStorage.setItem(`tipni_cache_rozpis_${sezId}_${lKlic}`, JSON.stringify(rData)); } catch(e){}
                        const jeLive = rData.isLive || Object.values(rData.zapasyMapa || {}).some(zap => zap.apiStatus === "IN_PLAY" || zap.apiStatus === "PAUSED");
                        if (store) {
                            if (!store.liveLeaguesMap) store.liveLeaguesMap = {};
                            store.liveLeaguesMap[lName] = Boolean(jeLive);
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
                        }
                    }
                }).catch(() => {});

            return Promise.all([fetchRozpis, fetchLeaderboard]);
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

    // 🪝 LIFECYCLE BOOTSTRAP: Globální autentizace s nativním načtením stavu ankety z Firestore
    onAuthStateChanged(window.auth, async (user) => {
        if (!user) return;

        // 🏛️ JEDINÝ ZDROJ PRAVDY: Načteme reálný stav ankety přímo z Firestore
        try {
            const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js");
            const ref = doc(window.db, "ankety", "premier_cup", "hraci", user.uid);
            const snap = await getDoc(ref);
            if (snap.exists()) {
                const aData = snap.data() || {};
                const store = window.Alpine?.store('appState');
                if (store) {
                    store.surveyUserStatus = aData.status || null;
                    store.hasVotedPremierCup = (aData.status === 'VOTED');
                }
            }
        } catch (e) {
            console.warn("Anketa bootstrap warning:", e);
        }

        const activeLeague = localStorage.getItem('savedLeague');
        const activeScreen = localStorage.getItem('savedScreen');
        if (activeLeague && activeLeague !== 'null' && activeScreen && activeScreen !== 'leaguesScreen') {
            console.log(`⚡ BOOTSTRAP AUTH READY: Spolehlivě stahuji živé kanály a tipy pro ligu: ${activeLeague}`);
            window.naplanujZiveKanaly(activeLeague);
        }
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
		store.mojeBonusy = {
			vitez: soutezData.bonusy?.vitez || '',
			strelec: soutezData.bonusy?.strelec || ''
		};
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
        // Mobil v kapse / zhasnutý displej -> okamžitě zastavíme 15s Turbo smyčku
        if (typeof window.globalLiveMenuUnsubscribe === 'function') {
            window.globalLiveMenuUnsubscribe();
        }
        console.log("🔋 BATERIE ŠTÍT: Aplikace na pozadí, Turbo radar kompletně USPÁN.");
    } else {
        // Rozsvícení appky -> bleskové obnovení dat z R2
        console.log("📱 BATERIE ŠTÍT: Uživatel je zpět, probouzím Turbo radar...");
        window.zapniZiveStreamy(store.selectedLeague);
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

// 🏷️ POMOCNÉ VYTAHOVAČE LOG, ŠTÍTKŮ A POPISŮ PRO KATALOG
window.getLeagueBadge = (liga) => {
    const l = String(liga || '').toLowerCase();
    if (l.includes('premier')) return 'EN • ANGLIE';
    if (l.includes('chance')) return 'CZ • ČESKO';
    if (l.includes('extraliga')) return 'CZ • EXTRALIGA';
    if (l.includes('hokeji')) return 'MS • HOKEJ';
    return 'FIFA • SVĚT';
};

// 🛡️ OFFLINE EMBEDDED VEKTOROVÁ LOGA (BEZ SÍŤOVÝCH POŽADAVKŮ A CHYB 404)
window.getLeagueLogo = (liga) => {
    const l = String(liga || '').toLowerCase();
    
    // 🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League (Ověřené funkční SVG)
    if (l.includes('premier')) {
        return 'https://upload.wikimedia.org/wikipedia/en/f/f2/Premier_League_Logo.svg';
    }
    
    // 🇨🇿 Chance Liga (Zelený fotbalový šít s logem)
    if (l.includes('chance')) {
        return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="%23059669"/><path d="M50 20 L80 35 L80 65 L50 80 L20 65 L20 35 Z" fill="none" stroke="white" stroke-width="6"/><circle cx="50" cy="50" r="12" fill="white"/><path d="M50 38 L50 62 M38 50 L62 50" stroke="%23059669" stroke-width="4"/></svg>';
    }
    
    // 🏒 Tipsport Extraliga (Červený hokejový štít s puky)
    if (l.includes('extraliga')) {
        return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="%23dc2626"/><path d="M25 30 L75 30 L65 75 L50 85 L35 75 Z" fill="white"/><path d="M30 40 L70 40 L60 70 L50 78 L40 70 Z" fill="%23dc2626"/><circle cx="50" cy="55" r="8" fill="white"/></svg>';
    }
    
    // 🏒 MS v Hokeji (IIHF Modrá puka)
    if (l.includes('hokeji')) {
        return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="%230284c7"/><ellipse cx="50" cy="60" rx="30" ry="12" fill="%230f172a"/><ellipse cx="50" cy="52" rx="30" ry="12" fill="white"/><path d="M25 25 L35 70 M75 25 L65 70" stroke="white" stroke-width="6" stroke-linecap="round"/></svg>';
    }
    
    // 🌍 MS ve Fotbale (Zlatá trofej)
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="%2378350f"/><circle cx="50" cy="35" r="16" fill="%23fbbf24"/><path d="M40 50 Q50 60 60 50 L56 75 L44 75 Z" fill="%23fbbf24"/><rect x="36" y="78" width="28" height="8" rx="2" fill="%23fbbf24"/></svg>';
};

window.getLeagueSubtext = (liga) => {
    const store = Alpine.store('appState');
    const _tick = store?.leagueFilterTick; // 🔔 Reaktivní návaznost na změny v paměti

    // 1. ZÁKLADNÍ ZDROJ PRAVDY: Reaktivní seznam uživatelů ze živého radaru
    if (store?.adminUsers && store.adminUsers.length > 0) {
        const pocet = store.adminUsers.filter(u => u.leagues && Array.isArray(u.leagues) && u.leagues.includes(liga)).length;
        if (pocet === 1) return '1 hráč v tipovačce';
        if (pocet >= 2 && pocet <= 4) return `${pocet} hráči v tipovačce`;
        return `${pocet} hráčů v tipovačce`;
    }

    // 2. ZÁLOŽNÍ ZDROJ PRO BĚŽNÉ HRÁČE: Mezipaměť žebříčku z R2
    const sezId = store?.activeSeason || window.SEZONA_ID || "2026_2027";
    const lKlic = String(liga || '').replace(/ /g, "_");
    try {
        const cachedLb = localStorage.getItem(`tipni_cache_lb_${sezId}_${lKlic}`);
        if (cachedLb) {
            const parsed = JSON.parse(cachedLb);
            const pocet = parsed?.zebricek?.length || 0;
            if (pocet === 1) return '1 hráč v tipovačce';
            if (pocet >= 2 && pocet <= 4) return `${pocet} hráči v tipovačce`;
            return `${pocet} hráčů v tipovačce`;
        }
    } catch (e) {}
    return '0 hráčů v tipovačce';
};