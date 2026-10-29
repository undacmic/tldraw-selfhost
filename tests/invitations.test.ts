import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createApp } from '../src/server/app.js'

const origin = 'http://localhost:8080'

test('board API requires invitation access and owner role, with CSRF and input checks', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tldraw-invitations-'))
  const app = await createApp({ dataDirectory: directory, allowedOrigins: [origin] })
  try {
    const start = await app.inject('/api/boards')
    const cookie = String(start.headers['set-cookie']).split(';')[0]!
    assert.match(String(start.headers['set-cookie']), /HttpOnly; SameSite=Strict/)
    assert.deepEqual(start.json(), { boards: [] })
    const ownerHeaders = { cookie, origin }
    const created = await app.inject({ method: 'POST', url: '/api/boards', headers: ownerHeaders, payload: { name: 'Team' } })
    assert.equal(created.statusCode, 201)
    const { board, recovery } = created.json()
    const boardPath = `/api/boards/${board.id}`
    assert.equal((await app.inject(boardPath)).statusCode, 404)
    assert.equal((await app.inject({ url: boardPath, headers: ownerHeaders })).json().board.role, 'owner')
    assert.equal((await app.inject({ url: `/sync/${board.id}?sessionId=attacker`, headers: { origin } })).statusCode, 403)
    assert.equal((await app.inject({ method: 'POST', url: '/api/boards', headers: { cookie }, payload: { name: 'CSRF' } })).statusCode, 403)

    const inviteResponse = await app.inject({ method: 'POST', url: `${boardPath}/invitations`, headers: ownerHeaders, payload: { role: 'viewer', hours: 1 } })
    assert.equal(inviteResponse.statusCode, 201)
    const token = inviteResponse.json().token
    const guestStart = await app.inject('/api/boards')
    const guestCookie = String(guestStart.headers['set-cookie']).split(';')[0]!
    const guestHeaders = { cookie: guestCookie, origin }
    const joined = await app.inject({ method: 'POST', url: '/api/invitations/redeem', headers: guestHeaders, payload: { token } })
    assert.equal(joined.json().board.role, 'viewer')
    assert.equal(joined.headers['cache-control'], 'no-store')
    assert.equal((await app.inject({ url: '/api/boards', headers: guestHeaders })).json().boards.length, 1)
    assert.equal((await app.inject({ method: 'POST', url: `${boardPath}/invitations`, headers: guestHeaders, payload: { role: 'editor', hours: 24 } })).statusCode, 403)
    assert.equal((await app.inject({ method: 'POST', url: `${boardPath}/invitations`, headers: ownerHeaders, payload: { role: 'owner', hours: 24 } })).statusCode, 400)
    assert.equal((await app.inject({ method: 'POST', url: '/api/invitations/redeem', headers: guestHeaders, payload: { token: 'x'.repeat(43) } })).statusCode, 410)
    assert.ok(recovery.token)
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
