import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createApp } from './app.js'
import { createMcpServer } from './mcp-tools.js'

const port = Number(process.env.PORT ?? 0)
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT')
const host = process.env.HOST ?? '127.0.0.1'
if (!['127.0.0.1', 'localhost', '0.0.0.0', '::1'].includes(host)) throw new Error('Unsupported HOST')
const publicOrigin = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN) : undefined
if (publicOrigin && (!['http:', 'https:'].includes(publicOrigin.protocol) || publicOrigin.username || publicOrigin.password
  || publicOrigin.pathname !== '/' || publicOrigin.search || publicOrigin.hash)) {
  throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin without credentials, path, query, or fragment')
}
const webDirectory = fileURLToPath(new URL('../web/', import.meta.url))
if (!existsSync(join(webDirectory, 'index.html'))) throw new Error('Built editor not found. Run npm run build before starting MCP.')
const allowedOrigins: string[] = []
const allowedHosts: string[] = []
const app = await createApp({
  dataDirectory: resolve(process.env.DATA_DIR ?? join(homedir(), '.tldraw-selfhost', 'rooms')),
  allowedOrigins, allowedHosts, webDirectory, mcpMode: 'stdio',
  secureCookies: publicOrigin ? publicOrigin.protocol === 'https:' : false,
  // stdout belongs exclusively to MCP JSON-RPC.
  logger: false,
})
let mcp: ReturnType<typeof createMcpServer> | undefined
let stopping = false
let ready = false
let stopRequested = false
async function shutdown() {
  if (stopping) return
  stopping = true
  try { await mcp?.close() }
  finally { await app.close(); process.stdin.pause() }
}
function stop() {
  stopRequested = true
  if (ready) void shutdown().catch((error) => { console.error(error); process.exitCode = 1 })
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, stop)
process.stdin.once('end', stop)
process.stdin.once('error', stop)
process.stdout.once('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EPIPE') { console.error(error); process.exitCode = 1 }
  stop()
})

try {
  await app.listen({ port, host })
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a TCP listener')
  const origin = publicOrigin?.origin ?? `http://localhost:${address.port}`
  allowedOrigins.push(origin, `http://127.0.0.1:${address.port}`, `http://localhost:${address.port}`, `http://[::1]:${address.port}`)
  allowedHosts.push(...allowedOrigins.map((value) => new URL(value).host))
  if (!stopRequested && !process.stdin.readableEnded) {
    mcp = createMcpServer(app.boardServices, origin)
    mcp.server.onclose = stop
    await mcp.connect(new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 1024 * 1024 }))
  }
  ready = true
  // EOF or a signal may arrive while the listener/transport is starting.
  if (stopRequested || process.stdin.readableEnded) await shutdown()
  else console.error(`Local tldraw editor: ${origin} (MCP over stdio; open a tool's browserUrl to watch live)`)
} catch (error) {
  await shutdown()
  throw error
}
