// =========================================================================
// 🔐 TIPNI TO! - ŽIVÁ AUTENTIKACE A SLEDOVÁNÍ ROLÍ V REÁLNÉM ČASE (auth.js)
// =========================================================================

import { signInWithEmailAndPassword, signOut, onIdTokenChanged, GoogleAuthProvider, signInWithPopup, linkWithPopup } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { doc, getDoc, setDoc, deleteDoc, onSnapshot, updateDoc, serverTimestamp, collection, arrayUnion } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// 🏆 PŘIHLÁŠENÍ DO DOPLŇKOVÉ SOUTĚŽE LIGA MISTRŮ (ATOMICKÝ ZÁPIS)
window.prihlasitDoLigyMistru = async () => {
    const user = window.auth?.currentUser;
    if (!user) return;
    try {
        await updateDoc(doc(window.db, 'users', user.uid), {
            leagues: arrayUnion('Liga mistrů')
        });
        if (typeof window.showToast === 'function') {
            window.showToast("🎉 Vítej v Lize mistrů! Tipování odemčeno.");
        }
    } catch (err) {
        console.error("Chyba přihlášení do LM:", err);
        if (typeof window.showToast === 'function') {
            window.showToast("❌ Chyba při přihlašování do soutěže", true);
        }
    }
};

// ⏱️ NENÁROČNÝ PING AKTIVITY HRÁČE (MAX 1 ZÁPIS ZA 15 MINUT)
window.zapisAktivituUzivatele = async () => {
    const user = window.auth?.currentUser;
    if (!user || !navigator.onLine) return;

    const nyni = Date.now();
    const posledniPing = parseInt(localStorage.getItem('tipni_last_seen_ping') || '0', 10);
    const limitMs = 15 * 60 * 1000; // 15 minut

    if (nyni - posledniPing < limitMs) return;

    try {
        localStorage.setItem('tipni_last_seen_ping', String(nyni));
        await updateDoc(doc(window.db, 'users', user.uid), {
            lastSeen: serverTimestamp()
        });
    } catch (e) {}
};

// 📱 PASIVNÍ DETEKCE VYTAŽENÍ MOBILU Z KAPSY
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
        window.zapisAktivituUzivatele();
    }
});

// 🔗 PROPOJENÍ STÁVAJÍCÍHO ÚČTU S GOOGLE (PO PŘIHLÁŠENÍ HESLEM V MENU)
window.linkCurrentAccountWithGoogle = async () => {
    try {
        const user = window.auth.currentUser;
        if (!user) return;
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await linkWithPopup(user, provider);
        if (typeof window.showToast === 'function') {
            window.showToast("🎉 Účet úspěšně propojen s Googlem! Příště se přihlásíš 1 klikem.", false);
        }
        const store = Alpine.store('appState');
        if (store) store.canLinkGoogle = false;
    } catch (err) {
        if (err.code === 'auth/popup-closed-by-user') return;
        console.error("Chyba propojení:", err);
        if (typeof window.showToast === 'function') {
            if (err.code === 'auth/credential-already-in-use') {
                window.showToast("🛑 Tento Google účet už používá jiný hráč!", true);
            } else {
                window.showToast("❌ Chyba propojení: " + err.message, true);
            }
        }
    }
};

// 🎓 ZÁPIS DOKONČENÍ PRŮVODCE DO CLOUDU (FIRESTORE)
window.completeTutorial = async () => {
    const user = window.auth?.currentUser;
    if (!user) return;
    try {
        await updateDoc(doc(window.db, 'users', user.uid), {
            hasSeenTutorial: true
        });
    } catch (err) {
        console.warn("Uložení stavu průvodce selhalo:", err);
    }
};

// 🔑 PŘIHLÁŠENÍ E-MAILEM A HESLEM (S OKAMŽITÝM PŘEPNUTÍM OBRAZOVKY)
window.checkLogin = async () => {
    const email = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    const errorBox = document.getElementById('loginError');
    const store = Alpine.store('appState');

    try {
        if (store) store.currentScreen = 'splashScreen';
        if (typeof window.showSplash === 'function') window.showSplash("Přihlašuji...");
        const userCredential = await signInWithEmailAndPassword(window.auth, email, pass);
        console.log("Firebase Auth: Ověření úspěšné.");
        if (errorBox) errorBox.style.display = 'none';

    } catch (error) {
        if (store) store.currentScreen = 'loginScreen';
        if (typeof window.hideSplash === 'function') window.hideSplash();
        console.error("Chyba přihlášení:", error.message);
        if (errorBox) {
            errorBox.style.display = 'block';
            errorBox.innerText = "❌ Chyba: Špatný e-mail nebo heslo.";
        }
    }
};

