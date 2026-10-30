import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type { BoardRole, BoardSummary } from '../shared/boards.js'

export const SESSION_SECONDS = 60 * 60 * 24 * 30
const token = () => randomBytes(32).toString('base64url')
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const validToken = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value)

export function createAccessStore(directory: string, now = Date.now) {
  const metadataDirectory = join(directory, '.access')
  mkdirSync(metadataDirectory, { recursive: true })
  const db = new Database(join(metadataDirectory, 'boards.sqlite'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS grants (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      board_id TEXT NOT NULL REFERENCES boards(id),
      role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
      PRIMARY KEY(session_id, board_id)
    );
    CREATE TABLE IF NOT EXISTS invitations (
      token_hash TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id),
      role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')), expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mcp_boards (
      board_id TEXT PRIMARY KEY REFERENCES boards(id)
    );
  `)

  function sessionId(secret: string | undefined): string | undefined {
    if (!secret || !validToken(secret)) return undefined
    const id = hash(secret)
    return db.prepare('SELECT id FROM sessions WHERE id = ? AND expires_at > ?').get(id, now()) ? id : undefined
  }
  function getBoard(session: string, boardId: string): BoardSummary | undefined {
    return db.prepare(`SELECT b.id, b.name, g.role FROM boards b JOIN grants g ON g.board_id = b.id
      JOIN sessions s ON s.id = g.session_id WHERE g.session_id = ? AND b.id = ? AND s.expires_at > ?`)
      .get(session, boardId, now()) as BoardSummary | undefined
  }
  function issueInvite(boardId: string, role: BoardRole, hours: number) {
    const secret = token()
    const expiresAt = now() + hours * 60 * 60 * 1000
    db.prepare('INSERT INTO invitations VALUES (?, ?, ?, ?)').run(hash(secret), boardId, role, expiresAt)
    return { token: secret, expiresAt }
  }

  return {
    sessionId,
    getBoard,
    createSession() {
      // Prune expired anonymous sessions and links when a new visitor arrives.
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now())
      db.prepare('DELETE FROM invitations WHERE expires_at <= ?').run(now())
      const secret = token()
      db.prepare('INSERT INTO sessions VALUES (?, ?)').run(hash(secret), now() + SESSION_SECONDS * 1000)
      return { secret, id: hash(secret) }
    },
    listBoards(session: string): BoardSummary[] {
      return db.prepare(`SELECT b.id, b.name, g.role FROM boards b JOIN grants g ON g.board_id = b.id
        JOIN sessions s ON s.id = g.session_id WHERE g.session_id = ? AND s.expires_at > ? ORDER BY b.name, b.id`)
        .all(session, now()) as BoardSummary[]
    },
    createBoard(session: string, name: string) {
      const id = randomUUID()
      const create = db.transaction(() => {
        db.prepare('INSERT INTO boards VALUES (?, ?)').run(id, name)
        db.prepare("INSERT INTO grants VALUES (?, ?, 'owner')").run(session, id)
        // A private recovery link lets the owner restore access after losing the browser cookie.
        const recovery = issueInvite(id, 'owner', 24 * 365)
        return { board: { id, name, role: 'owner' as const }, recovery }
      })
      return create()
    },
    createInvite(session: string, boardId: string, role: 'editor' | 'viewer', hours: number) {
      if (getBoard(session, boardId)?.role !== 'owner') return undefined
      return issueInvite(boardId, role, hours)
    },
    redeem(session: string, secret: string): BoardSummary | undefined {
      if (!validToken(secret)) return undefined
      const invite = db.prepare('SELECT board_id, role FROM invitations WHERE token_hash = ? AND expires_at > ?')
        .get(hash(secret), now()) as { board_id: string; role: BoardRole } | undefined
      if (!invite) return undefined
      // A viewer link must not downgrade an editor/owner already in this browser.
      db.prepare(`INSERT INTO grants VALUES (?, ?, ?) ON CONFLICT(session_id, board_id) DO UPDATE SET role =
        CASE WHEN grants.role = 'owner' OR excluded.role = 'owner' THEN 'owner'
             WHEN grants.role = 'editor' OR excluded.role = 'editor' THEN 'editor' ELSE 'viewer' END`)
        .run(session, invite.board_id, invite.role)
      return getBoard(session, invite.board_id)
    },
    // A local stdio client controls only boards explicitly created for this data directory's MCP.
    // This authority is persisted separately from expiring browser sessions and is never exposed over HTTP.
    listMcpBoards(): Pick<BoardSummary, 'id' | 'name'>[] {
      return db.prepare('SELECT b.id, b.name FROM boards b JOIN mcp_boards m ON m.board_id = b.id ORDER BY b.name, b.id')
        .all() as Pick<BoardSummary, 'id' | 'name'>[]
    },
    getMcpBoard(boardId: string): Pick<BoardSummary, 'id' | 'name'> | undefined {
      return db.prepare('SELECT b.id, b.name FROM boards b JOIN mcp_boards m ON m.board_id = b.id WHERE b.id = ?')
        .get(boardId) as Pick<BoardSummary, 'id' | 'name'> | undefined
    },
    createMcpBoard(name: string) {
      const id = randomUUID()
      return db.transaction(() => {
        db.prepare('INSERT INTO boards VALUES (?, ?)').run(id, name)
        db.prepare('INSERT INTO mcp_boards VALUES (?)').run(id)
        return { id, name }
      })()
    },
    createMcpBrowserInvite(boardId: string) {
      if (!this.getMcpBoard(boardId)) throw new Error('MCP board not found')
      return issueInvite(boardId, 'editor', 1)
    },
    recoverBoard(boardId: string, name: string) {
      // Offline/admin CLI only. Never expose this operation through an unauthenticated HTTP route.
      db.prepare('INSERT INTO boards VALUES (?, ?) ON CONFLICT(id) DO NOTHING').run(boardId, name)
      return issueInvite(boardId, 'owner', 24 * 365)
    },
    close() { db.close() },
  }
}

export type AccessStore = ReturnType<typeof createAccessStore>
