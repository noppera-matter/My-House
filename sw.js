const CACHE_NAME = 'myhouse-v15';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './api.js',
    './manifest.json',
];

// Install: cache core assets + 즉시 활성화
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

// Activate: 이전 캐시 전부 삭제 + 즉시 제어
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// Fetch: Network-first 전략 (항상 최신 파일 우선)
self.addEventListener('fetch', (e) => {
    e.respondWith(
        fetch(e.request)
            .then((res) => {
                // 성공하면 캐시 업데이트 후 반환
                const clone = res.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
                return res;
            })
            .catch(() => {
                // 오프라인이면 캐시에서 반환
                return caches.match(e.request);
            })
    );
});
