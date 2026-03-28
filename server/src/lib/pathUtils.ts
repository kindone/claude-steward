import path from 'node:path'

/** Resolve a user-supplied relative path against the project root, preventing traversal.
 *  Returns null if the resolved path would escape the root directory.
 */
export function safeResolvePath(root: string, rel: string): string | null {
  const resolved = path.resolve(root, rel)
  return resolved.startsWith(path.resolve(root)) ? resolved : null
}
