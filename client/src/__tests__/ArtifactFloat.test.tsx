// @quality: correctness
// @type: example

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { Artifact } from '../lib/api'
import { ArtifactFloat } from '../components/ArtifactFloat'

const mockArtifact: Artifact = {
  id: 'a1',
  project_id: 'p1',
  name: 'Report',
  type: 'report',
  path: '/r',
  metadata: null,
  created_from_session: null,
  created_at: 0,
  updated_at: 0,
}

function setupMatchMedia(matchesNarrow: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 767px)' && matchesNarrow,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

describe('ArtifactFloat', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maximizes when mobileExpandTick increments on a narrow viewport', async () => {
    setupMatchMedia(true)
    const props = {
      openArtifacts: [{ artifact: mockArtifact, content: '# Hi', minimized: false }],
      activeArtifactId: 'a1' as const,
      projectId: 'p1' as const,
      onActivate: vi.fn(),
      onClose: vi.fn(),
      onMinimize: vi.fn(),
      onRestore: vi.fn(),
      onContentChange: vi.fn(),
      onSave: vi.fn().mockResolvedValue(undefined),
    }
    const { rerender } = render(<ArtifactFloat {...props} mobileExpandTick={0} />)
    expect(screen.queryByTitle('Restore size')).not.toBeInTheDocument()

    rerender(<ArtifactFloat {...props} mobileExpandTick={1} />)
    await waitFor(() => {
      expect(screen.getByTitle('Restore size')).toBeInTheDocument()
    })
  })

  it('does not maximize on tick increment when viewport is wide', async () => {
    setupMatchMedia(false)
    const props = {
      openArtifacts: [{ artifact: mockArtifact, content: '# Hi', minimized: false }],
      activeArtifactId: 'a1' as const,
      projectId: 'p1' as const,
      onActivate: vi.fn(),
      onClose: vi.fn(),
      onMinimize: vi.fn(),
      onRestore: vi.fn(),
      onContentChange: vi.fn(),
      onSave: vi.fn().mockResolvedValue(undefined),
    }
    const { rerender } = render(<ArtifactFloat {...props} mobileExpandTick={0} />)
    rerender(<ArtifactFloat {...props} mobileExpandTick={1} />)
    await waitFor(() => {
      expect(screen.queryByTitle('Restore size')).not.toBeInTheDocument()
    })
    expect(screen.getByTitle('Maximize')).toBeInTheDocument()
  })
})
