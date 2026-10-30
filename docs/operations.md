# Running and maintaining the server

For the shortest Docker + agent setup, start with the [README](../README.md). This guide covers the optional browser-only service and operational details.

**Keep the service private.** TLS, rate limits, resource quotas, invitation revocation, and other public-deployment hardening are not supplied by this project. Origin validation complements access checks; it is not authentication by itself. Run exactly one room-owning server per data directory, with no overlapping deployments.

## Browser-only mode

Use this **instead of** the MCP-owned server if you want a whiteboard without an agent. Pull the image as described in the README, then run:

```sh
docker run -d --name tldraw-web --init \
  -p 127.0.0.1:8080:5858 \
  -e ALLOWED_ORIGINS=http://localhost:8080 \
  -e SESSION_COOKIE_SECURE=false \
  -v tldraw-web-rooms:/data/rooms \
  --security-opt no-new-privileges:true \
  ghcr.io/undacmic/tldraw-selfhost:0.2.0
```

Open <http://localhost:8080/>. Stop/start it with `docker stop tldraw-web` / `docker start tldraw-web`. This mode does not enable MCP. The MCP mode in [client setup](mcp-clients.md) starts its own web server; do not run both on port 8080 or point them at the same data volume.

### Docker Compose

For a source-based browser-only service:

```sh
cp .env.example .env
docker compose up -d --build
```

Compose publishes only on host loopback. The runtime uses non-root `node` (UID/GID 1000), and its `rooms` volume retains data after `docker compose down`. **`docker compose down -v` deletes all boards and access metadata.**

The backend does not load dotenv files; Compose separately reads `.env`. If you change `APP_PORT`, also change `ALLOWED_ORIGINS` to the exact browser origin. See `.env.example` for settings.

## Licensed builds

The tldraw SDK's default terms permit development use; production requires an appropriate license. See the [official licensing terms](https://tldraw.dev/community/license), [license-key guide](https://tldraw.dev/sdk-features/license-key), and [hobby license application](https://tldraw.dev/get-a-license/hobby). Hobby license eligibility/approval is determined by tldraw, and hobby licenses retain the “made with tldraw” watermark. Commercial deployments require appropriate commercial terms.

The editor works without a key on localhost/loopback, including with Docker port forwarding. **That technical behavior is not a grant of production-use rights.** A reverse proxy, TLS certificate, or self-hosting arrangement does not supply a tldraw license.

To include your deployment's license key in the image:

```sh
docker build \
  --build-arg VITE_TLDRAW_LICENSE_KEY=your-license-key \
  -t tldraw-selfhost:local .
```

Use your own `tldraw-selfhost:local` image tag instead of the published GHCR image in your container/MCP configuration. Do not overwrite a published version tag with a custom licensed build.

For Compose, set `VITE_TLDRAW_LICENSE_KEY` in `.env` and run `docker compose up -d --build`.

The key is embedded in the public frontend at **build time** and is not a secret. Changing a running container's environment does not update it. For GitHub Actions builds, set the repository Actions **variable** `VITE_TLDRAW_LICENSE_KEY` before publishing. Publish a new version or use your own image tag when changing keys; never replace an existing versioned release image.

A licensed build is still not a production-hardened deployment. This repository's original code does not yet have a selected license; dependency licenses and tldraw's production terms apply separately.

## Boards, pages, and invitations

For a browser-created board:

1. On **Your boards**, enter a name and select **Create board**.
2. **Save the private owner recovery link** shown on creation. It grants full ownership, expires in one year, and is displayed only once. Do not share it with guests.
3. Select **Invite**, choose **Editor** or **Viewer**, choose a link lifetime (1 hour, 24 hours, or 7 days), and copy the link.
4. Guests open the link in their own browser. No account or password is required. The secret is exchanged for an HttpOnly session and removed from the address bar.
5. Use **Page**, **New page**, and **Fit drawing** inside the editor. Participants may edit together or choose different pages independently. Invitations cover the **whole board**, not one page. Viewers can switch pages but cannot modify the document or create invitations.
6. **Boards** returns to boards accessible in the current browser. A plain board URL does not grant access to a new browser.

Links are reusable bearer credentials. **Expiry prevents new joins; it does not remove existing access.** Browser sessions last up to 30 days. Clearing cookies or using another browser requires a new invitation or owner recovery link. Revocation and participant management are not implemented. Treat all invitation/recovery links as secrets.

