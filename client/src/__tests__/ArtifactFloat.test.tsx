// @quality: correctness
// @type: example

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Artifact } from '../lib/api'
import { ArtifactFloat } from '../components/ArtifactFloat'

const mockArtifact: Artifact = {
  id: 'a1',
  project_id: 'p1',
  name: 'Report',
  type: 'report',
  path: '/r',
  metadata: null,
  topic_id: null,
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

  it('uses inline flex layout on wide viewport until maximized', async () => {
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
    render(<ArtifactFloat {...props} />)
    const shell = document.querySelector('[data-layout]')
    expect(shell).toHaveAttribute('data-layout', 'inline')

    await userEvent.click(screen.getByTitle('Maximize'))
    expect(shell).toHaveAttribute('data-layout', 'overlay')

    await userEvent.click(screen.getByTitle('Restore size'))
    expect(shell).toHaveAttribute('data-layout', 'inline')
  })

  it('keeps overlay layout on narrow viewport even after restore from maximized', async () => {
    setupMatchMedia(true)
    const props = {
      openArtifacts: [{ artifact: mockArtifact, content: '# Hi', minimized: false }],
      activeArtifactId: 'a1' as const,
      projectId: 'p1' as const,
      mobileExpandTick: 1,
      onActivate: vi.fn(),
      onClose: vi.fn(),
      onMinimize: vi.fn(),
      onRestore: vi.fn(),
      onContentChange: vi.fn(),
      onSave: vi.fn().mockResolvedValue(undefined),
    }
    render(<ArtifactFloat {...props} />)
    const shell = document.querySelector('[data-layout]')
    await waitFor(() => {
      expect(shell).toHaveAttribute('data-layout', 'overlay')
    })

    await userEvent.click(screen.getByTitle('Restore size'))
    expect(shell).toHaveAttribute('data-layout', 'overlay')
  })
})
