# tldraw self-hosted

A Docker-first, self-hosted collaborative tldraw app with separate boards, multiple pages per board, and account-free invitation links. MCP integration is planned against the same authoritative board state.

**Status: local development application, not production-ready.** Board/session access controls are implemented, but there is no MCP endpoint, asset upload service, invitation revocation, or production TLS/rate-limit deployment yet. Do not publish the container directly to the internet.

## Requirements

- Node.js 24 and npm, or Docker with Compose.
- A suitable tldraw license for production: <https://tldraw.dev/community/license>. Self-hosting does not waive SDK licensing.

## Run with Docker

```sh
cp .env.example .env
docker compose up --build
```

Open <http://localhost:8080/>. The runtime uses non-root `node` (UID/GID 1000). Compose publishes only on host loopback. `ALLOWED_ORIGINS` must match the exact browser origin.

## Boards, pages, and invitations

1. On **Your boards**, enter a name and select **Create board**.
2. **Save the private owner recovery link** shown on creation. It grants full ownership, expires in one year, and is displayed only once. Do not share it with guests.
3. Select **Invite**, choose **Editor** or **Viewer**, choose a link lifetime (1 hour, 24 hours, or 7 days), and copy the generated link.
4. Guests open that link in their own browser. No account or password is required. The secret is exchanged for an HttpOnly browser session and removed from the address bar.
5. Use the **Page** selector and **New page** button inside the editor. Participants can edit the same page together or work on different pages independently. Invitations grant access to the **whole board**, not a single page. Viewers can switch pages but cannot modify the document or create invitations.
6. **Boards** returns to boards accessible in the current browser. A plain board URL does not grant access to a new browser.

Links are reusable bearer credentials: anyone holding an unexpired link can join. **Link expiry prevents new joins; it does not remove existing access.** Guest and owner browser sessions last up to 30 days. Clearing cookies or using another browser requires an invitation or owner recovery link. Revocation and a participant-management screen are not implemented. Treat all recovery/invitation links as secrets.

### Joining from another device

`localhost` points to each person's own computer, so default links work only on this host. For remote collaboration, deploy behind a reachable **HTTPS reverse proxy** (with WebSocket forwarding), configure the exact HTTPS `ALLOWED_ORIGINS`, set `SESSION_COOKIE_SECURE=true`, and create links from that public origin. Keep the backend private. Production exposure also needs rate limits, resource quotas, operational backups and a security review; this repository does not yet supply that deployment.

## Data and upgrades

The `rooms` volume stores both document databases (`/data/rooms/v1`) and board/session/invitation metadata (`/data/rooms/.access`). Back up **the entire volume**, not only the drawing databases. `docker compose down` preserves it; **`docker compose down -v` deletes all boards and access metadata**.

Room IDs are case-sensitive even on case-insensitive filesystems. Startup migrates older `<roomId>.sqlite` files to encoded filenames after checkpointing WAL data, and refuses conflicting destinations. Stop old processes and back up before upgrading. Never run two room-owning backend processes against the same data.

### Existing pre-invitation boards / owner recovery

Old drawing databases are retained but are not automatically claimable by guessing their room IDs. The host administrator can generate a private recovery link for an existing document:

```sh
# Current server must have started at least once to migrate old storage.
docker compose exec -T app node dist/server/recover-board.js demo "Imported demo"
```

Open the printed link to become an owner. Use `-e PUBLIC_ORIGIN=https://your-board-host.example` with `docker compose exec` if your deployment uses another origin. This is an administrator-only filesystem operation, not a public HTTP endpoint.

For local development, after a build:

```sh
DATA_DIR=./.data/rooms PUBLIC_ORIGIN=http://localhost:5173 \
  node dist/server/recover-board.js demo "Imported demo"
```

## Develop and test

```sh
npm ci
npm run dev
```

Open <http://localhost:5173/>. Vite proxies API and WebSocket traffic to the loopback-only Node backend on port 5858. Local databases live in `.data/rooms` (Git-ignored).

```sh
npm test
npm run build
ALLOWED_ORIGINS=http://localhost:5858 npm start
```

Backend settings: `HOST`, `PORT`, `DATA_DIR`, comma-separated `ALLOWED_ORIGINS`, and `SESSION_COOKIE_SECURE`. The backend does not load dotenv files; supply shell environment variables. Compose separately reads `.env`.

The frontend license key is embedded at build time, is not a secret, and requires a rebuild when changed. Set `VITE_TLDRAW_LICENSE_KEY` via the shell or Vite's `.env.local` for development.

### Fonts and browser tests

The UI uses locally served **Inter**, matching tldraw.com's UI family and 12px/500 editor styling. Canvas text retains official **Shantell Sans**, **IBM Plex Sans**, **IBM Plex Serif**, and **IBM Plex Mono**, with bold/italic variants. Fonts, icons and translations come from version-matched packages rather than requiring the tldraw CDN. Existing shape fonts are not rewritten.

```sh
npx playwright install chromium
npm run test:e2e
# Or use an installed Google Chrome:
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
```

Browser tests cover local fonts without external HTTP, invitation redemption in independent browser contexts, live drawing convergence, independent page selection, persistent page data after reload, read-only server handshakes, rejection of a forged viewer write, and rejection of uninvited access. The test server uses `.data/e2e-rooms`, not the running Compose volume.

## Next milestones

- Persistent assets, upload limits, document crash/restart and complete backup/restore tests.
- Invitation revocation, participant management, session management and quotas.
- Select the exact MCP implementation/client and add a room-scoped adapter.
- Production HTTPS deployment and hardening.

See [architecture](docs/architecture.md). No official MCP compatibility is claimed. Origin validation complements access checks; it is not authentication by itself. Run exactly **one backend replica**, without overlapping rolling deployments.
