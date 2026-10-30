# Architecture and decisions

## Goal

Own the editor and drawing data on one host, optionally in Docker. Support separate boards, each with multiple shared tldraw pages. Let invited editors/viewers join without accounts. Let a local stdio MCP client start the server, draw on persistent boards, and share the same authoritative state with a live browser editor—without Cloudflare Durable Objects.

## Current topology

```text
MCP client -> stdio -> typed drawing tools --+
                                            |
Browser -> same-origin HTTP/WebSocket -> one Node/Fastify process
                                        |- React board home + tldraw editor
                                        |- /api/boards + invitation redemption
                                        |- /sync/:roomId (authorized upgrade)
                                        |- board/session/invitation/MCP-scope SQLite metadata
                                        `- shared room registry -> document SQLite databases
```

The backend owns exactly one `TLSocketRoom` per active document. Rooms close only when no browser sessions or headless operation leases remain. An in-memory map coordinates ownership within this process; SQLite is not leader election. An atomic `DATA_DIR/.server-lock` directory rejects competing room registries before migration/opening documents. Clean shutdown releases it; crash recovery requires an administrator to verify no process is using the data before removing the lock. Do not infer staleness from a PID or automatically break locks. Run one backend replica, with no overlapping deployments.

The local app serves frontend and backend from Fastify; Vite proxies API/sync traffic in development. A public HTTPS gateway and operational hardening remain future work. Docker is non-root and loopback-only by default.

## Boards and pages

Boards have random UUIDs, names, and browser-session grants. Each board maps to a single sync room. tldraw pages are records inside that room, so participants share content but choose their current page independently. Invitations apply to the entire board, not one page. The UI offers a board home, an owner invitation panel, and page selection/creation alongside the normal tldraw controls.

## Invitation/access model

- Sessions and invitation secrets use 32 random bytes, base64url-encoded. Only SHA-256 hashes are stored in metadata.
- Anonymous browser sessions use a host cookie with HttpOnly, SameSite=Strict, Path=/, a 30-day lifetime and optional Secure for HTTPS deployments. No secret appears in sync URLs.
- Invitation links put secrets in a URL fragment, not the query/path. The frontend removes the fragment immediately, redeems it with a same-origin JSON POST, and navigates to the ordinary board URL. API responses are not cached and responses use `Referrer-Policy: no-referrer`.
- Only owners can issue viewer/editor links, with a 1-hour, 24-hour or 7-day redemption window. Links are reusable. Expiration blocks new redemption, not existing grants. Redemption never downgrades a stronger existing role.
- Creation returns a private owner recovery link valid for one year. It can restore ownership in a fresh session; the UI tells owners to save it separately. It must not be given to guests.
- HTTP reads check session/board access; state-changing API calls also require an allowed Origin. WebSocket upgrades require both an allowed Origin and a valid board grant. Room IDs alone never authorize access.
- Viewer sockets use the SDK's `isReadonly: true` and object-lane `read` access. This is enforced by the sync backend, not just hidden UI buttons. A browser test bypasses the viewer UI and verifies that a forged document write is discarded.
- Socket authorization is rechecked every minute so session expiry cannot leave a connection authorized indefinitely. Owner/editor/viewer membership currently lasts until browser-session expiry. There is no invitation/grant revocation, participant administration or account identity yet.
- Anyone able to reach the instance can create their own isolated boards. The app is not yet a production multi-tenant service: per-IP rate limiting, overall disk quotas and comprehensive abuse controls are still required before public exposure.

## Storage and upgrade behavior

Browser and server share the room-ID validator. Case-sensitive IDs map to lowercase hexadecimal UTF-8 filenames under `DATA_DIR/v1`; `demo` and `Demo` cannot collide on a case-insensitive filesystem.

Startup migrates legacy `DATA_DIR/<roomId>.sqlite` files after checkpointing WAL data and refuses to overwrite an existing destination. Stop old processes and back up first. Legacy IDs come from actual directory entries; distinctions already lost in an old case-insensitive deployment cannot be reconstructed.

`DATA_DIR/.access/boards.sqlite` stores sessions, boards, grants and invitation hashes. Back up the entire data directory consistently. Old pre-invitation drawing files are not automatically claimed by HTTP visitors. A filesystem-only administrator recovery command can register an existing database and issue a private owner link. No public route exposes that operation.

Uploaded blobs are not implemented: reject uploads visibly instead of using non-shared browser-local URLs. Future assets must have board authorization, content/size limits and coordinated backup/restore. Bookmark URL fetching remains disabled until SSRF protections exist.

## Typography and static assets

Inter Variable from Fontsource supplies UI typography, matching the Inter family and editor styling in [dotcom's global stylesheet](https://github.com/tldraw/tldraw/blob/main/apps/dotcom/client/styles/globals.css) and [dotcom's UI stylesheet](https://github.com/tldraw/tldraw/blob/main/apps/dotcom/client/src/tla/styles/tla.css). Canvas font selections remain unchanged.

`@tldraw/assets` is pinned to the SDK version. Its Vite imports bundle local drawing fonts, icons, translations and embed icons. Browser tests block external HTTP and verify loaded Inter plus all four canvas font families. This does not make external board embeds available offline.

## Local stdio MCP and live browser rendering

`src/server/mcp.ts` starts both the MCP stdio transport and the local Fastify HTTP/WebSocket server. The compiled entry locates `dist/web` relative to itself, independent of the client's working directory. It defaults to an ephemeral loopback port and `~/.tldraw-selfhost/rooms`; environment settings can select a fixed port/data directory or an explicit `PUBLIC_ORIGIN` for Docker port forwarding. stdout belongs exclusively to JSON-RPC; diagnostics use stderr. EOF, MCP closure and termination signals shut down both transports and release storage ownership. This is a standalone tool set, not a compatibility claim for the official public tldraw MCP app. There is no HTTP `/mcp` endpoint or cloud coordination.

The local process-spawned stdio connection is the MCP authority. The access database explicitly marks MCP-owned boards in `mcp_boards`, independently of expiring browser sessions. MCP tools cannot enumerate, read or mutate unrelated browser boards, even if given their IDs. All stdio clients launched against this directory would share that authority, so run one client/server per data directory and use separate directories for isolation. No unrestricted HTTP recovery/MCP endpoint, shared browser cookie, or arbitrary JavaScript executor is exposed.

`create_board` and `open_board` return a board-scoped editor invitation in a URL fragment, redeemable for one hour through the existing invitation flow. No owner credentials are returned. The editor link is a bearer credential; browser sessions retain access for up to 30 days after redemption. MCP-created boards are managed through MCP; their browser editor sessions cannot issue owner-only invitations. The local HTTP server checks configured Host values as well as browser Origin/session/board grants.

Drawing tools use the same registry as browser sockets and synchronous storage transactions, not parallel room instances or another document database. Inputs are bounded and typed; generated/updated records are validated against the pinned tldraw schema. A batch either commits completely or rolls back. Storage notifications broadcast changes to browser participants; browser edits are readable through MCP. Headless leases protect rooms throughout operations, including when the last browser disconnects. Deferred SQLite tombstone pruning is cancelled before closing its database (a pinned sync-core internal API currently has no public disposal equivalent).

The initial tools create/read boards and create/update/delete basic geometry, fixed-width text and unbound arrows without an open browser. Updates/deletes reject locked/nested shapes, unsupported types, and shapes with bindings or children: these require Editor semantics and must not be approximated by unsafe raw record writes. The ordinary browser editor renders the shared state and offers **Fit drawing**, without remotely forcing participants' cameras.

Image previews/exports, asset-backed shapes, richer layout/binding operations and embedded MCP Apps widgets remain future work. If adding a browser executor for Editor-only operations, explicitly select one, correlate acknowledgements and fail clearly when unavailable; never broadcast imperative mutations to every tab.

## Validation and remaining work

Automated baseline coverage includes validation, registry lifecycle, case-distinct isolation/reopening, legacy WAL migration/conflict refusal, invitation expiry, role preservation, authorization checks, and metadata reopening. Multi-context browser tests cover invitation flow, live drawing convergence, independent shared-page navigation, viewer server restrictions, direct forged-write rejection, and uninvited/invalid-link denial.

MCP coverage includes protocol negotiation/tool discovery, scoped authorization, browser invitation redemption, shape schema validation, transactional rollback, headless lease cleanup, unsupported-operation rejection, persistence/reopening, compiled stdio startup from another working directory, JSON-only stdout, graceful EOF shutdown, bind-failure cleanup and competing-process rejection. Chromium verifies that MCP mutations render live, browser edits are readable through MCP, and drawings persist across full process restarts.

Still required: document crash recovery, complete backup/restore, asset durability, invitation revocation, session administration, resource quotas, production HTTPS/rate limits/security review, broader real-client interoperability and MCP rendering/export features. Tests are not a claim of production readiness.

## Source basis

- [Official sync documentation](https://tldraw.dev/docs/sync)
- [Node server example](https://github.com/tldraw/tldraw/tree/main/templates/simple-server-example)
- [Official MCP app](https://github.com/tldraw/tldraw/tree/main/apps/mcp-app)
- [SDK licensing](https://tldraw.dev/community/license)
- [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

SDK/sync/assets versions are pinned to 5.6.0, with a lockfile for the dependency graph. Node 24 is major-pinned; release images should also use an immutable digest. Upstream main references are mutable: verify integration APIs against the installed version. No license for this repository's original code has been selected; dependency licenses and production SDK terms still apply.
