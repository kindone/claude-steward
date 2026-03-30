/**
 * Tests for HtmlPreview.tsx component.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HtmlPreview } from '../components/HtmlPreview'

describe('HtmlPreview', () => {
  it('renders in preview mode by default (iframe)', () => {
    render(<HtmlPreview html="<h1>Hello</h1>" />)
    const iframe = document.querySelector('iframe')
    expect(iframe).toBeTruthy()
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe?.getAttribute('srcdoc')).toBe('<h1>Hello</h1>')
  })

  it('shows source tab button and Preview tab button', () => {
    render(<HtmlPreview html="<p>test</p>" />)
    expect(screen.getByText('Preview')).toBeTruthy()
    expect(screen.getByText('Source')).toBeTruthy()
  })

  it('switches to source view when Source tab is clicked', async () => {
    const user = userEvent.setup()
    render(<HtmlPreview html="<p>source content</p>" />)

    const sourceBtn = screen.getByText('Source')
    await user.click(sourceBtn)

    // iframe should be gone, pre should appear
    expect(document.querySelector('iframe')).toBeNull()
    expect(screen.getByText('<p>source content</p>')).toBeTruthy()
  })

  it('switches back to preview when Preview tab is clicked', async () => {
    const user = userEvent.setup()
    render(<HtmlPreview html="<em>hi</em>" />)

    await user.click(screen.getByText('Source'))
    await user.click(screen.getByText('Preview'))

    expect(document.querySelector('iframe')).toBeTruthy()
    expect(document.querySelector('pre')).toBeNull()
  })

  it('shows HTML label in tab bar', () => {
    render(<HtmlPreview html="" />)
    expect(screen.getByText('HTML')).toBeTruthy()
  })
})
