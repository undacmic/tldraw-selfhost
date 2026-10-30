# Development, tests, and releases

For using the Docker image with an agent, see the [README](../README.md) and [MCP client setup](mcp-clients.md). Source development requires **Node.js 24** and npm.

## Run locally

```sh
npm ci
npm run dev
```

Open <http://localhost:5173/>. Vite proxies API and WebSocket traffic to the loopback-only Node backend on port 5858. Local databases live in `.data/rooms` (Git-ignored). This is the browser-only development server, not the MCP launcher.

For a production build served locally:

```sh
npm run build
ALLOWED_ORIGINS=http://localhost:5858 npm start
```

To let a local stdio MCP client launch the compiled server, use `node /absolute/path/to/dist/server/mcp.js` as its command instead. Do not run a separate server against the same data directory. See [native MCP setup](mcp-clients.md#without-docker).

The backend does not load dotenv files; supply runtime environment variables through the shell or client configuration. Compose separately reads `.env`. See [runtime settings](operations.md#runtime-settings).

The frontend's `VITE_TLDRAW_LICENSE_KEY` is embedded at build time, is not a secret, and requires a rebuild when changed. Supply it through the shell or Vite's `.env.local` for development. See [licensed builds](operations.md#licensed-builds).

## Tests

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Or use installed Google Chrome:

```sh
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
```

Unit/integration coverage includes board authorization, invitation expiry and role preservation, storage migration/isolation, room ownership and headless leases, MCP negotiation/tool discovery, scoped access, drawing validation, transaction rollback, unsupported-operation rejection, and persistence.

Browser/process tests cover:

- Local fonts with external HTTP blocked.
- Invitation redemption in independent browser contexts and live drawing convergence.
- Independent page selection and persistent page data after reload.
- Viewer read-only handshakes and rejection of forged writes/uninvited access.
- Compiled stdio MCP startup from another working directory.
- Live MCP drawing in Chromium and browser edits readable through MCP.
- Persisted drawings after full process restart.
- JSON-only stdout, EOF shutdown, startup-failure cleanup, and competing-process rejection.

The web test server uses `.data/e2e-rooms`; MCP tests use temporary directories, never a running Compose volume. Playwright shuts down the web test process gracefully so it releases its data lock.

These tests exercise the MCP protocol directly. They are not an end-to-end interoperability claim for every agent in the setup guide. Docker launch examples can be tested with an MCP client against a locally built image; the Docker/Chromium smoke check is separate from the default automated suite.

### Fonts

The UI uses locally served **Inter**, matching tldraw.com's UI family and 12px/500 editor styling. Canvas text retains official **Shantell Sans**, **IBM Plex Sans**, **IBM Plex Serif**, and **IBM Plex Mono**, including bold/italic variants. Fonts, icons, and translations come from version-matched packages, without requiring the tldraw CDN. Existing shape fonts are not rewritten. External embeds are not made offline by this bundling.

## Build your own image

From the source checkout:

```sh
docker build -t tldraw-selfhost:local .
```

To test it with an agent, replace the published `ghcr.io/undacmic/tldraw-selfhost:0.2.0` image in the [client examples](mcp-clients.md) with `tldraw-selfhost:local`. Keep the other Docker arguments unchanged. See [licensed builds](operations.md#licensed-builds) for the license-key build argument.

## Published images

Images are published to `ghcr.io/undacmic/tldraw-selfhost` for **Linux AMD64 and ARM64**:

- `latest` follows successful builds of `main`.
- Version tags such as `0.2.0` identify fixed releases. Never move or reuse a published version tag.
- [GitHub Releases](https://github.com/undacmic/tldraw-selfhost/releases) contains release notes, digests, and pull instructions.

MCP is available starting with **0.2.0**; the quickstart pulls that versioned release. Select a release whose notes include the features you need, and prefer an immutable image digest for repeatable deployments.

If the package is private, authenticate with `docker login ghcr.io` using a GitHub personal access token (classic) with `read:packages`. Repository visibility and package visibility are separate settings.

## Publish a release

The [release workflow](../.github/workflows/release.yml) runs unit tests, a production build, and Chromium browser tests before publishing. Pull requests only run checks. A push to `main` publishes `latest`; a stable version tag publishes the matching image tag and then creates a GitHub Release with generated notes. Release builds do not move `latest` backwards if an older commit is tagged.

1. Update `version` in `package.json` and `package-lock.json`, for example:

   ```sh
   npm version 0.2.1 --no-git-tag-version
   ```

2. Commit and push to `main`, then wait for its workflow to pass.
3. Create and push the matching tag:

   ```sh
   git tag -a v0.2.1 -m "Release 0.2.1"
   git push origin v0.2.1
   ```

The tag must exactly match `package.json` (`v0.2.1` → `0.2.1`); prerelease tags are not currently supported. Re-running the workflow does not create duplicate GitHub Releases. If publication fails, fix the underlying issue and rerun the failed jobs rather than moving the tag.

Actions uses its built-in `GITHUB_TOKEN`, with `packages: write` and `contents: write` only in jobs that need them. The GHCR package must be linked to this repository and grant it Actions write access (**Settings → Manage Actions access**). The image's `org.opencontainers.image.source` label identifies the source repository. No personal token needs to be stored as a repository secret.

For licensed release builds, set the repository Actions **variable** `VITE_TLDRAW_LICENSE_KEY` before publishing. The key becomes part of the public frontend. See [licensed builds](operations.md#licensed-builds).

## Remaining work

- Persistent assets, upload limits, document crash/restart, and complete backup/restore tests.
- Invitation revocation, participant/session management, and quotas.
- MCP image previews/exports, richer editor-semantic operations, explicit opt-in access to browser-created boards, and optional MCP Apps integration.
- Production HTTPS deployment and security/abuse hardening.

See [architecture](architecture.md) for design decisions and current security boundaries.