// 🌐 PŘIHLÁŠENÍ 1 KLIKEM PŘES GOOGLE (S OKAMŽITÝM PŘEPNUTÍM OBRAZOVKY)
window.loginWithGoogle = async () => {
    const errorBox = document.getElementById('loginError');
    if (errorBox) errorBox.style.display = 'none';
    const store = Alpine.store('appState');

    try {
        if (store) store.currentScreen = 'splashScreen';
        if (typeof window.showSplash === 'function') window.showSplash("Ověřuji Google účet...");
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        const result = await signInWithPopup(window.auth, provider);
        console.log("Firebase Auth (Google): Ověření úspěšné, UID:", result.user.uid);
    } catch (error) {
        if (store) store.currentScreen = 'loginScreen';
        if (typeof window.hideSplash === 'function') window.hideSplash();
        if (error.code === 'auth/popup-closed-by-user') {
            console.log("Přihlášení přes Google bylo zrušeno uživatelem.");
            return;
        }
        console.error("Chyba Google přihlášení:", error.message);
        if (errorBox) {
            errorBox.style.display = 'block';
            errorBox.innerText = "❌ Chyba Google: " + (error.code === 'auth/unauthorized-domain' ? 'Tato doména není povolena ve Firebase Console!' : error.message);
        }
    }
};

// ŽIVÉ PŘEPÍNÁNÍ VIDITELNOSTI HESLA (OČKO)
window.togglePasswordVisibility = () => {
    const passwordInput = document.getElementById('password');
    const toggleIcon = document.getElementById('togglePassword');
    if (!passwordInput || !toggleIcon) return;
    
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggleIcon.innerText = '🙈';
    } else {
        passwordInput.type = 'password';
        toggleIcon.innerText = '👁️';
    }
};

window.logout = async () => {
    if (window.userProfileUnsubscribe) { 
        window.userProfileUnsubscribe(); 
        window.userProfileUnsubscribe = null; 
    }
    if (window.userOnlineUnsubscribe) {
        window.userOnlineUnsubscribe();
        window.userOnlineUnsubscribe = null;
    }
    if (window.userSezonaUnsubscribe) {
        window.userSezonaUnsubscribe();
        window.userSezonaUnsubscribe = null;
    }
    if (window.globalAdminUsersUnsubscribe) {
        window.globalAdminUsersUnsubscribe();
        window.globalAdminUsersUnsubscribe = null;
    }

    // 🧹 Úklid databáze před odchodem: Kompletní promazání relačních klíčů z paměti zařízení
    const user = window.auth.currentUser;
    if (user) {
        await updateDoc(doc(window.db, 'users', user.uid), {
            lastSeen: serverTimestamp()
        }).catch(() => {});
    }

    // Dokonalé vyčištění klientského stavu (zabezpečení proti míchání účtů na 1 mobilu)
    localStorage.removeItem('savedScreen');
    localStorage.removeItem('savedLeague');

    await signOut(window.auth);
    location.reload();
};

// Globální proměnné pro uložení vypínačů živého spojení
window.userProfileUnsubscribe = window.userProfileUnsubscribe || null;
window.userOnlineUnsubscribe = window.userOnlineUnsubscribe || null;
window.userSezonaUnsubscribe = window.userSezonaUnsubscribe || null;
window.globalAdminUsersUnsubscribe = window.globalAdminUsersUnsubscribe || null;

