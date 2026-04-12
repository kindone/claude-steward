/**
 * True when the viewport is below Tailwind’s default `md` breakpoint (768px).
 * Matches the layout where `SessionSidebar` is a drawer rather than an inline column.
 */
export function isBelowTailwindMd(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
}
