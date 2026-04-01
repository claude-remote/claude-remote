/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

const SW_VERSION = '1.0.0';

/**
 * Service Worker for claude-remote push notifications.
 *
 * Handles:
 * - Push events: display notifications when a push message arrives
 * - Notification click: focus existing app window or open a new one
 * - Lifecycle: install + activate with immediate claim
 */

self.addEventListener('install', () => {
  // Activate immediately, don't wait for old SW to be evicted
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Claim all open tabs so notifications work without a page refresh
  event.waitUntil(self.clients.claim());
});

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  /** Relative URL to navigate to on click, e.g. "/chat/abc123" */
  url?: string;
  icon?: string;
}

self.addEventListener('push', (event) => {
  let payload: PushPayload;

  try {
    payload = event.data?.json() as PushPayload;
  } catch {
    // Fallback for plain-text push messages
    payload = {
      title: 'Claude Remote',
      body: event.data?.text() ?? 'New notification',
    };
  }

  const options: NotificationOptions = {
    body: payload.body,
    tag: payload.tag ?? 'claude-remote-default',
    icon: payload.icon ?? '/favicon.ico',
    badge: '/favicon.ico',
    data: { url: payload.url ?? '/' },
    requireInteraction: true,
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data as { url?: string })?.url ?? '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Try to focus an existing window that is already on the target URL
      for (const client of windowClients) {
        if (new URL(client.url).pathname === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise focus any open window and navigate it
      for (const client of windowClients) {
        if ('focus' in client && 'navigate' in client) {
          return client.focus().then((c) => (c as WindowClient).navigate(targetUrl));
        }
      }
      // Last resort: open a new window
      return self.clients.openWindow(targetUrl);
    }),
  );
});

// Export version for debugging
console.log(`[sw] claude-remote service worker v${SW_VERSION}`);
