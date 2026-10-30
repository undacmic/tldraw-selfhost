import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { isValidRoomId } from '../shared/room-id.js'
import { prepareRoomDirectory, roomDatabaseFilename } from './storage-paths.js'
import { NodeSqliteWrapper, SQLiteSyncStorage, TLSocketRoom } from '@tldraw/sync-core'
import type { TLRecord } from '@tldraw/tlschema'
import Database from 'better-sqlite3'
import { acquireDataLock } from './data-lock.js'

/** One registry per process, one process per deployment. Shared SQLite is not leader election. */
export function createRoomRegistry(directory: string) {
  mkdirSync(directory, { recursive: true })
  const unlock = acquireDataLock(directory)
  let roomDirectory: string
  try { roomDirectory = prepareRoomDirectory(directory) }
  catch (error) { unlock(); throw error }
  const rooms = new Map<string, { room: TLSocketRoom<TLRecord>; storage: SQLiteSyncStorage<TLRecord>; db: Database.Database; leases: number }>()
  let closed = false

  function release(roomId: string, force = false) {
    const entry = rooms.get(roomId)
    if (!entry || (!force && (entry.leases > 0 || entry.room.getNumActiveSessions() > 0))) return
    // Remove first: closing sockets may trigger onSessionRemoved recursively.
    rooms.delete(roomId)
    try { entry.room.close() }
    finally {
      // The pinned sync-core storage has no dispose API; cancel deferred pruning before closing SQLite.
      const pruning = (entry.storage as SQLiteSyncStorage<TLRecord> & { pruneTombstones: { cancel(): void } }).pruneTombstones
      try { pruning.cancel() }
      finally { entry.db.close() }
    }
  }

  return {
    get(roomId: string): TLSocketRoom<TLRecord> {
      if (closed) throw new Error('Room registry is closed')
      if (!isValidRoomId(roomId)) throw new Error('Invalid room ID')
      const existing = rooms.get(roomId)
      if (existing) return existing.room

      // Synchronous construction prevents two requests from initializing the same room.
      const db = new Database(join(roomDirectory, roomDatabaseFilename(roomId)))
      try {
        db.pragma('journal_mode = WAL')
        const storage = new SQLiteSyncStorage<TLRecord>({ sql: new NodeSqliteWrapper(db) })
        const room = new TLSocketRoom<TLRecord>({
          storage,
          onSessionRemoved(_room, { numSessionsRemaining }) {
            if (numSessionsRemaining === 0) release(roomId)
          },
        })
        rooms.set(roomId, { room, storage, db, leases: 0 })
        return room
      } catch (error) {
        db.close()
        throw error
      }
    },
    async withRoom<T>(roomId: string, operation: (room: TLSocketRoom<TLRecord>) => T | Promise<T>): Promise<T> {
      const room = this.get(roomId)
      const entry = rooms.get(roomId)!
      entry.leases++
      try { return await operation(room) }
      finally { entry.leases--; release(roomId) }
    },
    close() {
      if (closed) return
      closed = true
      const errors: unknown[] = []
      for (const roomId of [...rooms.keys()]) {
        try { release(roomId, true) }
        catch (error) { errors.push(error) }
      }
      // Fail closed if resource cleanup failed; do not invite another process to reuse uncertain state.
      if (errors.length) throw new AggregateError(errors, 'Failed to close room registry')
      unlock()
    },
  }
}

export type RoomRegistry = ReturnType<typeof createRoomRegistry>
