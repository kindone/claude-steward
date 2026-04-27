/**
 * Per-tab persistence of the last-active project + session, so refresh
 * (and full browser restart) resumes the right chat in each tab.
 *
 * Three layers, consulted in this order on read and written together on save:
 *
 *   1. URL hash fragment — `#project=<id>&session=<id>`. Most durable.
 *      Browsers preserve a tab's URL across refresh, app close, and *full
 *      browser restart* (Android Chrome, iOS Safari) even when sessionStorage
 *      is wiped. Hash fragments are not sent in HTTP requests, so they
 *      don't appear in server logs / referrer headers. Mutated via
 *      `history.replaceState` (no new history entries).
 *
 *   2. sessionStorage — per-tab, survives refresh on most browsers but is
 *      often wiped on full mobile browser restart. Useful as a redundant
 *      backup on desktop where the URL might be edited away.
 *
 *   3. localStorage — shared across all tabs of the origin. Used as a
 *      *fallback* on read so a brand-new tab (no URL params, empty
 *      sessionStorage) opens to the last-used session anywhere. Also
 *      written on save so that fallback stays fresh.
 *
 * The original implementation used only localStorage. That broke for
 * multi-tab users: tabs raced over a single shared key, so refreshing one
 * tab would resume whichever session another tab had most recently
 * touched. Adding sessionStorage fixed refresh-within-a-session, but
 * mobile browsers wipe sessionStorage on full app reopen, collapsing all
 * restored tabs back onto the same localStorage value. The hash fragment
 * is the only per-tab data browsers reliably preserve across full
 * restart, which is why it's now the primary store.
 */
export const LAST_STATE_KEY = 'steward:lastState'
const HASH_PROJECT_KEY = 'project'
const HASH_SESSION_KEY = 'session'

export type LastState = {
  projectId: string | null
  sessionId: string | null
}

const EMPTY: LastState = { projectId: null, sessionId: null }

function isValidLastState(value: unknown): value is LastState {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const okProject = v.projectId === null || typeof v.projectId === 'string'
  const okSession = v.sessionId === null || typeof v.sessionId === 'string'
  return okProject && okSession
}

/**
 * Parse the URL hash into URLSearchParams. Strips the leading `#` if
 * present. Returns an empty params object if the hash is malformed.
 */
function parseHashParams(hash: string): URLSearchParams {
  try {
    return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  } catch {
    return new URLSearchParams()
  }
}

/**
 * Read state from the URL hash. Returns `null` (signalling "fall through
 * to next source") unless *both* keys are present — partial hashes are
 * treated as missing rather than mixed-source state, since the writer
 * always emits the pair atomically.
 */
export function readHashState(): LastState | null {
  if (typeof window === 'undefined') return null
  try {
    const params = parseHashParams(window.location.hash)
    const projectId = params.get(HASH_PROJECT_KEY)
    const sessionId = params.get(HASH_SESSION_KEY)
    if (!projectId || !sessionId) return null
    return { projectId, sessionId }
  } catch {
    return null
  }
}

/**
 * Update the URL hash to `#project=<id>&session=<id>` via
 * `history.replaceState` so we don't pollute browser history. Other parts
 * of the URL (pathname, search) are preserved. Any non-steward keys
 * already in the hash are also preserved so we don't stomp on third-party
 * use of the hash (e.g. anchor links).
 *
 * If either id is null, the entire steward pair is removed from the hash
 * — we never want a half-written hash.
 */
export function writeHashState(projectId: string | null, sessionId: string | null): void {
  if (typeof window === 'undefined') return
  try {
    const params = parseHashParams(window.location.hash)
    if (projectId && sessionId) {
      params.set(HASH_PROJECT_KEY, projectId)
      params.set(HASH_SESSION_KEY, sessionId)
    } else {
      params.delete(HASH_PROJECT_KEY)
      params.delete(HASH_SESSION_KEY)
    }
    const url = new URL(window.location.href)
    const hashStr = params.toString()
    url.hash = hashStr // empty string clears the hash
    window.history.replaceState({}, '', url.toString())
  } catch {
    // window.history may be unavailable in some embedded contexts; non-fatal.
  }
}

/**
 * Read the last-active state for this tab.
 *
 * Priority: hash fragment → sessionStorage → localStorage. Returns
 * `{ projectId: null, sessionId: null }` if nothing is stored, none of
 * the sources are accessible, or all stored values are invalid.
 */
export function readLastState(): LastState {
  // 1. URL hash — most durable, survives Android browser restart
  const fromHash = readHashState()
  if (fromHash) return fromHash

  // 2. sessionStorage (per-tab, refresh-survivable)
  // 3. localStorage (cross-tab, "new tab default")
  for (const storage of candidateStorages()) {
    try {
      const raw = storage.getItem(LAST_STATE_KEY)
      if (raw === null) continue
      const parsed = JSON.parse(raw) as unknown
      if (isValidLastState(parsed)) return parsed
    } catch {
      // Storage unavailable (private mode, quota, CSP) or invalid JSON —
      // try the next source, then fall through to EMPTY.
    }
  }
  return EMPTY
}

/**
 * Save the last-active state to all three sources. Each write is
 * independently try-guarded so a quota/private-mode error in one doesn't
 * skip the others — mobile browsers in particular often allow only some
 * of {hash, sessionStorage, localStorage}.
 */
export function saveLastState(projectId: string | null, sessionId: string | null): void {
  writeHashState(projectId, sessionId)
  const value = JSON.stringify({ projectId, sessionId })
  for (const storage of candidateStorages()) {
    try {
      storage.setItem(LAST_STATE_KEY, value)
    } catch {
      // Ignore individual storage failures.
    }
  }
}

/**
 * Return the storages to consult, in priority order. Split into its own
 * function so tests can verify behaviour when one of the storages is
 * missing (e.g. an older browser or SSR context).
 *
 * Accessing `window.sessionStorage` throws in some privacy modes — guard
 * each with a try.
 */
function candidateStorages(): Storage[] {
  const out: Storage[] = []
  try { if (typeof sessionStorage !== 'undefined') out.push(sessionStorage) } catch { /* ignore */ }
  try { if (typeof localStorage !== 'undefined') out.push(localStorage) } catch { /* ignore */ }
  return out
}
