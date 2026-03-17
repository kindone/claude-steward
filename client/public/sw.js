// Steward service worker — handles Web Push notifications

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
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an existing tab if available
      for (const client of clientList) {
        if ('focus' in client) return client.focus()
      }
      // Otherwise open a new window
      const url = event.notification.data?.url ?? '/'
      return clients.openWindow(url)
    })
  )
})
