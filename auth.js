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

    // 🧹 Úklid databáze před odchodem: Smažeme online příznak přes UID a uložíme čas odchodu pod UID
    const user = window.auth.currentUser;
    if (user) {
        // Ponecháváme pouze uložení času odchodu lastSeen do tvé users kolekce (bez mazání uzivatele_online)
        await updateDoc(doc(window.db, 'users', user.uid), {
            lastSeen: serverTimestamp()
        }).catch(() => {});
    }

    // Vymažeme permanentní paměť prohlížeče, ať začínáme s čistým štítem
    localStorage.removeItem('savedScreen');
    localStorage.removeItem('savedLeague');

    await signOut(window.auth);
    location.reload();
};

// Globální proměnné pro uložení vypínačů živého spojení
window.userProfileUnsubscribe = window.userProfileUnsubscribe || null;
window.userOnlineUnsubscribe = window.userOnlineUnsubscribe || null;

window.userSezonaUnsubscribe = window.userSezonaUnsubscribe || null;

// Hlídání stavu uživatele přes nativní stream přihlašovacích tokenů Googlu
onIdTokenChanged(window.auth, (user) => {
    const checkAndRedirect = () => {
        if (typeof Alpine !== 'undefined' && Alpine.store('appState')) {
            const store = Alpine.store('appState');
            if (user) {
                console.log("Uživatel ověřen přes native token stream, UID:", user.uid);
                // 🧠 SENIORNÍ KOZISTENTNÍ POJISTKA: Ochrana proti null/undefined emailu při inicializaci streamu
                const rawEmail = user.email || '';
                const emailNormalized = rawEmail.trim().toLowerCase();
                
                const emailLabel = document.getElementById('userMenuEmail');
                if (emailLabel) { 
                    emailLabel.innerText = user.email; 
                }
                
                if (window.userProfileUnsubscribe) window.userProfileUnsubscribe();

                if (window.userSezonaUnsubscribe) window.userSezonaUnsubscribe();

                    // 🪐 ŽIVÝ PARALELNÍ SEZÓNNÍ DRÁT: synchronous krmí Alpine RAM bez jediného zpoždění
                    window.userSezonaUnsubscribe = onSnapshot(doc(window.db, 'users', user.uid, 'sezony', window.SEZONA_ID), (sezonaSnap) => {
                        console.log("🪐 Detekována živá změna herní sezóny!");
                        const sezonaData = sezonaSnap.exists() ? sezonaSnap.data() : {};
                        const souteze = sezonaData.souteze || {};
                        
                        const aktLiga = store.selectedLeague || localStorage.getItem('savedLeague') || 'MS ve fotbale';
                        const ligaKlic = aktLiga.replace(/ /g, '_');
                        const soutezData = souteze[ligaKlic] || {};

                        // Synchronní přelití dat do Alpine paměti naráz
                        store.mojeTipy = soutezData.tipy || {};
                        store.mojeBonusy = soutezData.bonusy || {};
                        store.mojeStatistiky = soutezData.statistiky || {};

                        if (store.currentScreen === 'matchesScreen' && store.selectedLeague && typeof window.renderMatches === 'function') {
                            window.renderMatches(store.selectedLeague);
                        }
                    }, (err) => console.error("Chyba streamu sezóny:", err));

                    window.userProfileUnsubscribe = onSnapshot(doc(window.db, 'users', user.uid), async (docSnap) => {
                    console.log("🔔 Detekována živá změna profilu na Firebase přes UID!");

                    const userData = docSnap.exists() ? docSnap.data() : {};
                    const targetLeagues = userData.leagues || [];

                    // 1. Výpočet a distribuce rolí za letu do Alpine Store z čerstvých dat
                    if (user.uid === 'tfLmfp1twLbcFsxWrgNkZ7iQRC22') {
                        store.isSuperAdmin = true;
                        store.isAdmin = true;
                        store.leagues = ['MS v hokeji', 'MS ve fotbale', 'Tipsport Extraliga', 'Chance Liga'];
                    } else {
                        store.isSuperAdmin = false;
                        store.isAdmin = userData.isAdmin === true;
                        store.leagues = targetLeagues;
                    }

                    // 🚨 PROFI REAKTIVNÍ PROPLACH: Jelikož claims jsou na 100 % na místě, proaktivně obnovíme aktivní datové streamy
                    if (store.currentScreen === 'matchesScreen' && store.selectedLeague) {
                        if (typeof window.renderMatches === 'function') window.renderMatches(store.selectedLeague);
                    }
                    if (store.currentScreen === 'leaderboardScreen') {
                        if (typeof window.renderLeaderboard === 'function') window.renderLeaderboard();
                    }

                    // 🚨 ASYNCHRONNÍ SIGNALIZAČNÍ VYHAZOVAČ (WATCHDOG)
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

                    // 2. Kontrola přezdívky, schválení (Čekárna) a bezpečnostní směrování
                    if (userData.nickname) {
                        store.nickname = userData.nickname;
                        const nickLabel = document.getElementById('userMenuNickname');
                        if (nickLabel) { nickLabel.innerText = store.nickname; }

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
                    } else {
                        // Úplně nový hráč, který ještě nemá vyplněný profil v datbasi
                        const nickLabel = document.getElementById('userMenuNickname');
                        if (nickLabel) { nickLabel.innerText = "Nový hráč"; }
                        store.currentScreen = 'nicknameScreen';
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
                store.currentScreen = 'loginScreen';
                store.isAdmin = false;
                store.isSuperAdmin = false;
                store.nickname = '';
                store.userLeagues = [];
            }
        } else {
            setTimeout(checkAndRedirect, 50);
        }
    };
    checkAndRedirect();
});

// =========================================================================
// 📲 PWA AUTOMATIKA: NEPRŮSTŘELNÁ REGISTRACE, REFRESH A DIALOG
// =========================================================================
if ('serviceWorker' in navigator) {
    const registrujSW = () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => {
                // Kontrola nových verzí na pozadí každou minutu
                setInterval(() => { reg.update(); }, 60000); 
            })
            .catch(err => console.error("SW Chyba:", err));
    };

    if (document.readyState === 'complete') {
        registrujSW();
    } else {
        window.addEventListener('load', registrujSW);
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