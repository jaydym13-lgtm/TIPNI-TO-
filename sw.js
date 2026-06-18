// =========================================================================
// 🚀 SERVICE WORKER - AUTOMATICKÝ ČISTIČ CACHE (sw.js)
// =========================================================================

// 🎯 JEDINÝ ŘÁDEK NA SVĚTÊ, KTERÝ PŘI AKTUALIZACI ZMĚNÍŠ
const CACHE_NAME = 'tipnito-v1.0.5';

// Seznam souborů, které se mají bezpečně uložit do paměti telefonu
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
    '/lib/firebase-app-compat.js',
    '/lib/firebase-auth-compat.js',
    '/lib/firebase-firestore-compat.js',
    '/lib/firebase-app-check-compat.js',
    '/lib/firebase-functions-compat.js',
    '/lib/alpine-persist.min.js',
    '/lib/alpine.min.js',
    '/fonts/Oswald-Medium.ttf',
    '/fonts/Oswald-Bold.ttf'
];

// 1. INSTALACE: Stažení nových souborů a okamžitý rozkaz k převzetí moci
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('📥 SW: Stahuji nové soubory do cache...');
            return cache.addAll(ASSETS_TO_CACHE);
        }).then(() => {
            // Přeskočíme čekání – okamžitá aktivace nového SW naráz pro všechny karty
            return self.skipWaiting();
        })
    );
});

// 2. AKTIVACE: KOMPLETNÍ VYMAZÁNÍ STARÉHO BORDELU (Generální úklid)
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log('🗑️ SW: Mažu starou cache z paměti telefonu:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => {
            // Okamžitě převezmeme kontrolu nad všemi otevřenými okny aplikace
            return self.clients.claim();
        })
    );
});

// 3. FETCH STRATEGIE: Rychlý start z paměti, aktualizace na pozadí
self.addEventListener('fetch', (event) => {
    // Firebase požadavky a API necháme volně běžet přes síť
    if (event.request.url.includes('firebase') || event.request.url.includes('firestore')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request);
        })
    );
});