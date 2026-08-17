'use strict';

var CACHE = 'flowchart-v1';

var PRECACHE_URLS = [
    '.',
    'index.html',
    'styles/app.css',
    'vendor/lucide-0.469.0.min.js',
    'scripts/app-core.js',
    'scripts/app-ui.js',
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
    'scripts/app-init.js',
    'manifest.json',
    'icons/icon.svg'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE).then(function (cache) {
            return cache.addAll(PRECACHE_URLS);
        })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
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
    );
});

self.addEventListener('fetch', function (event) {
    if (event.request.method !== 'GET') return;
    var url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        caches.match(event.request).then(function (cached) {
            var fetched = fetch(event.request).then(function (response) {
                if (response && response.status === 200) {
                    var clone = response.clone();
                    caches.open(CACHE).then(function (cache) {
                        cache.put(event.request, clone);
                    });
                }
                return response;
            });
            return cached || fetched;
        })
    );
});
