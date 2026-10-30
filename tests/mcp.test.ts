import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { createTLSchema, type TLShape, type TLShapeId } from '@tldraw/tlschema'
import { createApp } from '../src/server/app.js'
import { createMcpServer } from '../src/server/mcp-tools.js'

const origin = 'http://localhost:8080'
async function fixture(directory: string) {
  const app = await createApp({ dataDirectory: directory, allowedOrigins: [origin], mcpMode: 'stdio' })
  const server = createMcpServer(app.boardServices, origin)
  const client = new Client({ name: 'test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return { app, client, async close() { await client.close(); await server.close(); await app.close() } }
}
async function call<T>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }))
  assert.ok(!response.isError, JSON.stringify(response))
  const content = response.content[0]
  assert.equal(content.type, 'text')
  if (content.type !== 'text') throw new Error('Expected text')
  return JSON.parse(content.text) as T
}
async function fails(client: Client, name: string, args: Record<string, unknown>) {
  const response = await client.callTool({ name, arguments: args })
  assert.equal(response.isError, true, JSON.stringify(response))
}
type Created = { board: { id: string; name: string }; pages: { id: string }[]; browserUrl: string }
type Board = { shapes: TLShape[]; total: number }

test('MCP negotiates tools, scopes boards, and issues browser editor links without exposing owner credentials', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tldraw-mcp-access-'))
  const f = await fixture(directory)
  try {
    assert.equal((await f.client.listTools()).tools.length, 7)
    assert.deepEqual((await f.app.inject('/healthz')).json(), { status: 'ok', mcp: 'stdio' })
    assert.equal((await f.app.inject('/mcp')).statusCode, 404)
    const ordinary = f.app.boardServices.access.createBoard(f.app.boardServices.access.createSession().id, 'Private browser board')
    const created = await call<Created>(f.client, 'create_board', { name: '  Watch me draw  ' })
    assert.equal(created.board.name, 'Watch me draw')
    assert.equal(created.pages.length, 1)
    assert.deepEqual(await call(f.client, 'list_boards'), { boards: [created.board] })
    for (const name of ['get_board', 'open_board', 'create_shapes', 'update_shapes', 'delete_shapes']) {
      const args: Record<string, unknown> = { boardId: ordinary.board.id, shapes: [{ kind: 'rectangle', x: 0, y: 0 }], shapeIds: ['shape:absent'] }
      if (name === 'update_shapes') args.shapes = [{ id: 'shape:absent' }]
      await fails(f.client, name, args)
    }
    const denied = await f.app.inject(`/api/boards/${created.board.id}`)
    assert.equal(denied.statusCode, 404)
    const secret = new URLSearchParams(new URL(created.browserUrl).hash.slice(1)).get('invite')!
    const redeemed = await f.app.inject({ method: 'POST', url: '/api/invitations/redeem', headers: { origin }, payload: { token: secret } })
    assert.equal(redeemed.statusCode, 200)
    assert.equal(redeemed.json().board.role, 'editor')
    const cookie = String(redeemed.headers['set-cookie']).split(';')[0]
    assert.equal((await f.app.inject({ url: `/api/boards/${created.board.id}`, headers: { cookie } })).statusCode, 200)
    assert.equal((await f.app.inject({ method: 'POST', url: `/api/boards/${created.board.id}/invitations`, headers: { cookie, origin }, payload: { role: 'editor', hours: 1 } })).statusCode, 403)
    const reopened = await call<{ browserUrl: string }>(f.client, 'open_board', { boardId: created.board.id })
    assert.notEqual(reopened.browserUrl, created.browserUrl)
    await fails(f.client, 'create_board', { name: '   ' })
  } finally { await f.close(); rmSync(directory, { recursive: true, force: true }) }
})

