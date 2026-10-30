import { expect, test } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'

const entry = fileURLToPath(new URL('../../dist/server/mcp.js', import.meta.url))
function environment(directory: string) {
  return { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', HOST: '127.0.0.1', PORT: '0', DATA_DIR: directory }
}
async function start(directory: string) {
  const client = new Client({ name: 'browser-test', version: '1.0.0' })
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], cwd: tmpdir(), env: environment(directory), stderr: 'pipe' })
  let stderr = ''
  transport.stderr?.on('data', (chunk) => { stderr += chunk })
  try { await client.connect(transport) }
  catch (error) { await client.close(); throw new Error(`${error}\n${stderr}`) }
  return client
}
async function call<T>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }))
  expect(result.isError, JSON.stringify(result)).not.toBe(true)
  const content = result.content[0]
  if (content.type !== 'text') throw new Error('Expected JSON text')
  return JSON.parse(content.text) as T
}

test('MCP starts its own server and drawings render live in the browser, sync both ways, and survive restart', async ({ browser, page }) => {
  const directory = mkdtempSync(join(tmpdir(), 'tldraw-mcp-browser-'))
  let client = await start(directory)
  const outsider = await browser.newContext()
  try {
    const created = await call<{ board: { id: string }; browserUrl: string }>(client, 'create_board', { name: 'Watch MCP draw' })
    const boardId = created.board.id
    const origin = new URL(created.browserUrl).origin
    await page.goto(created.browserUrl)
    await expect(page.getByLabel('Current page')).toBeVisible()
    expect(page.url()).not.toContain('#invite=')
    await expect(page.locator('.tl-shape')).toHaveCount(0)
    const drawn = await call<{ shapeIds: string[] }>(client, 'create_shapes', { boardId, shapes: [
      { kind: 'rectangle', x: 50, y: 100, width: 200, height: 100, text: 'Drawn by MCP', color: 'blue' },
      { kind: 'ellipse', x: 400, y: 100, width: 200, height: 100, text: 'Local SQLite' },
      { kind: 'arrow', x: 250, y: 150, width: 150, height: 0 },
    ] })
    await expect(page.locator('.tl-shape')).toHaveCount(3)
    await page.getByRole('button', { name: 'Fit drawing', exact: true }).click()
    await expect(page.getByText('Drawn by MCP', { exact: true })).toBeVisible()
    await call(client, 'update_shapes', { boardId, shapes: [{ id: drawn.shapeIds[0], text: 'Updated live' }] })
    await expect(page.getByTestId('canvas').getByText('Updated live', { exact: true })).toBeVisible()

    await page.keyboard.press('Escape')
    await page.keyboard.press('r')
    const canvas = await page.locator('.tl-canvas').boundingBox()
    if (!canvas) throw new Error('Missing canvas')
    await page.mouse.move(canvas.x + 500, canvas.y + 400)
    await page.mouse.down()
    await page.mouse.move(canvas.x + 620, canvas.y + 480, { steps: 5 })
    await page.mouse.up()
    await page.keyboard.press('Escape')
    await expect(page.locator('.tl-shape')).toHaveCount(4)
    await expect.poll(async () => (await call<{ total: number }>(client, 'get_board', { boardId })).total).toBe(4)
    await call(client, 'delete_shapes', { boardId, shapeIds: [drawn.shapeIds[1]] })
    await expect(page.locator('.tl-shape')).toHaveCount(3)
    await page.screenshot({ path: 'test-results/mcp-live-board.png' })

    expect((await outsider.request.get(`${origin}/api/boards/${boardId}`)).status()).toBe(404)
    expect((await outsider.request.get(`${origin}/sync/${boardId}?sessionId=outsider`, { headers: { origin } })).status()).toBe(403)
    expect((await outsider.request.get(`${origin}/healthz`, { headers: { host: 'evil.example' } })).status()).toBe(403)
    expect((await outsider.request.post(`${origin}/api/boards`, { headers: { origin: 'https://evil.example' }, data: { name: 'CSRF' } })).status()).toBe(403)
    expect((await outsider.request.get(`${origin}/mcp`)).status()).toBe(404)
    await client.close()
    expect(existsSync(join(directory, '.server-lock'))).toBe(false)
    client = await start(directory)
    const reopened = await call<{ browserUrl: string }>(client, 'open_board', { boardId })
    await page.goto(reopened.browserUrl)
    await expect(page.locator('.tl-shape')).toHaveCount(3)
    await expect(page.getByTestId('canvas').getByText('Updated live', { exact: true })).toBeVisible()
  } finally {
    await page.goto('about:blank')
    await client.close(); await outsider.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('stdio stays JSON-only and EOF shuts down the HTTP listener and releases the data lock without a signal', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tldraw-mcp-eof-'))
  const child = spawn(process.execPath, [entry], { cwd: tmpdir(), env: environment(directory), stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  const initialized = new Promise<void>((resolve, reject) => {
    let buffer = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk; buffer += chunk
      const lines = buffer.split('\n'); buffer = lines.pop()!
      for (const line of lines) {
        try { if (JSON.parse(line).id === 1) resolve() }
        catch (error) { reject(error) }
      }
    })
    child.once('exit', () => reject(new Error(`Server exited before initialize: ${stderr}`)))
  })
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000)
  try {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'eof-test', version: '1.0.0' },
    } }) + '\n')
    await initialized
    child.stdin.end()
    expect(await exited, stderr).toEqual({ code: 0, signal: null })
    for (const line of stdout.trim().split('\n')) expect(JSON.parse(line).jsonrpc).toBe('2.0')
    expect(stderr).not.toMatch(/Error|Failed to prune/)
    expect(existsSync(join(directory, '.server-lock'))).toBe(false)
    const match = stderr.match(/Local tldraw editor: (http:\/\/localhost:\d+)/)
    expect(match).not.toBeNull()
    await expect(fetch(`${match![1]}/healthz`)).rejects.toThrow()
  } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill('SIGKILL'); rmSync(directory, { recursive: true, force: true }) }
})

test('early EOF and bind failures clean up; a competing process cannot steal an active data directory', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tldraw-mcp-startup-'))
  const listener = createServer()
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve))
  try {
    const address = listener.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
    const failed = spawnSync(process.execPath, [entry], {
      env: { ...environment(directory), PORT: String(address.port) }, input: '', encoding: 'utf8', timeout: 5000,
    })
    expect(failed.status, failed.stderr).toBe(1)
    expect(failed.stderr).toContain('EADDRINUSE')
    expect(existsSync(join(directory, '.server-lock'))).toBe(false)
    const eof = spawnSync(process.execPath, [entry], { env: environment(directory), input: '', encoding: 'utf8', timeout: 5000 })
    expect(eof.status, eof.stderr).toBe(0)
    expect(existsSync(join(directory, '.server-lock'))).toBe(false)
    const client = await start(directory)
    try {
      const competing = spawnSync(process.execPath, [entry], { env: environment(directory), input: '', encoding: 'utf8', timeout: 5000 })
      expect(competing.status, competing.stderr).toBe(1)
      expect(competing.stderr).toContain('Data directory is locked')
      expect(existsSync(join(directory, '.server-lock'))).toBe(true)
      expect((await client.listTools()).tools).toHaveLength(7)
    } finally { await client.close() }
    expect(existsSync(join(directory, '.server-lock'))).toBe(false)
  } finally {
    await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})
