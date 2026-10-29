import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createAccessStore, SESSION_SECONDS } from '../src/server/access.js'

test('invitations scope access, do not downgrade roles, expire, and survive restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tldraw-access-'))
  let time = Date.now()
  let access = createAccessStore(directory, () => time)
  try {
    const owner = access.createSession()
    const guest = access.createSession()
    const outsider = access.createSession()
    const { board, recovery } = access.createBoard(owner.id, 'Team board')
    const other = access.createBoard(owner.id, 'Other board').board
    assert.equal(access.getBoard(guest.id, board.id), undefined)
    assert.equal(access.createInvite(guest.id, board.id, 'editor', 1), undefined)
    const editor = access.createInvite(owner.id, board.id, 'editor', 1)!
    const viewer = access.createInvite(owner.id, board.id, 'viewer', 1)!
    assert.equal(access.redeem(guest.id, editor.token)?.role, 'editor')
    assert.equal(access.redeem(guest.id, viewer.token)?.role, 'editor')
    assert.equal(access.getBoard(guest.id, other.id), undefined)
    assert.equal(access.redeem(outsider.id, 'x'.repeat(43)), undefined)
    assert.equal(access.redeem(owner.id, viewer.token)?.role, 'owner')
    time += 60 * 60 * 1000 + 1
    assert.equal(access.redeem(outsider.id, editor.token), undefined)
    // Link expiry limits joining, not previously granted access.
    assert.equal(access.getBoard(guest.id, board.id)?.role, 'editor')
    access.close()
    access = createAccessStore(directory, () => time)
    assert.equal(access.sessionId(owner.secret), owner.id)
    assert.equal(access.getBoard(guest.id, board.id)?.role, 'editor')
    assert.equal(access.redeem(outsider.id, recovery.token)?.role, 'owner')
    time += SESSION_SECONDS * 1000
    assert.equal(access.sessionId(guest.secret), undefined)
    assert.equal(access.getBoard(guest.id, board.id), undefined)
    const restored = access.createSession()
    assert.equal(access.redeem(restored.id, recovery.token)?.role, 'owner')
  } finally {
    access.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
