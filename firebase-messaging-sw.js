importScripts('https://www.gstatic.com/firebasejs/12.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCXN4q5M6oUkZXTlXL3WHExWv1jcP83kFc',
  authDomain: 'focus-hub-b8bfc.firebaseapp.com',
  projectId: 'focus-hub-b8bfc',
  storageBucket: 'focus-hub-b8bfc.firebasestorage.app',
  messagingSenderId: '691259568151',
  appId: '1:691259568151:web:bcab4443372d58201cac52',
  measurementId: 'G-4157Y6TKXJ'
});

const messaging = firebase.messaging();
const NOTIFICATION_DEBUG_DB = 'focus-hub-notification-debug';
const NOTIFICATION_DEBUG_STORE = 'events';

function openNotificationDebugDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NOTIFICATION_DEBUG_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(NOTIFICATION_DEBUG_STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function writeNotificationDebug(update = {}) {
  try {
    const db = await openNotificationDebugDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(NOTIFICATION_DEBUG_STORE, 'readwrite');
      tx.objectStore(NOTIFICATION_DEBUG_STORE).put({ id: 'latest', updatedAt: new Date().toISOString(), ...update });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (_) {}
}

async function syncWorkerBadge(rawCount) {
  const count = Number(rawCount || 0) || 0;
  const nav = self.navigator;
  if (!nav) return;
  try {
    if (count > 0 && typeof nav.setAppBadge === 'function') {
      await nav.setAppBadge(count);
    } else if (count <= 0 && typeof nav.clearAppBadge === 'function') {
      await nav.clearAppBadge();
    }
  } catch (_) {}
}

async function showFocusNotification(payload = {}) {
  const data = payload?.data || {};
  const notification = payload?.notification || {};
  const title = data.title || notification.title || 'Focus Hub';
  await writeNotificationDebug({
    serviceWorkerReceivedPayload: 'yes',
    visibleNotificationShown: 'unknown',
    lastPayload: JSON.stringify({ data, notification }).slice(0, 500)
  });
  const options = {
    body: data.body || notification.body || 'Masz nowe przypomnienie.',
    icon: data.icon || notification.icon || './icon-192.png',
    badge: data.badge || './apple-touch-icon.png',
    tag: data.tag || undefined,
    data: {
      url: data.url || './',
      page: data.page || '',
      taskId: data.taskId || ''
    }
  };
  await syncWorkerBadge(data.badgeCount);
  await self.registration.showNotification(title, options);
  await writeNotificationDebug({
    serviceWorkerReceivedPayload: 'yes',
    visibleNotificationShown: 'yes',
    lastShownTitle: title,
    lastShownTag: options.tag || '',
    lastShownAt: new Date().toISOString()
  });
}

messaging.onBackgroundMessage((payload) => showFocusNotification(payload));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
