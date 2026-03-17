import { useState } from 'react'
import {
  startRegistration,
  startAuthentication,
} from '@simplewebauthn/browser'
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/types'
import {
  startRegistration as apiStartReg,
  finishRegistration,
  startLogin as apiStartLogin,
  finishLogin,
} from '../lib/api'

type Props = {
  /** Whether any passkey is already registered on this server. */
  hasCredentials: boolean
  /** Called after successful registration or login. */
  onAuthenticated: () => void
}

export default function AuthPage({ hasCredentials, onAuthenticated }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRegister() {
    setBusy(true)
    setError(null)
    try {
      const options = await apiStartReg() as PublicKeyCredentialCreationOptionsJSON
      const credential = await startRegistration({ optionsJSON: options })
      await finishRegistration(credential)
      onAuthenticated()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('authenticate first')) {
        setError('To register a new device, sign in on an existing device first — your passkey must be available here via iCloud Keychain or Google Password Manager sync.')
      } else if (!msg.includes('cancelled') && !msg.includes('NotAllowedError')) {
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleLogin() {
    setBusy(true)
    setError(null)
    try {
      const options = await apiStartLogin() as PublicKeyCredentialRequestOptionsJSON
      const assertion = await startAuthentication({ optionsJSON: options })
      await finishLogin(assertion)
      onAuthenticated()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('cancelled') && !msg.includes('NotAllowedError')) {
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-dvh w-full items-center justify-center bg-[#0d0d0d]">
      <div className="w-full max-w-sm px-6">
        {/* Logo / title */}
        <div className="mb-10 text-center">
          <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-2xl">
            🧭
          </div>
          <h1 className="text-2xl font-semibold text-white">Claude Steward</h1>
          <p className="mt-1 text-sm text-[#888]">
            {hasCredentials ? 'Sign in to continue' : 'Set up your passkey to get started'}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-5 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Primary action */}
        {hasCredentials ? (
          <button
            onClick={handleLogin}
            disabled={busy}
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-blue-600 px-5 py-4 text-base font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <PasskeyIcon />
            )}
            Sign in with Passkey
          </button>
        ) : (
          <button
            onClick={handleRegister}
            disabled={busy}
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-blue-600 px-5 py-4 text-base font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <PasskeyIcon />
            )}
            Register this device
          </button>
        )}

        {/* Secondary: add device after login */}
        {hasCredentials && (
          <p className="mt-4 text-center text-xs text-[#555]">
            New device? Your passkey should sync via iCloud or Google Password Manager.{' '}
            <button
              onClick={handleRegister}
              disabled={busy}
              className="text-[#888] underline hover:text-white disabled:opacity-50"
            >
              Try registering this device
            </button>
          </p>
        )}

        <p className="mt-8 text-center text-xs text-[#444]">
          Passkeys use your device&apos;s biometrics or PIN — no password needed.
        </p>
      </div>
    </div>
  )
}

function PasskeyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="8" cy="8" r="3" />
      <path d="M14 8h7M17 5v6M11 11l-1 9h5" />
    </svg>
  )
}
