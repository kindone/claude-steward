/**
 * Per-tab persistence of the last-active project + session, so refresh
 * resumes the right chat in each tab.
 *
 * Why two stores:
 *   - sessionStorage is scoped to the browsing context (tab), survives refresh,
 *     and dies on tab close. Used as the *primary* read/write so each tab
 *     remembers its own session independently.
 *   - localStorage is shared across all tabs of the same origin. Used as a
 *     *fallback* on read — when a brand-new tab opens without its own session
 *     history, it falls back to "last-used session anywhere" from localStorage.
 *     Also written on save so the fallback stays fresh.
 *
 * The previous implementation used only localStorage, which caused multi-tab
 * users to lose their tab's session on refresh: whichever tab most recently
 * changed state overwrote the shared key, and every other tab refreshing
 * after that would resume *that* session instead of its own.
 */
export const LAST_STATE_KEY = 'steward:lastState'

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
 * Read the last-active state for this tab. Prefers sessionStorage (per-tab,
 * survives refresh), falls back to localStorage (cross-tab default for new
 * tabs). Returns `{ projectId: null, sessionId: null }` if nothing is stored
 * or if storage is unavailable / contains invalid JSON.
 */
export function readLastState(): LastState {
  for (const storage of candidateStorages()) {
    try {
      const raw = storage.getItem(LAST_STATE_KEY)
      if (raw === null) continue
      const parsed = JSON.parse(raw) as unknown
      if (isValidLastState(parsed)) return parsed
    } catch {
      // Storage unavailable (e.g. private mode, quota, CSP) or parse failed —
      // try the next storage, then fall through to EMPTY.
    }
  }
  return EMPTY
}

/**
 * Save the last-active state. Writes to both sessionStorage (so this tab
 * resumes the right session on refresh) and localStorage (so newly opened
 * tabs default to the last-used session). Each write is independently
 * guarded so a quota/private-mode error in one doesn't skip the other.
 */
export function saveLastState(projectId: string | null, sessionId: string | null): void {
  const value = JSON.stringify({ projectId, sessionId })
  for (const storage of candidateStorages()) {
    try {
      storage.setItem(LAST_STATE_KEY, value)
    } catch {
      // Ignore individual storage failures. A private-window sessionStorage
      // quota error shouldn't prevent the localStorage write from succeeding.
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
