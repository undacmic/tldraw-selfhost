import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import fastify from 'fastify'
import websocket from '@fastify/websocket'
import staticFiles from '@fastify/static'
import { createRoomRegistry } from './rooms.js'
import { isValidRoomId } from '../shared/room-id.js'
import { createAccessStore } from './access.js'
import { readSession, registerBoardRoutes } from './board-routes.js'

declare module 'fastify' {
  interface FastifyInstance {
    boardServices: { rooms: ReturnType<typeof createRoomRegistry>; access: ReturnType<typeof createAccessStore> }
  }
}

export interface AppOptions {
  dataDirectory: string
  allowedOrigins: string[]
  webDirectory?: string
  secureCookies?: boolean
  logger?: boolean
  mcpMode?: 'stdio'
  allowedHosts?: string[]
}

export async function createApp(options: AppOptions) {
  const app = fastify({ logger: options.logger ?? false, bodyLimit: 8192 })
  const rooms = createRoomRegistry(options.dataDirectory)
  let access: ReturnType<typeof createAccessStore>
  try { access = createAccessStore(options.dataDirectory) }
  catch (error) { rooms.close(); throw error }
  app.addHook('onClose', async () => { rooms.close(); access.close() })
  const allowedOrigins = options.allowedOrigins

  app.addHook('onRequest', async (request, reply) => {
    if (options.allowedHosts && !options.allowedHosts.includes(request.headers.host ?? '')) {
      return reply.code(403).send({ error: 'Host not allowed' })
    }
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('X-Content-Type-Options', 'nosniff')
    if (request.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store')
      if (request.method !== 'GET' && !allowedOrigins.includes(request.headers.origin ?? '')) {
        return reply.code(403).send({ error: 'Origin not allowed' })
      }
    }
  })
  try { await app.register(websocket, { options: { maxPayload: 1024 * 1024 } }) }
  catch (error) { await app.close(); throw error }
  app.get('/healthz', async () => ({ status: 'ok', mcp: options.mcpMode ?? 'disabled' }))
  registerBoardRoutes(app, access, options.secureCookies ?? false)

  app.get<{ Params: { roomId: string }; Querystring: { sessionId?: string } }>(
    '/sync/:roomId',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        if (!isValidRoomId(request.params.roomId)) {
          return reply.code(400).send({ error: 'Invalid room ID' })
        }
        if (!request.query.sessionId || request.query.sessionId.length > 256) {
          return reply.code(400).send({ error: 'Invalid session ID' })
        }
        if (!allowedOrigins.includes(request.headers.origin ?? '')) {
          return reply.code(403).send({ error: 'Origin not allowed' })
        }
        const visitor = readSession(access, request)
        if (!visitor || !access.getBoard(visitor, request.params.roomId)) {
          return reply.code(403).send({ error: 'A valid board invitation is required' })
        }
      },
    },
    (socket, request) => {
      const visitor = readSession(access, request)!
      const board = access.getBoard(visitor, request.params.roomId)!
      rooms.get(board.id).handleSocketConnect({
        sessionId: request.query.sessionId!,
        socket,
        isReadonly: board.role === 'viewer',
        objectAccess: board.role === 'viewer' ? 'read' : 'write',
      })
      // An expired session must not keep a long-lived connection authorized forever.
      const authorizationCheck = setInterval(() => {
        if (!access.getBoard(visitor, board.id)) socket.close(1008, 'Session expired')
      }, 60_000)
      authorizationCheck.unref()
      socket.on('close', () => clearInterval(authorizationCheck))
    },
  )

  if (options.webDirectory && existsSync(options.webDirectory)) {
    try { await app.register(staticFiles, { root: resolve(options.webDirectory) }) }
    catch (error) { await app.close(); throw error }
  }

  app.decorate('boardServices', { rooms, access })
  return app
}
