# tldraw self-hosted

A local tldraw canvas for AI agents and people. Your agent draws through MCP; you watch and edit the same board in your browser. Everything runs on your machine, with SQLite persistence instead of Cloudflare Durable Objects.

## Scope

- **Local MCP server:** your agent starts the container and its web server automatically.
- **Live browser canvas:** see the agent's drawing and edit alongside it.
- **Persistent boards:** separate boards, shared pages, and account-free invitation links.
- **Basic drawing tools:** rectangles, ellipses, diamonds, text, and arrows.
- **Optional browser-only mode:** use it as a self-hosted collaborative whiteboard without an agent.

**Not production-ready.** This is a standalone stdio MCP server, not a drop-in replacement for the official tldraw MCP app. HTTP `/mcp`, embedded chat widgets, image previews/exports, asset uploads, and invitation revocation are not implemented. Keep the server private; do not expose it directly to the internet.

## Licensing

The editor uses the **tldraw SDK**, under the [tldraw license](https://tldraw.dev/community/license):

- **Local development:** the editor runs on localhost without a license key, including inside Docker.
- **Production use:** obtain an appropriate tldraw license. Commercial and eligible non-commercial hobby licenses have different terms. Self-hosting, Docker, or using localhost does not itself grant production-use rights.
- **License keys:** keys are embedded when building the image, not supplied to a running container. See [licensed builds](docs/operations.md#licensed-builds) and the [official license-key guide](https://tldraw.dev/sdk-features/license-key).

This repository does not yet include a license for its original code. Dependencies retain their own licenses.

## 1. Get the image

Install and start **Docker Desktop** or **Docker Engine**, then pull the release:

```sh
docker pull ghcr.io/undacmic/tldraw-selfhost:0.2.0
```

You do **not** need Node.js or a source checkout. Version **0.2.0** includes the local MCP server and supports Linux AMD64 and ARM64. See the [release notes](https://github.com/undacmic/tldraw-selfhost/releases/tag/v0.2.0). If the package is private, authenticate with `docker login ghcr.io` using a token with `read:packages`.

## 2. Connect your agent

Choose your client and copy its configuration:

| Agent/client | Setup |
| --- | --- |
| Claude Code | [One CLI command](docs/mcp-clients.md#claude-code) |
| Claude Desktop | [Desktop configuration](docs/mcp-clients.md#claude-desktop) |
| Cursor | [MCP configuration](docs/mcp-clients.md#cursor) |
| VS Code / GitHub Copilot | [Add a stdio server](docs/mcp-clients.md#vs-code--github-copilot) |
| Codex CLI / IDE extension | [CLI command or TOML](docs/mcp-clients.md#codex) |
| OpenCode | [Local server configuration](docs/mcp-clients.md#opencode) |

The agent launches the Docker image over **stdio**. It also starts the browser server at **http://localhost:8080**. Do not start a second container or run Docker Compose first.

**Use one agent/server at a time with the default configuration.** The examples share port 8080 and the persistent `tldraw-mcp-rooms` volume. For simultaneous agents, use [separate ports and volumes](docs/mcp-clients.md#multiple-agents).

## 3. Draw together

Ask your agent:

> Create a board called Architecture, give me its browser link, and draw a diagram of a local MCP server connected to a browser and SQLite.

Open the **board link returned by the agent**, not just the home page: the link grants access to that board. Shapes appear live. You can edit in the browser, and the agent can read those changes. Use **Fit drawing** to frame the current page.

Drawings stay in the Docker volume after the container stops. Ask the agent to **list boards** and **open a board** to continue later. The server stops when its MCP client disconnects; closing a browser tab does not stop it.

Board links are private editor invitations, redeemable for one hour. Keep them secret. Ask the agent for a fresh link if needed. MCP can access only its own boards, not unrelated browser-created boards.

## More

- [MCP client configuration and troubleshooting](docs/mcp-clients.md)
- [Drawing tools and limitations](docs/mcp-tools.md)
- [Browser-only setup, licensing, sharing, backups, and recovery](docs/operations.md)
- [Local development, tests, and publishing releases](docs/development.md)
- [Architecture and security boundaries](docs/architecture.md)
