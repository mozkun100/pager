// =============================================================
//  عامل الخدمة (Service Worker)
//  ملف صغير يشتغل في خلفية الجوال، حتى لو الصفحة مسكّرة.
//  وظيفته: يستقبل إشعار "طلبك جاهز" من السيرفر ويعرضه.
// =============================================================

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}

  event.waitUntil((async () => {
    // لو صفحة المنبه مفتوحة قدّام العميل، التنبيه داخلها يكفي — ما نكرر بإشعار
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.some((w) => w.visibilityState === 'visible' && w.focused)) return;

    await self.registration.showNotification(data.title || '🔔 طلبك جاهز!', {
      body: data.body || '',
      tag: data.tag || 'pager',       // نفس الطلب = إشعار واحد (ما يتكرر)
      renotify: true,
      requireInteraction: true,       // يظل ظاهر لين العميل يضغطه
      vibrate: [400, 200, 400, 200, 400],
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      data: { url: data.url || '/' },
    });
  })());
});

// الضغط على الإشعار يفتح صفحة المنبه (أو يرجع لها لو مفتوحة)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of windows) {
      if (new URL(w.url).pathname === '/' && 'focus' in w) return w.focus();
    }
    return self.clients.openWindow(url);
  })());
});
