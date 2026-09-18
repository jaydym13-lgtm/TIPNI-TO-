// =========================================================================
// 🚀 TIPNI TO! - SERVICE WORKER (sw.js)
// Stale-While-Revalidate Engine pro bleskový start & Smart Offline Cache
// =========================================================================

// 🏷️ JEDINÉ CENTRÁLNÍ MÍSTO PRAVDY PRO VERZI APLIKACE
const APP_VERSION = 'v1.1.29';
const CACHE_NAME = `tipnito-core-${APP_VERSION}`;

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
    'https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js',
    'https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js'
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
        url.hostname.includes('firebasedatabase.app') ||
        url.hostname.includes('cloudfunctions.net') ||
        url.hostname.includes('r2.cloudflarestorage.com') ||
        (url.hostname.includes('r2.dev') && !url.pathname.includes('/teams/') && !url.pathname.includes('/leagues/')) ||
        url.pathname.endsWith('.json') && (url.pathname.includes('/sezony/') || url.searchParams.has('v') || url.searchParams.has('t'))
    ) {
        return; // Obtéká Service Worker přímo na živou síť
    }

    // 🛡️ ETAG REVALIDÁTOR PRO LOGA, TROFEJE A STADIONY Z R2 (Bleskový start + auto-update)
    if (url.pathname.includes('/teams/') || url.pathname.includes('/leagues/')) {
        event.respondWith(
            caches.open(CACHE_NAME).then(async (cache) => {
                const cached = await cache.match(event.request);

                // Na pozadí pošleme podmíněný dotaz s ETagem na Cloudflare
                const headers = new Headers();
                if (cached) {
                    const etag = cached.headers.get('etag');
                    if (etag) headers.set('If-None-Match', etag);
                    const lastMod = cached.headers.get('last-modified');
                    if (lastMod) headers.set('If-Modified-Since', lastMod);
                }

                const bgFetch = fetch(event.request, { headers, cache: 'no-cache' })
                    .then(async (netRes) => {
                        // 304 = na serveru je přesně to samé logo
                        if (netRes.status === 304) return cached;

                        // 200 = na R2 bylo nahráno NOVÉ LOGO!
                        if (netRes.status === 200) {
                            await cache.put(event.request, netRes.clone());

                            // Pošleme signál do aplikace pro okamžité překreslení obrázku na displeji
                            const allClients = await self.clients.matchAll({ type: 'window' });
                            allClients.forEach((client) => {
                                client.postMessage({
                                    type: 'AUTO_IMAGE_UPDATED',
                                    url: event.request.url
                                });
                            });
                        }
                        return netRes;
                    })
                    .catch(() => cached);

                // Vrátíme okamžitě lokální paměť (pokud existuje), jinak počkáme na síť
                return cached || bgFetch;
            })
        );
        return;
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

    // 🚀 B) STALE-WHILE-REVALIDATE (Pro HTML, CSS a JS - start do 100 ms z disku bez čekání na síť)
    if (isLocalAsset) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                const fetchPromise = fetch(event.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
                    }
                    return networkResponse;
                }).catch(() => cachedResponse);

                return cachedResponse || fetchPromise;
            })
        );
    }
});

// 📡 PŘEDÁVÁNÍ VERZE DO APLIKACE (FRONTEND QUERY)
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'GET_VERSION') {
        event.source.postMessage({
            type: 'APP_VERSION',
            version: APP_VERSION
        });
    }
});

// =========================================================================
// 🔔 WEB PUSH NOTIFIKACE (PŘÍJEM A DETERMINISTICKÉ OTEVŘENÍ PWA APLIKACE)
// =========================================================================
self.addEventListener('push', (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch (e) {
        payload = { body: event.data ? event.data.text() : '' };
    }

    const title = payload.notification?.title || payload.data?.title || payload.title || 'TIPNI TO!';
    const body = payload.notification?.body || payload.data?.body || payload.body || 'Pozor, blíží se výkop zápasu!';
    const rawUrl = payload.data?.url || payload.notification?.data?.url || payload.url || '/';
    const targetUrl = new URL(rawUrl, self.location.origin).href;

    const options = {
        body: body,
        icon: '/img/favicon192.png',
        badge: '/img/favicon192.png',
        vibrate: [200, 100, 200],
        tag: payload.notification?.tag || 'untipped-match-alert',
        renotify: true,
        data: { url: targetUrl }
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const rawUrl = event.notification.data?.url || '/';
    const targetUrl = new URL(rawUrl, self.location.origin).href;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
            for (const client of clientList) {
                const clientOrigin = new URL(client.url, self.location.origin).origin;
                if (clientOrigin === self.location.origin && 'focus' in client) {
                    if ('navigate' in client) {
                        await client.navigate(targetUrl);
                    }
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});