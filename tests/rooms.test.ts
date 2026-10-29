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
    assert.throws(() => registry.get('../demo'), /Invalid room ID/)
    assert.ok(readdirSync(join(directory, 'v1')).includes(roomDatabaseFilename('demo')))
    registry.close()
    reopened = createRoomRegistry(directory)
    assert.ok(reopened.get('demo'))
  } finally {
    registry.close()
    reopened?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
