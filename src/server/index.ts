import { resolve } from 'node:path'
import { createApp } from './app.js'

const port = Number(process.env.PORT ?? 5858)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')

const app = await createApp({
  dataDirectory: resolve(process.env.DATA_DIR ?? './.data/rooms'),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080')
    .split(',').map((origin) => new URL(origin.trim()).origin),
  webDirectory: resolve('dist/web'),
  secureCookies: process.env.SESSION_COOKIE_SECURE === 'true',
  logger: true,
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.close().catch((error) => {
      app.log.error(error)
      process.exitCode = 1
    })
  })
}

await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' })
