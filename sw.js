// =========================================================================
// 🚀 TIPNI TO! - ENTERPRISE SERVICE WORKER V1.0.12 (sw.js)
// Stale-While-Revalidate Engine pro bleskový start (100 ms) & Smart Offline Cache
// =========================================================================

const CACHE_NAME = 'tipnito-core-v1.0.12';

// Statické a neměnné assety (Písma, ikony, externí knihovny z CDN)
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

// Místní aplikační kód (App Shell)
const APP_CODE_ASSETS = [
    '/',
    '/index.html',
    '/config.js',
    '/app.js',
    '/ui.js',
    '/rules.js',
    '/render.js',
    '/compare.js',
    '/auth.js',
    '/changelog.js',
    '/style.css'
];

// 1. INSTALACE: Bleskové uložení App Shell balíčku do paměti
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            const allAssets = [...IMMUTABLE_ASSETS, ...APP_CODE_ASSETS];
            // Odolné paralelní uložení - selhání jedné ikony nezastaví celou instalaci
            await Promise.allSettled(
                allAssets.map((url) =>
                    cache.add(url).catch((err) => {
                        if (location.hostname === 'localhost') {
                            console.warn(`[SW] Chyba při kešování: ${url}`, err);
                        }
                    })
                )
            );
        }).then(() => self.skipWaiting())
    );
});

// 2. AKTIVACE: Kompletní likvidace starých verzí z disku mobilu
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// 3. FETCH: BLESKOVÁ HYBRIDNÍ STRATEGIE
self.addEventListener('fetch', (event) => {
    // Pouze GET dotazy (POST/PUT pro tipy jdou vždy nativně na server)
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    // 🛡️ CIRCUIT BREAKER: Živá API, Firebase, Auth tokeny ani Cloudflare R2 JSONy se NEKEŠUJÍ
    if (
        url.hostname.includes('firestore.googleapis.com') ||
        url.hostname.includes('identitytoolkit.googleapis.com') ||
        url.hostname.includes('securetoken.googleapis.com') ||
        url.hostname.includes('appcheck-api') ||
        url.hostname.includes('cloudfunctions.net') ||
        url.hostname.includes('r2.cloudflarestorage.com') ||
        url.hostname.includes('r2.dev') ||
        url.pathname.endsWith('.json') && (url.pathname.includes('/sezony/') || url.searchParams.has('v') || url.searchParams.has('t'))
    ) {
        return; // Obtéká Service Worker přímo na živou síť
    }

    const isLocalAsset = url.origin === location.origin;
    const isImmutableAsset = IMMUTABLE_ASSETS.some((asset) => event.request.url.includes(asset));

    // ⚡ A) CACHE-FIRST (Pro neměnné těžké CDN knihovny a systémové fonty)
    if (isImmutableAsset) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) return cachedResponse;

                return fetch(event.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
                    }
                    return networkResponse;
                });
            })
        );
        return;
    }

    // 🚀 B) NETWORK-FIRST S OFFLINE FALLBACKEM (Pro HTML, CSS a JS soubory aplikace)
    // Stáhne vždy nejčerstvější kód ze sítě; při výpadku signálu okamžitě sáhne do offline cache
    if (isLocalAsset) {
        event.respondWith(
            fetch(event.request)
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
                    }
                    return networkResponse;
                })
                .catch(() => {
                    return caches.match(event.request);
                })
        );
    }
});