// 👥 ŽIVÝ RADAR UŽIVATELŮ (CENTRÁLNÍ PRO ADMIN I SUPERADMIN PANEL)
window.spustZivyAdminRadarUzivatelu = () => {
    if (window.globalAdminUsersUnsubscribe) return;
    const store = Alpine.store('appState');
    if (store && (!store.adminUsers || store.adminUsers.length === 0)) {
        store.adminUsers = [];
        store.adminUsersLoaded = false;
    }

    window.globalAdminUsersUnsubscribe = onSnapshot(collection(window.db, 'users'), (snapshot) => {
        window.adminUsersCache = snapshot.docs;
        const uzivatele = [];
        const MASTER_LIGY = ['Chance Liga', 'Premier League', 'Liga mistrů', 'MS ve fotbale', 'Tipsport Extraliga', 'MS v hokeji'];
        const liveCounts = {};
        MASTER_LIGY.forEach(l => { liveCounts[l] = 0; });

        snapshot.forEach(docSnap => {
            const uData = docSnap.data() || {};
            
            // 🎯 Počítáme VŠECHNY hráče v lize včetně SuperAdmina
            MASTER_LIGY.forEach(lName => {
                const hasLeague = uData.isSuperAdmin === true || (Array.isArray(uData.leagues) && uData.leagues.includes(lName));
                if (hasLeague) {
                    liveCounts[lName]++;
                }
            });

            // Do tabulky pro správu uživatelů dáme pouze běžné hráče
            if (uData.isSuperAdmin !== true) {
                uzivatele.push({ 
                    id: docSnap.id, 
                    ...uData,
                    maZadnouLigu: !uData.leagues || uData.leagues.length === 0
                });
            }
        });

        // 🎯 Abecední řazení A–Z podle české diakritiky
        uzivatele.sort((a, b) => {
            const nickA = a.nickname || 'Nový Hráč';
            const nickB = b.nickname || 'Nový Hráč';
            return nickA.localeCompare(nickB, 'cs');
        });

        if (store) {
            store.adminUsers = uzivatele;
            store.adminUsersLoaded = true;
            store.leaguePlayerCounts = liveCounts;
            store.leagueFilterTick++;
        }

        // ⚡ OKAMŽITÉ PŘEKRESLENÍ SUPERADMIN PANELU PŘED OČIMA (BEZ F5!)
        if (store?.currentScreen === 'superAdminScreen' && window.superAdminActiveTab === 'users' && typeof window.vykresliSuperAdminUzivatele === 'function') {
            window.vykresliSuperAdminUzivatele(uzivatele);
        }

        console.log(`👥 ŽIVÝ RADAR UŽIVATELŮ: Aktualizováno ${uzivatele.length} hráčů v reálném čase.`);
    }, (err) => console.error("Chyba živého admin radaru uživatelů:", err));
};

// 🎯 DYNAMICKÝ LISTENER TIPŮ: Umí se okamžitě přehlástit na jakoukoliv vybranou sezónu
window.obnovSluchatkoMojeTipy = (uid) => {
    if (!uid) return;
    if (window.userSezonaUnsubscribe) {
        window.userSezonaUnsubscribe();
        window.userSezonaUnsubscribe = null;
    }

    const store = Alpine.store('appState');
    const aktivniSezona = store?.activeSeason || window.SEZONA_ID || '2026_2027';

    window.userSezonaUnsubscribe = onSnapshot(doc(window.db, 'users', uid, 'sezony', aktivniSezona), (sezonaSnap) => {
        console.log(`🪐 Detekována živá změna herní sezóny [${aktivniSezona}]!`);
        const sezonaData = sezonaSnap.exists() ? sezonaSnap.data() : {};
        
        if (store) {
            store.rawSezonaData = sezonaData;
        }

        const aktLiga = store?.selectedLeague || localStorage.getItem('savedLeague') || 'Chance Liga';
        if (typeof window.aktualizujMojeTipyProLigu === 'function') {
            window.aktualizujMojeTipyProLigu(aktLiga);
        }

        if (store?.currentScreen === 'matchesScreen' && store?.selectedLeague && typeof window.renderMatches === 'function') {
            window.renderMatches(store.selectedLeague);
        }
    }, (err) => console.error("Chyba streamu sezóny:", err));
};

