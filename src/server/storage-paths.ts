import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { isValidRoomId } from '../shared/room-id.js'

/** Lowercase hex is injective even on case-insensitive filesystems. */
export function roomDatabaseFilename(roomId: string): string {
  if (!isValidRoomId(roomId)) throw new Error('Invalid room ID')
  return `${Buffer.from(roomId, 'utf8').toString('hex')}.sqlite`
}

/** Must run with no other process accessing this directory, like the registry itself. */
export function prepareRoomDirectory(directory: string): string {
  // A separate namespace prevents encoded filenames from colliding with legacy room IDs.
  const destination = join(directory, 'v1')
  mkdirSync(destination, { recursive: true })
  const migrations = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sqlite'))
    .map((entry) => {
      const roomId = entry.name.slice(0, -'.sqlite'.length)
      if (!isValidRoomId(roomId)) throw new Error(`Invalid legacy room database: ${entry.name}`)
      return {
        source: join(directory, entry.name),
        target: join(destination, roomDatabaseFilename(roomId)),
      }
    })

  // Never overwrite a board when both layouts exist. Resolve conflicts offline.
  for (const { source, target } of migrations) {
    if (existsSync(target)) throw new Error(`Room migration conflict: ${source} -> ${target}`)
  }
  for (const { source, target } of migrations) {
    const db = new Database(source, { fileMustExist: true, timeout: 0 })
    try {
      // Fold WAL data into the main file before moving it; never rename a live WAL database.
      const [checkpoint] = db.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[]
      if (checkpoint?.busy) throw new Error(`Room database is busy; stop other processes: ${source}`)
    } finally {
      db.close()
    }
    renameSync(source, target)
  }
  return destination
}
