'use strict';

// Bump on precache changes so old caches are purged on activate.
var CACHE = 'noodle-v3';

var PRECACHE_URLS = [
    './',
    'index.html',
    'styles/app.css',
    'scripts/app-core.js',
    'scripts/app-ui.js',
    'scripts/app-storage.js',
    'scripts/app-nodes.js',
    'scripts/app-tables.js',
    'scripts/app-tables-clipboard.js',
    'scripts/app-tables-ui.js',
    'scripts/app-tables-lifecycle.js',
    'scripts/app-tables-actions.js',
    'scripts/app-layouts.js',
    'scripts/app-analytics.js',
    'scripts/app-interactions.js',
    'scripts/app-io.js',
    'scripts/app-share.js',
    'scripts/app-init.js',
    'manifest.json',
    'icons/icon.svg',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-512-maskable.png'
];

self.addEventListener('install', function (event) {
    // Take over as soon as the new worker finishes precaching.
    if (typeof self.skipWaiting === 'function') self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE).then(function (cache) {
            // Cache one-by-one so a single 404 doesn't fail the whole install
            // (cache.addAll is atomic and rejects if any URL fails).
            return Promise.all(
                PRECACHE_URLS.map(function (url) {
                    return cache.add(url).catch(function () {
                        // Ignore individual failures; the fetch handler
                        // falls back to network at runtime.
                    });
                })
            );
        })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches
            .keys()
            .then(function (keys) {
                return Promise.all(
                    keys
                        .filter(function (key) {
                            return key !== CACHE;
                        })
                        .map(function (key) {
                            return caches['delete'](key);
                        })
                );
            })
            .then(function () {
                if (typeof self.clients !== 'undefined' && self.clients.claim) {
                    return self.clients.claim();
                }
            })
    );
});

function cacheableResponse(response) {
    // Only cache successful same-origin ("basic") responses.
    return Boolean(response) && response.status === 200 && response.type === 'basic';
}

self.addEventListener('fetch', function (event) {
    if (event.request.method !== 'GET') return;
    var url;
    try {
        url = new URL(event.request.url);
    } catch (err) {
        return;
    }
    if (url.origin !== self.location.origin) return;

    // Navigations: network-first so users get fresh HTML, offline fallback
    // to the precached shell.
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(function (response) {
                    if (cacheableResponse(response)) {
                        var clone = response.clone();
                        caches.open(CACHE).then(function (cache) {
                            cache.put(event.request, clone);
                        });
                    }
                    return response;
                })
                .catch(function () {
                    return caches.match('index.html').then(function (cached) {
                        return cached || caches.match('./');
                    });
                })
        );
        return;
    }

    // Static assets: stale-while-revalidate. Serve cache instantly when
    // available, refresh in the background; fall back to network.
    event.respondWith(
        caches.match(event.request).then(function (cached) {
            var networkFetch = fetch(event.request)
                .then(function (response) {
                    if (cacheableResponse(response)) {
                        var clone = response.clone();
                        caches.open(CACHE).then(function (cache) {
                            cache.put(event.request, clone);
                        });
                    }
                    return response;
                })
                .catch(function () {
                    // Offline and not cached: return the cached entry if we
                    // have one, otherwise a plain offline response instead of
                    // an unhandled rejection.
                    if (cached) return cached;
                    return new Response('Offline', {
                        status: 503,
                        statusText: 'Service Unavailable',
                        headers: { 'Content-Type': 'text/plain' }
                    });
                });
            if (cached) {
                // Keep the SW alive for the background revalidation.
                if (event.waitUntil) event.waitUntil(networkFetch.catch(function () {}));
                return cached;
            }
            return networkFetch;
        })
    );
});
