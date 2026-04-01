import { useCallback, useEffect, useState } from 'react';

export interface UseNotificationPermissionReturn {
  /** Current permission state */
  permission: NotificationPermission;
  /** Whether notifications are granted */
  isGranted: boolean;
  /** Whether the browser supports notifications */
  isSupported: boolean;
  /** Request notification permission from the user */
  requestPermission: () => Promise<NotificationPermission>;
  /**
   * Show a notification using the simple Notification API.
   * Falls back to service worker showNotification when available.
   */
  showNotification: (title: string, body: string, url?: string) => void;
}

export function useNotificationPermission(): UseNotificationPermissionReturn {
  const isSupported = typeof window !== 'undefined' && 'Notification' in window;

  const [permission, setPermission] = useState<NotificationPermission>(
    isSupported ? Notification.permission : 'denied',
  );

  // Sync permission state if it changes externally (e.g. browser settings)
  useEffect(() => {
    if (!isSupported) return;

    // Some browsers support the onchange event on the permission status
    void navigator.permissions?.query({ name: 'notifications' }).then((status) => {
      const handleChange = () => setPermission(Notification.permission);
      status.addEventListener('change', handleChange);
      return () => status.removeEventListener('change', handleChange);
    });
  }, [isSupported]);

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!isSupported) return 'denied';

    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, [isSupported]);

  const showNotification = useCallback(
    (title: string, body: string, url?: string) => {
      if (!isSupported || permission !== 'granted') return;

      // Prefer service worker notification (works even when tab is in background)
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'show-notification',
          payload: { title, body, url },
        });

        // Also use the registration directly for reliability
        void navigator.serviceWorker.ready.then((registration) => {
          void registration.showNotification(title, {
            body,
            tag: `claude-remote-${Date.now()}`,
            icon: '/favicon.ico',
            data: { url: url ?? '/' },
            requireInteraction: false,
          });
        });
        return;
      }

      // Fallback: simple Notification API
      const notification = new Notification(title, {
        body,
        icon: '/favicon.ico',
        tag: `claude-remote-${Date.now()}`,
      });

      if (url) {
        notification.onclick = () => {
          window.focus();
          window.location.href = url;
          notification.close();
        };
      }
    },
    [isSupported, permission],
  );

  return {
    permission,
    isGranted: permission === 'granted',
    isSupported,
    requestPermission,
    showNotification,
  };
}
