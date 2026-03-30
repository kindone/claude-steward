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
  // Bootstrap: register a new device using the server API key instead of an existing session
  const [showBootstrap, setShowBootstrap] = useState(false)
  const [bootstrapKey, setBootstrapKey] = useState('')

  async function handleRegister(apiKey?: string) {
    setBusy(true)
    setError(null)
    try {
      const options = await apiStartReg(apiKey ? { bootstrapKey: apiKey } : undefined) as PublicKeyCredentialCreationOptionsJSON
      const credential = await startRegistration({ optionsJSON: options })
      await finishRegistration(credential)
      onAuthenticated()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('server API key') || msg.includes('authenticate first')) {
        setError('Invalid API key — check the API_KEY value in your server .env file.')
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
            {busy && !showBootstrap ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <PasskeyIcon />
            )}
            Sign in with Passkey
          </button>
        ) : (
          <button
            onClick={() => handleRegister()}
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

        {/* Bootstrap: register new device with API key */}
        {hasCredentials && (
          <div className="mt-5">
            {!showBootstrap ? (
              <p className="text-center text-xs text-[#555]">
                No passkey on this device?{' '}
                <button
                  onClick={() => { setShowBootstrap(true); setError(null) }}
                  className="text-[#888] underline hover:text-white"
                >
                  Register with API key
                </button>
              </p>
            ) : (
              <div className="rounded-xl border border-[#2a2a2a] bg-[#111] p-4">
                <p className="mb-3 text-xs text-[#888]">
                  Enter the <code className="text-[#aaa]">API_KEY</code> from your server's{' '}
                  <code className="text-[#aaa]">.env</code> file to register this device.
                </p>
                <input
                  type="password"
                  value={bootstrapKey}
                  onChange={(e) => setBootstrapKey(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && bootstrapKey) handleRegister(bootstrapKey) }}
                  placeholder="API key"
                  autoFocus
                  className="w-full rounded-lg border border-[#333] bg-[#1a1a1a] px-3 py-2.5 text-sm text-white placeholder-[#555] outline-none focus:border-[#555] mb-3"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleRegister(bootstrapKey)}
                    disabled={busy || !bootstrapKey}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
                  >
                    {busy ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    ) : (
                      <PasskeyIcon />
                    )}
                    Register this device
                  </button>
                  <button
                    onClick={() => { setShowBootstrap(false); setBootstrapKey(''); setError(null) }}
                    disabled={busy}
                    className="rounded-lg border border-[#333] px-4 py-2.5 text-sm text-[#666] transition hover:text-white disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
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
