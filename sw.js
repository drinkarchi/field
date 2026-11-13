/* Archi Field service worker: shell offline, data selalu dari jaringan (Supabase). */
const VER = 'archi-field-v4';
const SHELL = ['./', './index.html', './manifest.webmanifest', './vendor/supabase.js', './vendor/xlsx.full.min.js', './icons/icon-192.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // Supabase & font: langsung ke jaringan
  if (e.request.mode === 'navigate' || u.pathname.endsWith('/') || u.pathname.endsWith('index.html')) {
    // halaman: jaringan dulu (agar update cepat sampai), cadangan cache saat offline
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(VER).then(x => x.put('./index.html', c)); return r; }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(m => m || fetch(e.request).then(r => { const c = r.clone(); caches.open(VER).then(x => x.put(e.request, c)); return r; })));
});
