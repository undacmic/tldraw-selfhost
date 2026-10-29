import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { isValidRoomId } from '../shared/room-id.js'
import { prepareRoomDirectory, roomDatabaseFilename } from './storage-paths.js'
import { NodeSqliteWrapper, SQLiteSyncStorage, TLSocketRoom } from '@tldraw/sync-core'
import Database from 'better-sqlite3'

/** One registry per process, one process per deployment. Shared SQLite is not leader election. */
export function createRoomRegistry(directory: string) {
  mkdirSync(directory, { recursive: true })
  const roomDirectory = prepareRoomDirectory(directory)
  const rooms = new Map<string, { room: TLSocketRoom; db: Database.Database }>()

  function release(roomId: string) {
    const entry = rooms.get(roomId)
    if (!entry) return
    // Remove first: closing sockets may trigger onSessionRemoved recursively.
    rooms.delete(roomId)
    entry.room.close()
    entry.db.close()
  }

  return {
    get(roomId: string): TLSocketRoom {
      if (!isValidRoomId(roomId)) throw new Error('Invalid room ID')
      const existing = rooms.get(roomId)
      if (existing) return existing.room

      // Synchronous construction prevents two requests from initializing the same room.
      const db = new Database(join(roomDirectory, roomDatabaseFilename(roomId)))
      try {
        db.pragma('journal_mode = WAL')
        const storage = new SQLiteSyncStorage({ sql: new NodeSqliteWrapper(db) })
        const room = new TLSocketRoom({
          storage,
          onSessionRemoved(_room, { numSessionsRemaining }) {
            if (numSessionsRemaining === 0) release(roomId)
          },
        })
        rooms.set(roomId, { room, db })
        return room
      } catch (error) {
        db.close()
        throw error
      }
    },
    close() {
      for (const roomId of [...rooms.keys()]) release(roomId)
    },
  }
}
