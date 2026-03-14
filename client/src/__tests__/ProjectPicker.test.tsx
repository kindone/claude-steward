import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectPicker } from '../components/ProjectPicker'
import { mockProjects } from './msw-server'
import { http, HttpResponse } from 'msw'
import { server } from './msw-server'

const noop = async () => {}

function renderPicker(overrides: Partial<React.ComponentProps<typeof ProjectPicker>> = {}) {
  const onSelect = vi.fn()
  const onCreate = vi.fn().mockResolvedValue(undefined)
  const onDelete = vi.fn()

  render(
    <ProjectPicker
      projects={mockProjects}
      activeProjectId={null}
      onSelect={onSelect}
      onCreate={onCreate}
      onDelete={onDelete}
      {...overrides}
    />
  )
  return { onSelect, onCreate, onDelete }
}

describe('ProjectPicker', () => {
  it('shows "No project" when no active project', () => {
    renderPicker()
    expect(screen.getByText('No project')).toBeInTheDocument()
  })

  it('shows active project name', () => {
    renderPicker({ activeProjectId: 'proj-1' })
    expect(screen.getByText('my-project')).toBeInTheDocument()
  })

  it('opens dropdown on trigger click', async () => {
    renderPicker()
    await userEvent.click(screen.getByRole('button', { name: /no project/i }))
    expect(screen.getByText('my-project')).toBeInTheDocument()
    expect(screen.getByText('other-project')).toBeInTheDocument()
  })

  it('calls onSelect when a project is clicked', async () => {
    const { onSelect } = renderPicker()
    await userEvent.click(screen.getByRole('button', { name: /no project/i }))
    await userEvent.click(screen.getByText('my-project'))
    expect(onSelect).toHaveBeenCalledWith('proj-1')
  })

  it('calls onSelect(null) when "No project" option is clicked', async () => {
    const { onSelect } = renderPicker({ activeProjectId: 'proj-1' })
    await userEvent.click(screen.getByRole('button'))
    const noProjectItems = screen.getAllByText('No project')
    await userEvent.click(noProjectItems[noProjectItems.length - 1])
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('shows creation form on "+ New project" click', async () => {
    renderPicker()
    await userEvent.click(screen.getByRole('button', { name: /no project/i }))
    await userEvent.click(screen.getByText('+ New project'))
    expect(screen.getByPlaceholderText('Project name')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('/absolute/path/on/server')).toBeInTheDocument()
  })

  it('calls onCreate with name and path on form submit', async () => {
    const { onCreate } = renderPicker()
    await userEvent.click(screen.getByRole('button', { name: /no project/i }))
    await userEvent.click(screen.getByText('+ New project'))
    await userEvent.type(screen.getByPlaceholderText('Project name'), 'new-proj')
    await userEvent.type(screen.getByPlaceholderText('/absolute/path/on/server'), '/some/path')
    await userEvent.click(screen.getByText('Add'))
    expect(onCreate).toHaveBeenCalledWith('new-proj', '/some/path')
  })

  it('shows error message when onCreate rejects', async () => {
    const { onCreate } = renderPicker()
    onCreate.mockRejectedValueOnce(new Error('Path does not exist'))
    await userEvent.click(screen.getByRole('button', { name: /no project/i }))
    await userEvent.click(screen.getByText('+ New project'))
    await userEvent.type(screen.getByPlaceholderText('Project name'), 'bad')
    await userEvent.type(screen.getByPlaceholderText('/absolute/path/on/server'), '/bad')
    await userEvent.click(screen.getByText('Add'))
    await waitFor(() => expect(screen.getByText('Path does not exist')).toBeInTheDocument())
  })

  it('calls onDelete with confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { onDelete } = renderPicker({ activeProjectId: 'proj-1' })
    await userEvent.click(screen.getByRole('button'))
    // Use title query to get the delete button directly (CSS hover not applicable in jsdom)
    const deleteButtons = screen.getAllByTitle('Delete project')
    await userEvent.click(deleteButtons[0])
    expect(onDelete).toHaveBeenCalledWith('proj-1')
  })
})
