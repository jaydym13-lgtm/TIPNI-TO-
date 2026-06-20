// =========================================================================
// 🚀 SERVICE WORKER - AUTOMATICKÝ ČISTIČ CACHE & OFFLINE ENGINE V2 (sw.js)
// =========================================================================

// 🎯 Změň verzi při jakékoli změně ve statických souborech (HTML, CSS, JS)
const CACHE_NAME = 'tipnito-v1.1.0';

// Seznam souborů pro stoprocentní offline chod stadionu (včetně Google CDN modulů!)
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/app.js',
    '/ui.js',
    '/render.js',
    '/compare.js',
    '/auth.js',
    '/style.css',
    '/manifest.json',
    '/img/favicon192.png',
    '/img/favicon512.png',
    '/lib/alpine-persist.min.js',
    '/lib/alpine.min.js',
    '/fonts/Oswald-Medium.ttf',
    '/fonts/Oswald-Bold.ttf',
    // 🧠 SENIORNÍ FIX: Kešujeme přímo reálné ES6 moduly z Google CDN, které appka reálně importuje
    'https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js',
    'https://www.gstatic.com/firebasejs/11.0.0/firebase-app-check.js',
    'https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js',
    'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js',
    'https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js'
];

// 1. INSTALACE: Stažení nových souborů do paměti zařízení
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('📥 SW: Plním offline zásobník čistými assety...');
            return cache.addAll(ASSETS_TO_CACHE);
        }).then(() => {
            return self.skipWaiting(); // Okamžité převzetí moci bez čekání
        })
    );
});

// 2. AKTIVACE: Kompletní proplach starého bordelu z disku
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log('🗑️ SW: Likviduji historickou cache:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => {
            return self.clients.claim(); // Okamžitá kontrola nad všemi otevřenými taby
        })
    );
});

// 3. FETCH STRATEGIE: Cache First pro statiku, Network bypass pro živá DB data
self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // 🛡️ CIRCUIT BREAKER PRO ŽIVÁ DATA: API požadavky na databázi, Auth tokeny a Cloud Funkce 
    // nesmí Service Worker nikdy kešovat. O jejich offline stav se stará SDK (persistentLocalCache).
    if (
        url.includes('firestore.googleapis.com') || 
        url.includes('identitytoolkit.googleapis.com') || 
        url.includes('appcheck-api') ||
        url.includes('cloudfunctions.net') ||
        event.request.method !== 'GET'
    ) {
        return; // Obtéká Service Worker přímo na síť
    }

    // Pro všechno ostatní (místní soubory + zakešované Firebase JS SDK z CDN) platí rychlý start z cache
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request);
        })
    );
});