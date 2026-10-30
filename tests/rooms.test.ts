import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRoomRegistry } from '../src/server/rooms.js'
import { isValidRoomId } from '../src/shared/room-id.js'
import { roomDatabaseFilename } from '../src/server/storage-paths.js'

test('room IDs are bounded and rejected rather than silently aliased', () => {
  for (const id of ['demo', 'Board_123-a']) assert.equal(isValidRoomId(id), true)
  for (const id of ['', '../demo', 'a/b', 'a.b', 'x'.repeat(65)]) {
    assert.equal(isValidRoomId(id), false)
  }
})

test('a registry owns one room per ID and SQLite can reopen after closing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tldraw-rooms-'))
  const registry = createRoomRegistry(directory)
  let reopened: ReturnType<typeof createRoomRegistry> | undefined
  try {
    const room = registry.get('demo')
    assert.equal(registry.get('demo'), room)
    assert.throws(() => createRoomRegistry(directory), /Data directory is locked/)
    assert.throws(() => registry.get('../demo'), /Invalid room ID/)
    assert.ok(readdirSync(join(directory, 'v1')).includes(roomDatabaseFilename('demo')))
    registry.close()
    assert.throws(() => registry.get('demo'), /registry is closed/)
    reopened = createRoomRegistry(directory)
    assert.ok(reopened.get('demo'))
  } finally {
    registry.close()
    reopened?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('headless leases retain a room through session removal and release it after success or failure', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tldraw-leases-'))
  const registry = createRoomRegistry(directory)
  try {
    let held = registry.get('demo')
    await registry.withRoom('demo', async (room) => {
      held = room
      room.opts.onSessionRemoved?.(room, { sessionId: 'last-browser', numSessionsRemaining: 0, meta: undefined })
      assert.equal(room.isClosed(), false)
      await registry.withRoom('demo', (nested) => assert.equal(nested, room))
      assert.equal(room.isClosed(), false)
      assert.equal(registry.get('demo'), room)
    })
    assert.equal(held.isClosed(), true)
    await assert.rejects(registry.withRoom('demo', (room) => {
      held = room
      throw new Error('Failed operation')
    }), /Failed operation/)
    assert.equal(held.isClosed(), true)
    await registry.withRoom('demo', (room) => assert.notEqual(room, held))
  } finally { registry.close(); rmSync(directory, { recursive: true, force: true }) }
})
