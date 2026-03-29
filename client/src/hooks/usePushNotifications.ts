import { useState, useEffect, useCallback } from 'react'
import { getVapidPublicKey, savePushSubscription, deletePushSubscription } from '../lib/api'

export type PushState = 'unsupported' | 'loading' | 'default' | 'granted' | 'denied'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)))
}

/**
 * Manages Web Push subscription lifecycle:
 * - Registers the service worker
 * - Checks existing subscription on mount
 * - Exposes subscribe() / unsubscribe() actions
 */
export function usePushNotifications(sessionId?: string) {
  const [state, setState] = useState<PushState>('loading')

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported')
      return
    }
    const perm = Notification.permission
    if (perm === 'denied') { setState('denied'); return }

    // Check whether we already have an active subscription
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      return reg.pushManager.getSubscription().then((sub) => {
        setState(sub ? 'granted' : 'default')
      })
    }).catch(() => setState('default'))
  }, [])

  const subscribe = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return
    setState('loading')
    try {
      const vapidKey = await getVapidPublicKey()
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      })
      await savePushSubscription(sub, sessionId)
      setState('granted')
    } catch (err) {
      const perm = Notification.permission
      setState(perm === 'denied' ? 'denied' : 'default')
      console.error('[push] subscribe failed:', err)
    }
  }, [])

  const unsubscribe = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return
    setState('loading')
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await deletePushSubscription(sub.endpoint)
        await sub.unsubscribe()
      }
      setState('default')
    } catch (err) {
      console.error('[push] unsubscribe failed:', err)
      setState('granted')
    }
  }, [])

  return { state, subscribe, unsubscribe }
}
