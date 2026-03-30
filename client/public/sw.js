// Steward service worker — handles Web Push notifications

// Activate immediately and claim all clients so new SW versions take effect
// without waiting for all tabs to close (critical for mobile PWA updates).
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data?.json() ?? {}
  } catch {
    // DevTools test button sends plain text — show it as the body
    data = { title: 'Steward', body: event.data?.text() ?? '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Steward', {
      body: data.body ?? '',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: { url: data.url ?? '/' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/'
  // Extract session ID from e.g. /?session=<id>
  const sessionId = new URL(url, self.location.origin).searchParams.get('session')

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        const client = clientList[0]
        // postMessage is universally supported (iOS/Android PWA, all browsers).
        // client.navigate() only works on controlled clients and is unreliable on
        // iOS Safari — postMessage lets the app switch sessions without a reload.
        client.postMessage({ type: 'switchSession', sessionId, url })
        return client.focus()
      }
      // No existing tab — open a new window with the session URL
      return clients.openWindow(url)
    })
  )
})
