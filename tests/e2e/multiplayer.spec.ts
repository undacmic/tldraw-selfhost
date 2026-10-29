import { expect, test, type Page } from '@playwright/test'

async function drawRectangle(page: Page, x: number) {
  await page.keyboard.press('Escape')
  await page.keyboard.press('r')
  const canvas = await page.locator('.tl-canvas').boundingBox()
  if (!canvas) throw new Error('Canvas not found')
  await page.mouse.move(canvas.x + x, canvas.y + 280)
  await page.mouse.down()
  await page.mouse.move(canvas.x + x + 100, canvas.y + 360, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.press('Escape')
}

test('invited editors sync pages independently; viewers are read-only and outsiders are denied', async ({ browser, page, baseURL }) => {
  let connectRequest = ''
  page.on('websocket', (socket) => socket.on('framesent', (frame) => {
    const payload = String(frame.payload)
    if (payload.includes('"type":"connect"')) connectRequest = payload
  }))
  await page.goto('/')
  await page.getByLabel('Board name').fill('Multiplayer team')
  await page.getByRole('button', { name: 'Create board', exact: true }).click()
  await page.getByRole('button', { name: 'I saved it' }).click()
  await expect(page.getByLabel('Current page')).toBeVisible()
  const boardUrl = page.url()
  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  await page.getByRole('button', { name: 'Create invitation link' }).click()
  const editorLink = await page.getByLabel('Invitation link', { exact: true }).inputValue()
  await page.getByLabel('Invitation permission').selectOption('viewer')
  await page.getByRole('button', { name: 'Create invitation link' }).click()
  const viewerLink = await page.getByLabel('Invitation link', { exact: true }).inputValue()
  await page.getByRole('button', { name: 'Close invitations' }).click()

  const editorContext = await browser.newContext()
  const viewerContext = await browser.newContext()
  const outsiderContext = await browser.newContext()
  try {
    const guest = await editorContext.newPage()
    await guest.goto(baseURL!)
    await expect(guest.getByRole('heading', { name: 'Your boards' })).toBeVisible()
    // Pasting a fragment invite while already on the home page must work without a reload.
    await guest.goto(editorLink)
    await expect(guest.getByLabel('Current page')).toBeVisible()
    expect(guest.url()).not.toContain('#invite=')
    await expect(guest.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0)
    await drawRectangle(page, 200)
    await expect(page.locator('.tl-shape')).toHaveCount(1)
    await expect(guest.locator('.tl-shape')).toHaveCount(1)

    await page.getByRole('button', { name: 'New page', exact: true }).click()
    await expect(page.getByLabel('Current page')).toContainText('Page 2')
    await expect(page.locator('.tl-shape')).toHaveCount(0)
    // Creating/switching a page does not move the other participant off Page 1.
    await expect(guest.locator('.tl-shape')).toHaveCount(1)
    await expect(guest.getByLabel('Current page')).toHaveValue(await guest.getByLabel('Current page').locator('option').first().getAttribute('value') ?? '')
    await guest.getByLabel('Current page').selectOption({ label: 'Page 2' })
    await expect(guest.locator('.tl-shape')).toHaveCount(0)
    await drawRectangle(guest, 350)
    await expect(page.locator('.tl-shape')).toHaveCount(1)
    await page.reload()
    await expect(page.getByLabel('Current page').locator('option')).toHaveCount(2)

    const viewer = await viewerContext.newPage()
    const connectMessages: string[] = []
    viewer.on('websocket', (socket) => socket.on('framereceived', (frame) => connectMessages.push(String(frame.payload))))
    await viewer.goto(viewerLink)
    await expect(viewer.getByText('View only', { exact: true })).toBeVisible()
    await expect(viewer.getByRole('button', { name: 'New page', exact: true })).toHaveCount(0)
    await expect.poll(() => connectMessages.some((message) => message.includes('"isReadonly":true'))).toBe(true)
    await viewer.getByLabel('Current page').selectOption({ label: 'Page 2' })
    await expect(viewer.locator('.tl-shape')).toHaveCount(1)
    await viewer.reload()
    await expect(viewer.getByText('View only', { exact: true })).toBeVisible()
    // Bypass all viewer UI restrictions and send a forged document write over a raw socket.
    expect(connectRequest).not.toBe('')
    const result = await viewer.evaluate(({ hello, boardUrl }) => new Promise<string>((resolve, reject) => {
      const boardId = new URL(boardUrl).searchParams.get('board')!
      const url = new URL(`/sync/${boardId}?sessionId=tamper-${crypto.randomUUID()}`, location.origin)
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(url)
      const timeout = setTimeout(() => { socket.close(); reject(new Error('No write acknowledgement')) }, 5000)
      socket.onopen = () => socket.send(hello)
      socket.onmessage = (event) => {
        const text = String(event.data)
        if (text.includes('"type":"connect"')) {
          socket.send(JSON.stringify({ type: 'push', clientClock: 1, diff: {
            'page:forged': ['put', { id: 'page:forged', typeName: 'page', name: 'Unauthorized', index: 'a9', meta: {} }],
          } }))
        } else if (text.includes('push_result')) {
          clearTimeout(timeout); socket.close(); resolve(text)
        }
      }
      socket.onerror = () => { clearTimeout(timeout); reject(new Error('Raw socket failed')) }
    }), { hello: connectRequest, boardUrl })
    expect(result).toContain('"action":"discard"')
    await expect(viewer.getByLabel('Current page').locator('option')).toHaveCount(2)

    const outsider = await outsiderContext.newPage()
    await outsider.goto(boardUrl)
    await expect(outsider.getByRole('alert')).toContainText('invitation required')
    await expect(outsider.locator('.tl-container')).toHaveCount(0)
    const id = new URL(boardUrl).searchParams.get('board')!
    const denied = await outsiderContext.request.get(`${baseURL}/sync/${id}?sessionId=outsider`, { headers: { origin: baseURL! } })
    expect(denied.status()).toBe(403)
    await outsider.goto(`${baseURL}/#invite=${'x'.repeat(43)}`)
    await expect(outsider.getByRole('alert')).toContainText('invalid or has expired')
  } finally {
    await editorContext.close(); await viewerContext.close(); await outsiderContext.close()
  }
})