// 🔐 DETERMINISTICKÝ AUTH & PROFILOVÝ ROUTER (BEZ TIMEOUTŮ A BEZ RACE CONDITIONS)
const vykonejBezpecnyAuthRouting = (user) => {
    const store = Alpine.store('appState');
    if (!store) return;

    if (!user) {
        if (window.userProfileUnsubscribe) { 
            window.userProfileUnsubscribe(); 
            window.userProfileUnsubscribe = null; 
        }
        if (window.userOnlineUnsubscribe) {
            window.userOnlineUnsubscribe();
            window.userOnlineUnsubscribe = null;
        }
        if (window.userSezonaUnsubscribe) {
            window.userSezonaUnsubscribe();
            window.userSezonaUnsubscribe = null;
        }
        window.currentAuthUid = null;

        if (store.currentScreen !== 'loginScreen') {
            store.currentScreen = 'loginScreen';
        }
        store.isAdmin = false;
        store.isSuperAdmin = false;
        store.nickname = '';
        store._leagues = [];
        
        if (typeof window.hideSplash === 'function') window.hideSplash();
        return;
    }

    console.log("Uživatel ověřen přes native token stream, UID:", user.uid);
    if (store.currentScreen === 'loginScreen') {
        store.currentScreen = 'splashScreen';
    }
    if (typeof window.showSplash === 'function') {
        window.showSplash("Načítání profilu...");
    } else if (typeof window.setSplashText === 'function') {
        window.setSplashText("Načítání profilu...");
    }

    const emailLabel = document.getElementById('userMenuEmail');
    if (emailLabel) emailLabel.innerText = user.email || '';

    // 🛡️ JISTIČ SMYČKY: Pokud už pro toto UID živé sluchátko běží, neobnovujeme
    if (window.currentAuthUid === user.uid && window.userProfileUnsubscribe) {
        return;
    }
    window.currentAuthUid = user.uid;

    if (window.userProfileUnsubscribe) window.userProfileUnsubscribe();

    const userDocRef = doc(window.db, 'users', user.uid);

    window.userProfileUnsubscribe = onSnapshot(userDocRef, async (docSnap) => {
        console.log("🔔 Detekována živá změna profilu na Firebase přes UID!");

        // 🏛️ ČISTÝ DETERMINISTICKÝ START (BEZ NÁSILNÉHO PŘERUŠOVÁNÍ WEBSOCKETU)
        const surveySnap = await getDoc(doc(window.db, "ankety", "premier_cup", "hraci", user.uid)).catch(() => null);
        const tokenResult = await user.getIdTokenResult();
        const claims = tokenResult.claims || {};

        if (surveySnap && surveySnap.exists()) {
            const aData = surveySnap.data() || {};
            store.surveyUserStatus = aData.status || null;
            store.hasVotedPremierCup = (aData.status === 'VOTED');
        } else {
            store.surveyUserStatus = null;
            store.hasVotedPremierCup = false;
        }
        
        window.obnovSluchatkoMojeTipy(user.uid);

        const userData = docSnap.exists() ? docSnap.data() : null;
        const targetLeagues = userData?.leagues || [];

        store.isSuperAdmin = claims.isSuperAdmin === true || userData?.isSuperAdmin === true;
        store.isAdmin = claims.isAdmin === true || userData?.isAdmin === true || store.isSuperAdmin;
        store.canLinkGoogle = !user.providerData.some(p => p.providerId === 'google.com');
        store.leagueOrder = userData?.leagueOrder || [];
        store.lastLeagueOrderChange = userData?.lastLeagueOrderChange?.toMillis ? userData.lastLeagueOrderChange.toMillis() : (userData?.lastLeagueOrderChange || 0);

        // 🛡️ REAKTIVNÍ PROPOJENÍ: Pokud je uživatel Admin, nastartujeme kontinuální radar uživatelů
        if (store.isAdmin) {
            window.spustZivyAdminRadarUzivatelu();
        } else if (window.globalAdminUsersUnsubscribe) {
            window.globalAdminUsersUnsubscribe();
            window.globalAdminUsersUnsubscribe = null;
        }
        
        const AKTIVNI_MASTER_LIGY = ['Chance Liga', 'Premier League', 'Liga mistrů', 'MS ve fotbale', 'Tipsport Extraliga', 'MS v hokeji'];

        store.leagues = store.isSuperAdmin 
            ? AKTIVNI_MASTER_LIGY 
            : (targetLeagues.length > 0 ? targetLeagues : (claims.leagues || []));

        if (store.currentScreen === 'matchesScreen' && store.selectedLeague) {
            if (typeof window.renderMatches === 'function') window.renderMatches(store.selectedLeague);
        }
        if (store.currentScreen === 'leaderboardScreen') {
            if (typeof window.renderLeaderboard === 'function') window.renderLeaderboard();
        }

        if (!store.isSuperAdmin) {
            if (store.currentScreen === 'adminScreen' && !store.isAdmin) {
                store.selectedLeague = null;
                store.selectedAdminLeague = null;
                window.goToScreen('leaguesScreen');
                window.showToast("🛑 Tvá práva administrátora byla zrušena!", true);
            }
            const ligoveObrazovky = ['matchesScreen', 'leaderboardScreen', 'scoringScreen'];
            if (ligoveObrazovky.includes(store.currentScreen) && store.selectedLeague) {
                const isLM = store.selectedLeague === 'Liga mistrů';
                if (!store.leagues.includes(store.selectedLeague) && !isLM) {
                    store.selectedLeague = null;
                    window.goToScreen('leaguesScreen');
                    window.showToast("🚧 Přístup do této tipovačky vypršel!", true);
                }
            }
        }

        // 🎯 ATOMICKÉ ROZHODNUTÍ: Má hráč v databázi přezdívku?
        if (userData && userData.nickname) {
            store.nickname = userData.nickname;
            const nickLabel = document.getElementById('userMenuNickname');
            if (nickLabel) nickLabel.innerText = store.nickname;

            window.zapisAktivituUzivatele();

            if (typeof window.prefetchVsechnyLigy === 'function') {
                window.prefetchVsechnyLigy().catch(() => {});
            }

            if (store.currentScreen === 'splashScreen' || store.currentScreen === 'nicknameScreen' || store.currentScreen === 'loginScreen') {
                const ulozeneScreen = localStorage.getItem('savedScreen');
                const ulozenaLiga = localStorage.getItem('savedLeague');

                if (ulozeneScreen && ulozeneScreen !== 'leaguesScreen') {
                    if (ulozenaLiga) {
                        store.selectedLeague = ulozenaLiga;
                    }
                    window.goToScreen(ulozeneScreen);
                } else {
                    store.currentScreen = 'leaguesScreen';
                }
            }
            if (typeof window.hideSplash === 'function') window.hideSplash();
        // 🎓 KONTROLA PRŮVODCE: Pokud nový hráč ještě neviděl tutoriál, automaticky ho otevřeme
            if (userData.hasSeenTutorial !== true && typeof window.openTutorial === 'function') {
                window.openTutorial();
            }
        } else {
            // Nový hráč bez profilu nebo bez přezdívky
            const nickLabel = document.getElementById('userMenuNickname');
            if (nickLabel) nickLabel.innerText = "Nový hráč";
            store.currentScreen = 'nicknameScreen';
            if (typeof window.hideSplash === 'function') window.hideSplash();
        }
    }, (err) => {
        console.error("Kritická chyba živého spojení přes UID:", err);
    });
};

