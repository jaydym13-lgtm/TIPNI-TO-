// =========================================================================
// 🔐 TIPNI TO! - ŽIVÁ AUTENTIKACE A SLEDOVÁNÍ ROLÍ V REÁLNÉM ČASE (auth.js)
// =========================================================================

window.checkLogin = async () => {
    const email = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    const errorBox = document.getElementById('loginError');

    try {
        await auth.signInWithEmailAndPassword(email, pass);
        console.log("Firebase Auth: Ověření úspěšné.");
        if (errorBox) errorBox.style.display = 'none';

        // 🔐 Zápis do online registru hned při úspěšném přihlášení
        const emailNormalized = email.trim().toLowerCase();
        await db.collection('uzivatele_online').doc(emailNormalized).set({
            deviceId: window.getDeviceId(),
            deviceType: window.getReadableDevice(),
            timestamp: Date.now()
        }).catch(() => {});
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
        toggleIcon.innerText = '🙈'; // Heslo odhaleno -> opička schovává oči
    } else {
        passwordInput.type = 'password';
        toggleIcon.innerText = '👁️'; // Heslo skryto -> zobrazeno očko k rozkliknutí
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

    // 🧹 Úklid databáze před odchodem: Smažeme online příznak a uložíme čas odchodu
    const user = auth.currentUser;
    if (user) {
        const emailNormalized = user.email.trim().toLowerCase();
        await db.collection('uzivatele_online').doc(emailNormalized).delete().catch(() => {});
        await db.collection('users').doc(emailNormalized).update({
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});
    }

    await auth.signOut();
    location.reload();
};

// Globální proměnné pro uložení vypínačů živého spojení
window.userProfileUnsubscribe = window.userProfileUnsubscribe || null;
window.userOnlineUnsubscribe = window.userOnlineUnsubscribe || null;

// Hlídání stavu uživatele s živým napojením na Firestore změny
auth.onAuthStateChanged((user) => {
    const checkAndRedirect = () => {
        if (typeof Alpine !== 'undefined' && Alpine.store('appState')) {
            const store = Alpine.store('appState');
            if (user) {
                console.log("Uživatel ověřen:", user.email);
                const emailNormalized = user.email.trim().toLowerCase();

                // Automatický report přítomnosti na pozadí hned po startu
                setTimeout(() => window.nahlasMojeSpojeni(true), 500);

                // 🚨 PROFI GILOTINA: Sledujeme registr online zařízení pro tento e-mail
                if (window.userOnlineUnsubscribe) window.userOnlineUnsubscribe();
                // Pouštíme gilotinu pro všechny uživatele KROMĚ tebe (výjimka na nekonečno zařízení)
                if (emailNormalized !== 'test@test.cz') {
                    window.userOnlineUnsubscribe = db.collection('uzivatele_online').doc(emailNormalized).onSnapshot((oDoc) => {
                        if (oDoc.exists) {
                            let activeDeviceId = oDoc.data().deviceId;
                            let myLocalDeviceId = window.getDeviceId();
                            
                            // Pokud se ID v databázi liší od našeho, někdo jiný se právě přihlásil!
                            if (activeDeviceId && activeDeviceId !== myLocalDeviceId) {
                                if (window.userOnlineUnsubscribe) { window.userOnlineUnsubscribe(); window.userOnlineUnsubscribe = null; }
                                if (window.userProfileUnsubscribe) { window.userProfileUnsubscribe(); window.userProfileUnsubscribe = null; }
                                
                                if (typeof window.showToast === 'function') {
                                    window.showToast("🚨 PŘÍSTUP PŘERUŠEN!\nTvůj účet se právě přihlásil na jiném zařízení.", true);
                                }
                                window.logout();
                                return;
                            }
                        }
                    });
                }
                
                const emailLabel = document.getElementById('userMenuEmail');
                if (emailLabel) { 
                    emailLabel.innerText = user.email; 
                }
                
                // Pojistka: Pokud už nějaké živé spojení běželo, zavřeme ho, ať nemáme duplicity
                if (window.userProfileUnsubscribe) window.userProfileUnsubscribe();

                // 🔥 ŽIVÝ TUNEL: Sledujeme dokument uživatele nonstop
                window.userProfileUnsubscribe = db.collection('users').doc(user.email).onSnapshot((doc) => {
                    console.log("🔔 Detekována živá změna profilu na Firebase!");

                    // 1. Nastavení administrátorských rolí za letu
                    if (user.email === 'makyan13@seznam.cz') {
                        store.isSuperAdmin = true;
                        store.isAdmin = true;
                    } else if (doc.exists && doc.data().role === 'admin') {
                        store.isAdmin = true;
                        store.isSuperAdmin = false;
                    } else {
                        store.isAdmin = false;
                        store.isSuperAdmin = false;
                    }

                    // 2. Kontrola přezdívky a přesměrování
                    if (doc.exists && doc.data().nickname) {
                        store.nickname = doc.data().nickname;
                        const nickLabel = document.getElementById('userMenuNickname');
                        if (nickLabel) { nickLabel.innerText = store.nickname; }
                        
                        // Pokud je na nahrávací obrazovce, přihlašovací nebo zadává přezdívku, pusť ho na plochu
                        if (store.currentScreen === 'splashScreen' || store.currentScreen === 'nicknameScreen' || store.currentScreen === 'loginScreen') {
                            store.currentScreen = 'leaguesScreen';
                        }
                    } else {
                        // Nemá přezdívku -> Okamžitě ho uzamkneme na zadávací obrazovce
                        const nickLabel = document.getElementById('userMenuNickname');
                        if (nickLabel) { nickLabel.innerText = "Nový hráč"; }
                        store.currentScreen = 'nicknameScreen';
                    }
                }, (err) => {
                    console.error("Kritická chyba živého spojení:", err);
                });

            } else {
                // Uživatel se odhlásil -> Kompletní reset a stopka tunelu
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
            }
        } else {
            // Pokud Alpine ještě nespustil jádro, počkáme 50ms a zkusíme to znova
            setTimeout(checkAndRedirect, 50);
        }
    };
    checkAndRedirect();
});

// =========================================================================
// 📡 PRESENCE ENGINE: POMOCNÉ FUNKCE PRO SLEDOVÁNÍ ZAŘÍZENÍ A ŽIVOTNÍHO CYKLU
// =========================================================================
window.getDeviceId = () => {
    let did = localStorage.getItem('tipni_device_id');
    if (!did) {
        did = 'DEV-' + Math.random().toString(36).substr(2, 5).toUpperCase();
        localStorage.setItem('tipni_device_id', did);
    }
    return did;
};

window.getReadableDevice = () => {
    const ua = navigator.userAgent;
    if (ua.includes("Samsung")) return "Samsung Mobil";
    if (ua.includes("iPhone")) return "iPhone";
    if (ua.includes("Windows")) return "Windows PC";
    if (ua.includes("Android")) return "Android";
    return "Mobilní zařízení";
};

window.nahlasMojeSpojeni = async (budeOnline) => {
    const user = auth.currentUser;
    if (!user) return;
    const emailNormalized = user.email.trim().toLowerCase();

    if (budeOnline && navigator.onLine) {
        await db.collection('uzivatele_online').doc(emailNormalized).set({
            deviceId: window.getDeviceId(),
            deviceType: window.getReadableDevice(),
            timestamp: Date.now()
        }).catch(() => {});
    } else {
        // Tichý odchod: Smažeme z online seznamu a zapíšeme poslední čas do profilu
        await db.collection('uzivatele_online').doc(emailNormalized).delete().catch(() => {});
        await db.collection('users').doc(emailNormalized).update({
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});
    }
};

// Živá vazba na chování oken prohlížeče (minimalizace, přepnutí appky, odswipnutí)
document.addEventListener('visibilitychange', () => {
    window.nahlasMojeSpojeni(document.visibilityState === 'visible');
});

window.addEventListener('pagehide', () => {
    window.nahlasMojeSpojeni(false);
});

// =========================================================================
// 📲 PWA AUTOMATIKA: REGISTRACE, REFRESH A INSTALAČNÍ DIALOG
// =========================================================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => {
                // Kontrola nových verzí na Netlify každou minutu
                setInterval(() => { reg.update(); }, 60000); 
            })
            .catch(err => console.error("SW Chyba:", err));
    });

    // Jakmile v sw.js ručně zvedneš verzi, tento poslech okamžitě vyvolá čistý reload
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