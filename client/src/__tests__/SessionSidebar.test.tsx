// Feature:     Session management
// Spec:        ∀ render: all session titles visible; active session marked
//              ∀ session click: onSelectSession invoked with correct sessionId
//              ∀ delete flow (click → confirm): onDeleteSession invoked; no call on cancel
//              ∀ sessions=[]: empty placeholder shown
//              ∀ loading=true: loading indicator shown
//              ∀ activeProjectId set: file tree tab visible; null → placeholder shown
// @quality:    correctness
// @type:       example
// @mode:       verification

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionSidebar } from '../components/SessionSidebar'
import { mockProjects, mockSessions } from './msw-server'
import type { CliName } from '../lib/api'

function renderSidebar(overrides: Partial<React.ComponentProps<typeof SessionSidebar>> = {}) {
  const handlers = {
    projects: mockProjects,
    activeProjectId: 'proj-1',
    onSelectProject: vi.fn(),
    onCreateProject: vi.fn().mockResolvedValue(undefined),
    onDeleteProject: vi.fn(),
    sessions: mockSessions,
    activeSessionId: 'ses-1',
    onSelectSession: vi.fn(),
    onNewSession: vi.fn(),
    // Default mirrors a multi-CLI deploy so the popover-path tests trigger
    // by default. Single-CLI / loading scenarios override this explicitly.
    availableClis: ['claude', 'opencode'] as CliName[],
    onDeleteSession: vi.fn(),
    onDeleteAllSessions: vi.fn(),
    onRenameSession: vi.fn().mockResolvedValue(undefined),
    loading: false,
    onOpenArtifact: vi.fn(),
  }
  render(<SessionSidebar {...handlers} {...overrides} />)
  return handlers
}

describe('SessionSidebar', () => {
  it('renders all session titles', () => {
    renderSidebar()
    expect(screen.getByText('First chat')).toBeInTheDocument()
    expect(screen.getByText('Second chat')).toBeInTheDocument()
  })

  it('marks the active session', () => {
    renderSidebar()
    const active = screen.getByText('First chat').closest('li')!
    expect(active).toHaveClass('bg-app-blue-tint')
  })

  it('calls onSelectSession when a session is clicked', async () => {
    const { onSelectSession } = renderSidebar()
    await userEvent.click(screen.getByText('Second chat'))
    expect(onSelectSession).toHaveBeenCalledWith('ses-2')
  })

  it('opens the CLI picker popover when + is clicked (multi-CLI deploy)', async () => {
    const { onNewSession } = renderSidebar()
    await userEvent.click(screen.getByTitle('New Chat'))
    // Popover header confirms it opened; both adapter buttons are present.
    expect(screen.getByText('New chat with')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'claude' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'opencode' })).toBeInTheDocument()
    // The + click alone must not create a session — only an explicit pick does.
    expect(onNewSession).not.toHaveBeenCalled()
  })

  it('calls onNewSession with the picked CLI', async () => {
    const { onNewSession } = renderSidebar()
    await userEvent.click(screen.getByTitle('New Chat'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'opencode' }))
    expect(onNewSession).toHaveBeenCalledWith('opencode')
    expect(onNewSession).toHaveBeenCalledTimes(1)
  })

  it('skips the popover and creates directly with the only CLI (single-adapter deploy)', async () => {
    const { onNewSession } = renderSidebar({ availableClis: ['claude'] })
    await userEvent.click(screen.getByTitle('New Chat'))
    expect(onNewSession).toHaveBeenCalledWith('claude')
    // No popover — verifies the "no useless picker" branch.
    expect(screen.queryByText('New chat with')).not.toBeInTheDocument()
  })

  it('disables the + button while adapters are still loading', async () => {
    const { onNewSession } = renderSidebar({ availableClis: [] })
    const button = screen.getByTitle('Loading…')
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(onNewSession).not.toHaveBeenCalled()
  })

  it('calls onDeleteSession with confirmation', async () => {
    const { onDeleteSession } = renderSidebar()
    // Open 3-dot menu for the first session
    const menuButtons = screen.getAllByTitle('Session options')
    await userEvent.click(menuButtons[0])
    // Click Delete in the dropdown
    await userEvent.click(screen.getByRole('button', { name: /Delete/i }))
    // Inline confirm appears — click Yes
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(onDeleteSession).toHaveBeenCalledWith('ses-1')
  })

  it('shows empty hint when sessions list is empty', () => {
    renderSidebar({ sessions: [] })
    expect(screen.getByText('No sessions yet')).toBeInTheDocument()
  })

  it('shows loading text while loading', () => {
    renderSidebar({ sessions: [], loading: true })
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders file tree when a project is active', () => {
    renderSidebar()
    expect(screen.getByText('Files')).toBeInTheDocument()
  })

  it('shows "No project selected" when no project is active', () => {
    renderSidebar({ activeProjectId: null })
    // "Files" tab label is always present; check that the tree is replaced with the placeholder
    expect(screen.getAllByText('No project selected').length).toBeGreaterThan(0)
  })
})
