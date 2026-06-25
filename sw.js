// =========================================================================
// 🚀 SERVICE WORKER - AUTOMATICKÝ ČISTIČ CACHE & OFFLINE ENGINE V2 (sw.js)
// =========================================================================

// 🎯 Zvýšení verze na v1.1.2 pro vynucení okamžitého proplachu disku u všech klientů
const CACHE_NAME = 'tipnito-v1.1.2';

// Seznam souborů pro stoprocentní offline chod stadionu (Očištěno o smazané lokální soubory!)
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
    // 🧠 REAKTIVNÍ KOREKCE: Kešujeme reálné CDN balíky, které aplikace reálně vyžaduje v index.html
    'https://cdn.jsdelivr.net/npm/@alpinejs/persist@3.x.x/dist/cdn.min.js',
    'https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js',
    '/fonts/Oswald-Medium.ttf',
    '/fonts/Oswald-Bold.ttf',
    // Kešujeme přímo reálné ES6 moduly z Google CDN, které core jádro importuje
    'https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js',
    'https://www.gstatic.com/firebasejs/11.0.0/firebase-app-check.js',
    'https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js',
    'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js',
    'https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js'
];

// 1. INSTALACE: Bezpečné resilientní stahování assetů do paměti zařízení
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            console.log('📥 SW: Inicializuji bezpečné ukládání assetů do offline registru...');
            // 👑 ULTRA-PROFI ROBUSTNÍ CYKLUS: Namísto náchylného addAll stahujeme soubory po jednom.
            // Pokud v poli omylem zůstane chybějící prvek, spadne pouze on a zbytek aplikace se úspěšně zakešuje.
            for (const url of ASSETS_TO_CACHE) {
                try {
                    await cache.add(url);
                } catch (err) {
                    console.warn(`⚠️ SW Výstraha: Soubor se nepodařilo zakešovat (zkontroluj cestu): ${url}`, err);
                }
            }
        }).then(() => {
            return self.skipWaiting(); // Okamžité převzetí kontroly nad aplikací
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
            return self.clients.claim(); // Okamžité řízení nad otevřenými okny
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
        document.readyState === 'complete' 
            ? fetch(event.request).catch(() => caches.match(event.request))
            : caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                return fetch(event.request);
            })
    );
});