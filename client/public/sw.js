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
  const url = data.url ?? '/'
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Steward', {
      body: data.body ?? '',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: { url },
    })
  )
  // Note: iOS Safari doesn't fire 'notificationclick' when a push notification is
  // tapped, so SW-to-page IPC for navigation doesn't work on iOS. Instead, the
  // server broadcasts a 'pushTarget' event on the /api/events SSE stream, which
  // the page picks up and navigates on visibilitychange. See App.tsx.
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/'
  // Extract session and project IDs from e.g. /?session=<id>&project=<id>
  const params = new URL(url, self.location.origin).searchParams
  const sessionId = params.get('session')
  const projectId = params.get('project')

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        const client = clientList[0]
        client.postMessage({ type: 'switchSession', sessionId, projectId, url })
        return client.focus()
      }
      // No existing tab — open a new window with the session URL
      return clients.openWindow(url)
    })
  )
})
