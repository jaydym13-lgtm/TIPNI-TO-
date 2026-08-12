// =========================================================================
// 🔐 TIPNI TO! - ŽIVÁ AUTENTIKACE A SLEDOVÁNÍ ROLÍ V REÁLNÉM ČASE (auth.js)
// =========================================================================

import { signInWithEmailAndPassword, signOut, onIdTokenChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { doc, setDoc, deleteDoc, onSnapshot, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

window.checkLogin = async () => {
    const email = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    const errorBox = document.getElementById('loginError');

    try {
        const userCredential = await signInWithEmailAndPassword(window.auth, email, pass);
        console.log("Firebase Auth: Ověření úspěšné.");
        if (errorBox) errorBox.style.display = 'none';

    } catch (error) {
        console.error("Chyba přihlášení:", error.message);
        if (errorBox) {
            errorBox.style.display = 'block';
            errorBox.innerText = "❌ Chyba: Špatný e-mail nebo heslo.";
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

// Hlídání stavu uživatele přes nativní stream přihlašovacích tokenů Googlu s řízeným enterprise loaderem
onIdTokenChanged(window.auth, (user) => {
    if (typeof window.setSplashText === 'function') window.setSplashText("Ověřuji uživatele...");

    const checkAndRedirect = () => {
        if (typeof Alpine !== 'undefined' && Alpine.store('appState')) {
            const store = Alpine.store('appState');
            if (user) {
                console.log("Uživatel ověřen přes native token stream, UID:", user.uid);
                if (typeof window.setSplashText === 'function') window.setSplashText("Načítání...");
                
                const emailLabel = document.getElementById('userMenuEmail');
                if (emailLabel) { 
                    emailLabel.innerText = user.email; 
                }

                // 🛡️ JISTIČ SMYČKY: Pokud už pro toto UID živé sluchátko běží, nezakládáme ho znovu
                if (window.currentAuthUid === user.uid && window.userProfileUnsubscribe) {
                    return;
                }
                window.currentAuthUid = user.uid;

                if (window.userProfileUnsubscribe) window.userProfileUnsubscribe();

                window.userProfileUnsubscribe = onSnapshot(doc(window.db, 'users', user.uid), async (docSnap) => {
                    console.log("🔔 Detekována živá změna profilu na Firebase přes UID!");

                    // 1. Čtení tokenu bez vynucení serverového refreshování (zamezí nekonečné smyčce)
                    const tokenResult = await user.getIdTokenResult();
                    const claims = tokenResult.claims || {};
                    // 2. Teprve po ověření tokenu bezpečně připojíme sluchátko tipů
                    window.obnovSluchatkoMojeTipy(user.uid);

                    const userData = docSnap.exists() ? docSnap.data() : {};
                    const targetLeagues = userData.leagues || [];

                    store.isSuperAdmin = claims.isSuperAdmin === true;
                    store.isAdmin = claims.isAdmin === true || store.isSuperAdmin;
                    
                    store.leagues = store.isSuperAdmin 
                        ? ['Chance Liga', 'Premier League', 'Liga národů', 'MS ve fotbale', 'Tipsport Extraliga', 'MS v hokeji'] 
                        : (claims.leagues || targetLeagues);

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
                            if (!store.leagues.includes(store.selectedLeague)) {
                                store.selectedLeague = null;
                                window.goToScreen('leaguesScreen');
                                window.showToast("🚧 Přístup do této tipovačky vypršel!", true);
                            }
                        }
                    }

                    if (userData.nickname) {
                        store.nickname = userData.nickname;
                        const nickLabel = document.getElementById('userMenuNickname');
                        if (nickLabel) { nickLabel.innerText = store.nickname; }

                        // 🚀 Spustíme kontrolu R2 na pozadí bez blokování schování opony
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
                        // Vše je staženo a zrenderováno, schováváme loader
                        if (typeof window.hideSplash === 'function') window.hideSplash();
                    } else {
                        const nickLabel = document.getElementById('userMenuNickname');
                        if (nickLabel) { nickLabel.innerText = "Nový hráč"; }
                        store.currentScreen = 'nicknameScreen';
                        if (typeof window.hideSplash === 'function') window.hideSplash();
                    }
                }, (err) => {
                    console.error("Kritická chyba živého spojení přes UID:", err);
                });

            } else {
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
                // 🛡️ STAVOVÝ JISTIČ: Přepneme obrazovku POUZE pokud už na Login obrazovce nestojíme (ochrana focusu a zamezení diskotéky)
                if (store.currentScreen !== 'loginScreen') {
                    store.currentScreen = 'loginScreen';
                }
                store.isAdmin = false;
                store.isSuperAdmin = false;
                store.nickname = '';
                store.userLeagues = [];
                
                // Oponu stahujeme až v momentě, kdy je přihlašovací formulář plně připraven
                if (typeof window.hideSplash === 'function') window.hideSplash();
            }
        } else {
            setTimeout(checkAndRedirect, 50);
        }
    };
    checkAndRedirect();
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