// 🚀 DETERMINISTICKÝ START HLÍDAČE IDENTITY
onIdTokenChanged(window.auth, (user) => {
    if (typeof window.setSplashText === 'function') window.setSplashText("Ověřuji uživatele...");

    if (window.Alpine && Alpine.store('appState')) {
        vykonejBezpecnyAuthRouting(user);
    } else {
        document.addEventListener('alpine:initialized', () => {
            vykonejBezpecnyAuthRouting(user);
        }, { once: true });
    }
});

// =========================================================================
// 📲 PWA AUTOMATIKA: DETERMINISTICKÁ REGISTRACE BEZ TIMEOUTŮ
// =========================================================================
if ('serviceWorker' in navigator) {
    const registrujSW = async () => {
        try {
            const reg = await navigator.serviceWorker.register('./sw.js');
            setInterval(() => { reg.update(); }, 60000);
        } catch (err) {
            // Ignorujeme chybový stav vznikající výhradně při probíhajícím auto-reloadu v Live Serveru
            if (err.name !== 'InvalidStateError') {
                console.warn("SW Registrace selhala:", err);
            }
        }
    };

    if (document.readyState === 'complete') {
        registrujSW();
    } else {
        window.addEventListener('load', registrujSW, { once: true });
    }

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
    });
}

// Odchycení instalačního promptu pro oranžové tlačítko
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('pwaInstallBtn');
    if (installBtn) installBtn.style.display = 'block';
});

window.triggerPwaInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
        const installBtn = document.getElementById('pwaInstallBtn');
        if (installBtn) installBtn.style.display = 'none';
    }
    deferredPrompt = null;
};

window.addEventListener('appinstalled', () => {
    const installBtn = document.getElementById('pwaInstallBtn');
    if (installBtn) installBtn.style.display = 'none';
    deferredPrompt = null;
});