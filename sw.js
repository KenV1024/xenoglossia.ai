// Service Worker: アプリシェルをキャッシュ（cache-first）
// 翻訳API・Claude API・音声認識はネットワーク必須なのでキャッシュしない
const CACHE_NAME = 'speaking-coach-v2';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/storage.js',
  './js/score.js',
  './js/phonics.js',
  './js/chunker.js',
  './js/speech.js',
  './js/parser.js',
  './js/ai.js',
  './js/app.js',
  './lib/pdf.min.js',
  './lib/pdf.worker.min.js',
  './lib/mammoth.browser.min.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 同一オリジンのGETのみキャッシュ対象（API通信はそのまま素通し）
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
