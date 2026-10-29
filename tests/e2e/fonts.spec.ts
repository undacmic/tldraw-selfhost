import { expect, test } from '@playwright/test'

test('editor uses local Inter UI and all official canvas fonts without CDN access', async ({ page, baseURL }) => {
  const failedLocalAssets: string[] = []
  page.on('response', (response) => {
    if (response.url().startsWith(`${baseURL}/assets/`) && !response.ok()) {
      failedLocalAssets.push(`${response.status()} ${response.url()}`)
    }
  })
  // Fonts, icons and translations must work with all external HTTP access blocked.
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === baseURL) return route.continue()
    return route.abort()
  })
  await page.goto('/')
  await page.getByLabel('Board name').fill('Font smoke')
  await page.getByRole('button', { name: 'Create board', exact: true }).click()
  await page.getByRole('button', { name: 'I saved it' }).click()
  await expect(page.locator('.tl-container')).toBeVisible()
  await expect.poll(() => page.evaluate(async () => {
    await document.fonts.ready
    const loaded = [...document.fonts].filter((font) => font.status === 'loaded')
    return {
      ui: getComputedStyle(document.querySelector('.tl-container')!).fontFamily,
      inter: loaded.some((font) => font.family.includes('Inter Variable')),
      canvas: ['tldraw_draw', 'tldraw_sans', 'tldraw_serif', 'tldraw_mono'].every(
        (family) => loaded.some((font) => font.family.replaceAll('"', '') === family),
      ),
    }
  })).toEqual({ ui: expect.stringContaining('Inter Variable'), inter: true, canvas: true })
  expect(failedLocalAssets).toEqual([])
})
