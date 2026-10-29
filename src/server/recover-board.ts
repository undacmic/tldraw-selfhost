import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createAccessStore } from './access.js'
import { isValidRoomId } from '../shared/room-id.js'
import { roomDatabaseFilename } from './storage-paths.js'

const [id, name = 'Recovered board'] = process.argv.slice(2)
if (!id || !isValidRoomId(id)) throw new Error('Usage: recover-board <existing-room-id> [board-name]')
const directory = resolve(process.env.DATA_DIR ?? './.data/rooms')
if (!existsSync(join(directory, 'v1', roomDatabaseFilename(id)))) {
  throw new Error('Room database not found. Start the current server once to migrate legacy storage first.')
}
const access = createAccessStore(directory)
try {
  const invite = access.recoverBoard(id, name.slice(0, 100))
  const origin = new URL(process.env.PUBLIC_ORIGIN ?? 'http://localhost:8080').origin
  console.log(`Private owner recovery link (keep secret; expires in one year):\n${origin}/#invite=${invite.token}`)
} finally { access.close() }