MCP-created boards are administered through MCP. Their one-hour browser links grant **editor**, not owner, access; those browser sessions cannot use the owner-only Invite controls. Ask the agent to call `open_board` for a fresh editor invitation. See [MCP client setup](mcp-clients.md).

### Joining from another device

`localhost` means each person's own computer. Default links work only on this host. Remote collaboration requires a reachable **HTTPS reverse proxy** with WebSocket forwarding, exact allowed browser origins, secure cookies, an appropriate tldraw license, and the missing public-deployment hardening. Keep the backend private.

In browser-only mode, set HTTPS `ALLOWED_ORIGINS` and `SESSION_COOKIE_SECURE=true`. In MCP mode, set `PUBLIC_ORIGIN` to the externally visible origin; HTTPS origins enable secure cookies. This is not a recommendation to expose the app publicly in its current state.

## Runtime settings

| Setting | Browser-only server | MCP server |
| --- | --- | --- |
| `HOST` | Native default `127.0.0.1`; Docker `0.0.0.0` | Same; bind Docker's published port on host loopback |
| `PORT` | Native/image default `5858` | Native default `0` (automatic); Docker `5858` |
| `DATA_DIR` | Native `.data/rooms`; Docker `/data/rooms` | Native `~/.tldraw-selfhost/rooms`; Docker `/data/rooms` |
| `ALLOWED_ORIGINS` | Exact, comma-separated browser origins; Compose defaults to `http://localhost:8080` | Not used; origins derive from the listener and `PUBLIC_ORIGIN` |
| `SESSION_COOKIE_SECURE` | Set `true` behind HTTPS | Not used; HTTPS `PUBLIC_ORIGIN` enables secure cookies |
| `PUBLIC_ORIGIN` | Used by the recovery CLI, not normal web startup | Browser-facing HTTP(S) origin, including the published port; no path/query/fragment |

Native MCP startup chooses a free loopback port unless `PORT` is set. The Docker image already sets `PORT=5858`; do not replace it with the host-side port. Change the published mapping and `PUBLIC_ORIGIN` together. Paths are resolved relative to the working directory except the MCP web build, which is located relative to its entry point; use absolute native `DATA_DIR` paths in agent settings.

## Data and upgrades

The entire data directory matters:

- `v1/`: document SQLite databases.
- `.access/`: board/session/invitation metadata and persistent MCP board scope.
- `.server-lock/`: runtime ownership lock, not drawing data.

Docker MCP examples use the named volume `tldraw-mcp-rooms`; the browser-only example uses `tldraw-web-rooms`; Compose uses its own project-scoped `rooms` volume. Stop the server and back up the **entire data directory consistently**, not just drawing databases. Removing a container does not remove its named volume. Removing the volume destroys drawings and access metadata.

Room IDs are case-sensitive even on case-insensitive filesystems. Startup migrates older `<roomId>.sqlite` files to encoded filenames after checkpointing WAL data, and refuses conflicting destinations. Stop old processes and back up before upgrading. Never run two room-owning processes against the same files.

### Locks and crashes

Servers acquire an exclusive `DATA_DIR/.server-lock` directory before migration/opening drawing storage and remove it on clean shutdown. A second server refuses to start.

**After an abrupt crash or SIGKILL**, the lock intentionally remains. First verify that **no server/container** is using the data directory, then remove only `.server-lock` and restart. Never remove a live server's lock. `owner.json` records the original PID/hostname for diagnosis, but PIDs can be reused or belong to another container namespace; they are not automatic stale-lock detection.

When restoring a stopped backup, exclude the runtime lock or remove it only after the same verification. Document crash recovery and complete backup/restore testing remain future work.

### Existing pre-invitation boards and owner recovery

Old drawing databases are retained but cannot be claimed by guessing their room IDs. After the current server has started at least once to migrate storage, the host administrator can issue a private owner link.

For the Compose service:

```sh
docker compose exec -T app node dist/server/recover-board.js demo "Imported demo"
```

For the browser-only container above:

```sh
docker exec tldraw-web node dist/server/recover-board.js demo "Imported demo"
```

Open the printed link to become an owner. For another deployment origin, pass `-e PUBLIC_ORIGIN=https://your-board-host.example` to `docker exec` / `docker compose exec`. This is an administrator-only filesystem operation, never a public HTTP endpoint.

For local development, after a build:

```sh
DATA_DIR=./.data/rooms PUBLIC_ORIGIN=http://localhost:5173 \
  node dist/server/recover-board.js demo "Imported demo"
```
