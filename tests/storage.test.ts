import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { createRoomRegistry } from '../src/server/rooms.js'
import { prepareRoomDirectory, roomDatabaseFilename } from '../src/server/storage-paths.js'

test('case-distinct IDs have filenames distinct even on case-insensitive filesystems', () => {
  assert.notEqual(roomDatabaseFilename('demo').toLowerCase(), roomDatabaseFilename('Demo').toLowerCase())
  for (const id of ['demo', 'Demo', 'A_-0', 'x'.repeat(64)]) {
    assert.match(roomDatabaseFilename(id), /^[0-9a-f]+\.sqlite$/)
    assert.equal(Buffer.from(roomDatabaseFilename(id).slice(0, -7), 'hex').toString(), id)
  }
  assert.throws(() => roomDatabaseFilename('../bad'), /Invalid room ID/)
})

test('case-distinct rooms isolate writes and retain them after reopening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tldraw-isolation-'))
  let registry = createRoomRegistry(directory)
  try {
    for (const id of ['demo', 'Demo']) {
      const room = registry.get(id)
      room.storage.transaction((tx) => {
        const page = [...tx.values()].find((record) => record.typeName === 'page')
        assert.ok(page)
        const updated = { ...page, name: id }
        tx.set(page.id, updated)
      })
    }
    assert.equal(readdirSync(join(directory, 'v1')).filter((file) => file.endsWith('.sqlite')).length, 2)
    registry.close()
    registry = createRoomRegistry(directory)
    for (const id of ['demo', 'Demo']) {
      const { result: page } = registry.get(id).storage.transaction((tx) =>
        [...tx.values()].find((record) => record.typeName === 'page'),
      )
      assert.equal((page as { name?: string } | undefined)?.name, id)
    }
  } finally {
    registry.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('legacy databases migrate with committed WAL contents preserved', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tldraw-migrate-'))
  const legacyPath = join(directory, 'Demo.sqlite')
  try {
    // Simulate an abrupt process exit, leaving committed data in the WAL.
    const modulePath = createRequire(import.meta.url).resolve('better-sqlite3')
    execFileSync(process.execPath, ['-e', `
      const Database = require(${JSON.stringify(modulePath)});
      const db = new Database(${JSON.stringify(legacyPath)});
      db.pragma('journal_mode = WAL');
      db.exec("CREATE TABLE marker (value TEXT); INSERT INTO marker VALUES ('preserved')");
      process.exit(0);
    `])
    assert.equal(existsSync(`${legacyPath}-wal`), true)
    const destination = prepareRoomDirectory(directory)
    assert.equal(existsSync(legacyPath), false)
    const migrated = new Database(join(destination, roomDatabaseFilename('Demo')), { readonly: true })
    try {
      assert.deepEqual(migrated.prepare('SELECT value FROM marker').get(), { value: 'preserved' })
    } finally {
      migrated.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('migration refuses conflicts without overwriting either database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tldraw-conflict-'))
  try {
    const destination = prepareRoomDirectory(directory)
    for (const filename of [join(directory, 'demo.sqlite'), join(destination, roomDatabaseFilename('demo'))]) {
      const db = new Database(filename)
      db.exec('CREATE TABLE marker (value TEXT)')
      db.close()
    }
    assert.throws(() => prepareRoomDirectory(directory), /migration conflict/)
    assert.equal(existsSync(join(directory, 'demo.sqlite')), true)
    assert.equal(existsSync(join(destination, roomDatabaseFilename('demo'))), true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
