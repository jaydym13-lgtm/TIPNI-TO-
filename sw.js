// =========================================================================
// 🚀 ENTERPRISE SERVICE WORKER - NETWORK-FIRST APPLOGIC & OFFLINE ENGINE (sw.js)
// =========================================================================

const CACHE_NAME = 'tipnito-core-v2';

// Statické a neproměnné assety (Písma, ikonky, externe knihovny z CDN)
const IMMUTABLE_ASSETS = [
    '/manifest.json',
    '/img/favicon192.png',
    '/img/favicon512.png',
    '/fonts/Oswald-Medium.ttf',
    '/fonts/Oswald-Bold.ttf',
    'https://cdn.jsdelivr.net/npm/@alpinejs/persist@3.x.x/dist/cdn.min.js',
    'https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js',
    'https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js',
    'https://www.gstatic.com/firebasejs/11.0.0/firebase-app-check.js',
    'https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js',
    'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js',
    'https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js'
];

// Místní aplikační kód, který se na hostingu často mění
const APP_CODE_ASSETS = [
    '/',
    '/index.html',
    '/config.js',
    '/app.js',
    '/ui.js',
    '/render.js',
    '/compare.js',
    '/auth.js',
    '/style.css'
];

// 1. INSTALACE: Bleskové uložení základního balíčku do paměti
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            console.log('📥 SW: Inicializuji offline registr...');
            const allAssets = [...IMMUTABLE_ASSETS, ...APP_CODE_ASSETS];
            for (const url of allAssets) {
                try {
                    await cache.add(url);
                } catch (err) {
                    console.warn(`⚠️ SW Výstraha: Soubor se nepodařilo zakešovat: ${url}`, err);
                }
            }
        }).then(() => self.skipWaiting())
    );
});

// 2. AKTIVACE: Likvidace starých cache registru z disku
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log('🗑️ SW: Čistím starou mezipaměť:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// 3. FETCH INTELIGENTNÍ HYBRIDNÍ STRATEGIE
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 🛡️ CIRCUIT BREAKER: Živá API databáze, Auth tokeny, Cloud Functions ani R2 CDN se NEKEŠUJÍ
    if (
        url.hostname.includes('firestore.googleapis.com') || 
        url.hostname.includes('identitytoolkit.googleapis.com') || 
        url.hostname.includes('appcheck-api') ||
        url.hostname.includes('cloudfunctions.net') ||
        url.hostname.includes('r2.dev') ||
        event.request.method !== 'GET'
    ) {
        return; // Obtéká Service Worker přímo na síť
    }

    const isLocalAppCode = APP_CODE_ASSETS.some(path => url.pathname === path || (path === '/' && url.pathname === '/index.html'));

    // 🚀 A) STRATEGIE NETWORK-FIRST (Pro místní JS/CSS/HTML kód)
    // Garantuje, že při online připojení dostane uživatel 100% čerstvý kód bez nutnosti měnit verze
    if (isLocalAppCode || url.origin === location.origin) {
        event.respondWith(
            fetch(event.request)
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseToCache);
                        });
                    }
                    return networkResponse;
                })
                .catch(() => {
                    // Pokud je mobil bez signálu, vytáhneme poslední zakešovanou verzi
                    return caches.match(event.request);
                })
        );
        return;
    }

    // ⚡ B) STRATEGIE CACHE-FIRST (Pro těžké knihovny z CDN, písma a ikonky)
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            });
        })
    );
});