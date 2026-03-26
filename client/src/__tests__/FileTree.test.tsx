import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileTree } from '../components/FileTree'

describe('FileTree', () => {
  it('renders the toggle button', () => {
    render(<FileTree projectId="proj-1" />)
    expect(screen.getByText('Files')).toBeInTheDocument()
  })

  it('is collapsed by default', () => {
    render(<FileTree projectId="proj-1" />)
    expect(screen.queryByText('README.md')).not.toBeInTheDocument()
  })

  it('loads and shows files on expand', async () => {
    render(<FileTree projectId="proj-1" />)
    await userEvent.click(screen.getByText('Files'))
    await waitFor(() => expect(screen.getByText('README.md')).toBeInTheDocument())
    expect(screen.getByText('src/')).toBeInTheDocument()
  })

  it('collapses back when toggle is clicked again', async () => {
    render(<FileTree projectId="proj-1" />)
    await userEvent.click(screen.getByText('Files'))
    await waitFor(() => expect(screen.getByText('README.md')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Files'))
    expect(screen.queryByText('README.md')).not.toBeInTheDocument()
  })

  it('opens file viewer on file click', async () => {
    render(<FileTree projectId="proj-1" />)
    await userEvent.click(screen.getByText('Files'))
    await waitFor(() => screen.getByText('README.md'))
    await userEvent.click(screen.getByText('README.md'))
    // '# Hello' is rendered as markdown → <h1>Hello</h1>
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument())
  })

  it('closes file viewer on × button', async () => {
    render(<FileTree projectId="proj-1" />)
    await userEvent.click(screen.getByText('Files'))
    await waitFor(() => screen.getByText('README.md'))
    await userEvent.click(screen.getByText('README.md'))
    await waitFor(() => screen.getByRole('heading', { name: 'Hello' }))
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByRole('heading', { name: 'Hello' })).not.toBeInTheDocument()
  })
})