test('headless drawing validates records, atomically rolls back failures, patches and deletes shapes, and persists across restarts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tldraw-mcp-drawing-'))
  let f = await fixture(directory)
  try {
    const created = await call<Created>(f.client, 'create_board', { name: 'Local drawing' })
    const boardId = created.board.id
    const shapes = [
      { kind: 'rectangle', x: 0, y: 0, text: 'Start' },
      { kind: 'ellipse', x: 400, y: 0, color: 'blue' },
      { kind: 'diamond', x: 700, y: 0 },
      { kind: 'text', x: 0, y: -100, text: 'Local MCP' },
      { kind: 'arrow', x: 200, y: 50, width: 200, height: 0 },
    ]
    const drawn = await call<{ shapeIds: TLShapeId[] }>(f.client, 'create_shapes', { boardId, shapes })
    const board = await call<Board>(f.client, 'get_board', { boardId })
    assert.equal(board.total, 5)
    const schema = createTLSchema()
    for (const shape of board.shapes) schema.types.shape.validate(shape)
    const paginated = await call<Board>(f.client, 'get_board', { boardId, limit: 2, offset: 2 })
    assert.equal(paginated.total, 5); assert.equal(paginated.shapes.length, 2)
    await fails(f.client, 'create_shapes', { boardId, shapes: [{ kind: 'rectangle', x: 0, y: 0 }, { kind: 'rectangle', x: 0, y: 0, width: -1 }] })
    await fails(f.client, 'create_shapes', { boardId, shapes: [{ kind: 'text', x: 0, y: 0, text: 'x'.repeat(2001) }] })
    await fails(f.client, 'create_shapes', { boardId, shapes: [{ kind: 'rectangle', x: 100001, y: 0 }] })
    await fails(f.client, 'create_shapes', { boardId, pageId: 'page:absent', shapes: [shapes[0]] })
    await fails(f.client, 'create_shapes', { boardId, shapes: Array.from({ length: 101 }, () => shapes[0]) })
    assert.equal((await call<Board>(f.client, 'get_board', { boardId })).total, 5)

    await fails(f.client, 'update_shapes', { boardId, shapes: [{ id: drawn.shapeIds[0], x: 900 }, { id: 'shape:absent', x: 0 }] })
    assert.equal((await call<Board>(f.client, 'get_board', { boardId })).shapes.find((s) => s.id === drawn.shapeIds[0])!.x, 0)
    await call(f.client, 'update_shapes', { boardId, shapes: [
      { id: drawn.shapeIds[0], x: 100, width: 240, text: 'Updated', color: 'red' },
      { id: drawn.shapeIds[3], width: 300, text: 'New label', color: 'blue' },
      { id: drawn.shapeIds[4], width: -200, height: 50, text: 'Flow', color: 'green' },
    ] })
    // Transform-only patches must preserve the shared label/color policy for every supported type.
    await call(f.client, 'update_shapes', { boardId, shapes: [0, 3, 4].map((index) => ({ id: drawn.shapeIds[index], rotation: 0.2 })) })
    const patched = await call<Board>(f.client, 'get_board', { boardId })
    for (const [id, color, label] of [
      [drawn.shapeIds[0], 'red', 'Updated'], [drawn.shapeIds[3], 'blue', 'New label'], [drawn.shapeIds[4], 'green', 'Flow'],
    ]) {
      const shape = patched.shapes.find((entry) => entry.id === id)
      assert.ok(shape && (shape.type === 'geo' || shape.type === 'text' || shape.type === 'arrow'))
      assert.equal(shape.props.color, color)
      assert.ok(JSON.stringify(shape.props.richText).includes(label))
    }
    await fails(f.client, 'update_shapes', { boardId, shapes: [{ id: drawn.shapeIds[3], height: 10 }] })
    await fails(f.client, 'delete_shapes', { boardId, shapeIds: [drawn.shapeIds[0], 'shape:absent'] })
    assert.equal((await call<Board>(f.client, 'get_board', { boardId })).total, 5)
    await call(f.client, 'delete_shapes', { boardId, shapeIds: [drawn.shapeIds[1], drawn.shapeIds[1]] })
    await f.close()
    f = await fixture(directory)
    assert.deepEqual(await call(f.client, 'list_boards'), { boards: [created.board] })
    const restored = await call<Board>(f.client, 'get_board', { boardId })
    assert.equal(restored.total, 4)
    const rect = restored.shapes.find((s) => s.id === drawn.shapeIds[0])!
    assert.equal(rect.x, 100)
    assert.match(JSON.stringify(rect), /Updated/)
    for (const shape of restored.shapes) schema.types.shape.validate(shape)
  } finally { await f.close(); rmSync(directory, { recursive: true, force: true }) }
})

test('MCP rejects locked shapes, child shapes, and bound shapes rather than bypassing editor invariants', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tldraw-mcp-invariants-'))
  const f = await fixture(directory)
  try {
    const { board, pages } = await call<Created>(f.client, 'create_board', { name: 'Invariants' })
    const { shapeIds } = await call<{ shapeIds: TLShapeId[] }>(f.client, 'create_shapes', { boardId: board.id, shapes: [
      { kind: 'rectangle', x: 0, y: 0 }, { kind: 'arrow', x: 0, y: 0 },
    ] })
    await f.app.boardServices.rooms.withRoom(board.id, (room) => room.storage.transaction((tx) => {
      const shape = tx.get(shapeIds[0])! as TLShape
      tx.set(shape.id, { ...shape, isLocked: true })
    }))
    await fails(f.client, 'update_shapes', { boardId: board.id, shapes: [{ id: shapeIds[0], x: 5 }] })
    await fails(f.client, 'delete_shapes', { boardId: board.id, shapeIds: [shapeIds[0]] })
    await f.app.boardServices.rooms.withRoom(board.id, (room) => room.storage.transaction((tx) => {
      const shape = tx.get(shapeIds[0])! as TLShape
      tx.set(shape.id, { ...shape, isLocked: false })
      const binding = createTLSchema().types.binding.create({
        id: createTLSchema().types.binding.createId('test'), type: 'arrow', fromId: shapeIds[1], toId: shapeIds[0],
        props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: true, snap: 'edge' },
      })
      tx.set(binding.id, binding)
    }))
    for (const id of shapeIds) {
      await fails(f.client, 'update_shapes', { boardId: board.id, shapes: [{ id, x: 5 }] })
      await fails(f.client, 'delete_shapes', { boardId: board.id, shapeIds: [id] })
    }
    await f.app.boardServices.rooms.withRoom(board.id, (room) => room.storage.transaction((tx) => {
      tx.delete('binding:test')
      const shape = tx.get(shapeIds[1])! as TLShape
      tx.set(shape.id, { ...shape, parentId: shapeIds[0] })
    }))
    for (const id of shapeIds) await fails(f.client, 'delete_shapes', { boardId: board.id, shapeIds: [id] })
    assert.equal((await call<Board>(f.client, 'get_board', { boardId: board.id, pageId: pages[0].id })).total, 2)
    await fails(f.client, 'get_board', { boardId: board.id, pageId: 'page:absent' })
  } finally { await f.close(); rmSync(directory, { recursive: true, force: true }) }
})
