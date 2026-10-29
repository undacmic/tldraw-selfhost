import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AccessStore } from './access.js'
import { SESSION_SECONDS } from './access.js'

const COOKIE = 'tldraw_session'

export function readSession(access: AccessStore, request: FastifyRequest) {
  const value = request.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
  return access.sessionId(value)
}

export function registerBoardRoutes(app: FastifyInstance, access: AccessStore, secureCookies: boolean) {
  function session(request: FastifyRequest, reply: FastifyReply): string {
    const existing = readSession(access, request)
    if (existing) return existing
    const created = access.createSession()
    reply.header('Set-Cookie', `${COOKIE}=${created.secret}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secureCookies ? '; Secure' : ''}`)
    return created.id
  }

  app.get('/api/boards', async (request, reply) => ({ boards: access.listBoards(session(request, reply)) }))
  app.post<{ Body: { name: string } }>('/api/boards', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['name'], properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
    } } },
  }, async (request, reply) => {
    const name = request.body.name.trim()
    if (!name) return reply.code(400).send({ error: 'A board name is required' })
    const owner = session(request, reply)
    if (access.listBoards(owner).length >= 100) return reply.code(429).send({ error: 'Board limit reached' })
    return reply.code(201).send(access.createBoard(owner, name))
  })

  app.get<{ Params: { boardId: string } }>('/api/boards/:boardId', async (request, reply) => {
    const visitor = readSession(access, request)
    const board = visitor && access.getBoard(visitor, request.params.boardId)
    if (!board) return reply.code(404).send({ error: 'Board not found or invitation required' })
    return { board }
  })

  app.post<{ Params: { boardId: string }; Body: { role: 'editor' | 'viewer'; hours: number } }>(
    '/api/boards/:boardId/invitations', {
      schema: { body: { type: 'object', additionalProperties: false, required: ['role', 'hours'], properties: {
        role: { type: 'string', enum: ['editor', 'viewer'] },
        hours: { type: 'integer', enum: [1, 24, 168] },
      } } },
    }, async (request, reply) => {
      const visitor = readSession(access, request)
      const invite = visitor && access.createInvite(visitor, request.params.boardId, request.body.role, request.body.hours)
      if (!invite) return reply.code(403).send({ error: 'Only the board owner can create invitations' })
      return reply.code(201).send(invite)
    },
  )
  app.post<{ Body: { token: string } }>('/api/invitations/redeem', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['token'], properties: {
      token: { type: 'string', minLength: 43, maxLength: 43 },
    } } },
  }, async (request, reply) => {
    const board = access.redeem(session(request, reply), request.body.token)
    if (!board) return reply.code(410).send({ error: 'This invitation is invalid or has expired' })
    return { board }
  })
}
