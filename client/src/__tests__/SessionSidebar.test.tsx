import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionSidebar } from '../components/SessionSidebar'
import { mockProjects, mockSessions } from './msw-server'

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
    onDeleteSession: vi.fn(),
    loading: false,
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
    expect(active).toHaveClass('sidebar__item--active')
  })

  it('calls onSelectSession when a session is clicked', async () => {
    const { onSelectSession } = renderSidebar()
    await userEvent.click(screen.getByText('Second chat'))
    expect(onSelectSession).toHaveBeenCalledWith('ses-2')
  })

  it('calls onNewSession when + button is clicked', async () => {
    const { onNewSession } = renderSidebar()
    await userEvent.click(screen.getByTitle('New Chat'))
    expect(onNewSession).toHaveBeenCalled()
  })

  it('calls onDeleteSession with confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { onDeleteSession } = renderSidebar()
    // Delete buttons are visible on hover — use click directly
    const deleteButtons = screen.getAllByTitle('Delete session')
    await userEvent.click(deleteButtons[0])
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

  it('does not render file tree when no project is active', () => {
    renderSidebar({ activeProjectId: null })
    expect(screen.queryByText('Files')).not.toBeInTheDocument()
  })
})
