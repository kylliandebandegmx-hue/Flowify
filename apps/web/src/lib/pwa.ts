export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const url = `${import.meta.env.BASE_URL}sw.js`;
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
      const registration = await navigator.serviceWorker.register(url, { updateViaCache: 'none' });
      await registration.update();
      if ('caches' in window) {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map((key) => caches.delete(key)));
      }
      if (navigator.serviceWorker.controller && !sessionStorage.getItem('flowify-sw-reset-v2')) {
        sessionStorage.setItem('flowify-sw-reset-v2', '1');
        window.location.reload();
      }
    } catch {
      // Old PWA cache cleanup is best-effort.
    }
  });
}

export function isStandaloneDisplay() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && Boolean(navigator.standalone))
  );
}
