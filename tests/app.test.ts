import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createApp } from '../src/server/app.js'

test('health and WebSocket preflight validation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tldraw-app-'))
  const app = await createApp({ dataDirectory: directory, allowedOrigins: ['http://localhost:8080'] })
  try {
    const health = await app.inject('/healthz')
    assert.equal(health.statusCode, 200)
    assert.deepEqual(health.json(), { status: 'ok', mcp: 'disabled' })

    for (const [url, origin, expected] of [
      ['/sync/bad.room?sessionId=abc', 'http://localhost:8080', 400],
      ['/sync/demo', 'http://localhost:8080', 400],
      ['/sync/demo?sessionId=abc', 'http://untrusted.example', 403],
      ['/sync/demo?sessionId=abc', '', 403],
    ] as const) {
      const response = await app.inject({ url, headers: origin ? { origin } : {} })
      assert.equal(response.statusCode, expected)
    }
    assert.equal((await app.inject('/mcp')).statusCode, 404)
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
