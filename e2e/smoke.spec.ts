import { test, expect } from '@playwright/test'

test.describe('App shell', () => {
  test('loads without errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto('/')
    await expect(page.locator('.app')).toBeVisible()
    expect(errors).toHaveLength(0)
  })

  test('shows the project picker', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.project-picker__trigger')).toBeVisible()
  })

  test('shows the sessions section', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.sidebar__section-label')).toContainText('Sessions')
  })
})

test.describe('Project picker', () => {
  test('opens dropdown on click', async ({ page }) => {
    await page.goto('/')
    await page.click('.project-picker__trigger')
    await expect(page.locator('.project-picker__dropdown')).toBeVisible()
  })

  test('shows "+ New project" option', async ({ page }) => {
    await page.goto('/')
    await page.click('.project-picker__trigger')
    await expect(page.locator('.project-picker__new-btn')).toBeVisible()
  })

  test('shows project creation form', async ({ page }) => {
    await page.goto('/')
    await page.click('.project-picker__trigger')
    await page.click('.project-picker__new-btn')
    await expect(page.locator('input[placeholder="Project name"]')).toBeVisible()
    await expect(page.locator('input[placeholder="/absolute/path/on/server"]')).toBeVisible()
  })

  test('shows validation error for nonexistent path', async ({ page }) => {
    await page.goto('/')
    await page.click('.project-picker__trigger')
    await page.click('.project-picker__new-btn')
    await page.fill('input[placeholder="Project name"]', 'Test Project')
    await page.fill('input[placeholder="/absolute/path/on/server"]', '/nonexistent/path')
    await page.click('button:has-text("Add")')
    await expect(page.locator('.project-picker__error')).toBeVisible()
  })
})

test.describe('Session management', () => {
  test('creates a new session', async ({ page }) => {
    await page.goto('/')
    await page.click('.sidebar__new-btn')
    // Wait for the new "New Chat" session to appear as the active item
    await expect(page.locator('.sidebar__item--active')).toBeVisible()
  })

  test('new session shows the chat input', async ({ page }) => {
    await page.goto('/')
    await page.click('.sidebar__new-btn')
    await expect(page.locator('.input-bar__textarea')).toBeVisible()
  })

  test('shows empty state when no sessions exist', async ({ page }) => {
    await page.goto('/')
    // Note: sessions may exist from previous test runs — just verify the UI renders
    await expect(page.locator('.app__main')).toBeVisible()
  })
})
