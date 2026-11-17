/* Service worker del panel: muestra las notificaciones de citas nuevas aunque el panel esté cerrado. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Sebas Barber';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    icon: '/img/logo-192.png',
    badge: '/img/logo-192.png',
    vibrate: [120, 60, 120],
    data: { url: data.url || '/admin/' },
  }));
});

// Al tocar la notificación: abre el panel (o enfoca la pestaña si ya está abierta)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/admin/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).pathname.startsWith('/admin')) { await w.focus(); w.postMessage({ type: 'refresh' }); return; }
    }
    await self.clients.openWindow(url);
  })());
});
