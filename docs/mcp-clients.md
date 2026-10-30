# Connect an MCP client

First [get the image](../README.md#1-get-the-image):

```sh
docker pull ghcr.io/undacmic/tldraw-selfhost:0.2.0
```

Docker must be running and `docker` must be on your client's PATH. Use the configuration for **one** client below; merge it into existing settings rather than replacing unrelated servers. No host Node.js, API key, separate web server, or MCP URL is needed.

All examples use **http://localhost:8080** and the persistent **`tldraw-mcp-rooms`** Docker volume. The agent starts the server when it connects. Do not run a browser-only server on the same port, or enable these defaults in several agents simultaneously. See [multiple agents](#multiple-agents) for isolation.

## Claude Code

Register a user-scoped local server:

```sh
claude mcp add --transport stdio --scope user tldraw -- docker run --rm -i --init -p 127.0.0.1:8080:5858 -e PUBLIC_ORIGIN=http://localhost:8080 -v tldraw-mcp-rooms:/data/rooms --security-opt no-new-privileges:true ghcr.io/undacmic/tldraw-selfhost:0.2.0 node dist/server/mcp.js
```

Run `claude mcp list` to check registration. In Claude Code, use `/mcp` to check the connection and review tool permissions. Then [try drawing](#try-it).

[Official Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

## Claude Desktop

Open **Settings → Developer → Edit Config**. Merge this into `claude_desktop_config.json`, then fully quit and reopen Claude Desktop:

```json
{
  "mcpServers": {
    "tldraw": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i", "--init",
        "-p", "127.0.0.1:8080:5858",
        "-e", "PUBLIC_ORIGIN=http://localhost:8080",
        "-v", "tldraw-mcp-rooms:/data/rooms",
        "--security-opt", "no-new-privileges:true",
        "ghcr.io/undacmic/tldraw-selfhost:0.2.0", "node", "dist/server/mcp.js"
      ]
    }
  }
}
```

Review the local server/tool permissions, then [try drawing](#try-it). If Desktop cannot find Docker, use the absolute path to the Docker executable as `command`.

[Official local-server setup guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

## Cursor

Copy the **same JSON as [Claude Desktop](#claude-desktop)** into one of:

- `.cursor/mcp.json` in your project, or
- `~/.cursor/mcp.json` for your user.

Open Cursor's MCP settings, enable `tldraw`, and review its tools. Then [try drawing](#try-it).

[Official Cursor MCP documentation](https://cursor.com/docs/context/mcp).

## VS Code / GitHub Copilot

1. Open the Command Palette and run **MCP: Add Server**.
2. Choose **Command (stdio)** and paste this launch command:

   ```sh
   docker run --rm -i --init -p 127.0.0.1:8080:5858 -e PUBLIC_ORIGIN=http://localhost:8080 -v tldraw-mcp-rooms:/data/rooms --security-opt no-new-privileges:true ghcr.io/undacmic/tldraw-selfhost:0.2.0 node dist/server/mcp.js
   ```

3. Name the server `tldraw` and select a personal/global configuration destination.
4. Review the trust prompt and enable its tools in agent chat. Then [try drawing](#try-it).

Use the guided flow to select the configuration format appropriate to your installed VS Code version and agent harness. Portable configurations use `mcpServers`; the VS Code-specific format uses `servers`. They are not interchangeable.

[Official VS Code MCP documentation](https://code.visualstudio.com/docs/copilot/customization/mcp-servers).

## Codex

Register the server with the CLI:

```sh
codex mcp add tldraw -- docker run --rm -i --init -p 127.0.0.1:8080:5858 -e PUBLIC_ORIGIN=http://localhost:8080 -v tldraw-mcp-rooms:/data/rooms --security-opt no-new-privileges:true ghcr.io/undacmic/tldraw-selfhost:0.2.0 node dist/server/mcp.js
```

Run `codex mcp list` to check registration. Codex CLI and the IDE extension share MCP configuration; reload the client after changing it. Then [try drawing](#try-it).

Alternatively, add this to `~/.codex/config.toml` instead of running the registration command:

```toml
[mcp_servers.tldraw]
command = "docker"
args = [
  "run", "--rm", "-i", "--init",
  "-p", "127.0.0.1:8080:5858",
  "-e", "PUBLIC_ORIGIN=http://localhost:8080",
  "-v", "tldraw-mcp-rooms:/data/rooms",
  "--security-opt", "no-new-privileges:true",
  "ghcr.io/undacmic/tldraw-selfhost:0.2.0", "node", "dist/server/mcp.js"
]
startup_timeout_sec = 30
```

[Official Codex MCP documentation](https://developers.openai.com/codex/mcp/).

## OpenCode

For **OpenCode 2.x**, merge this into your project's `opencode.json` or your existing user configuration:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "tldraw": {
        "type": "local",
        "command": [
          "docker", "run", "--rm", "-i", "--init",
          "-p", "127.0.0.1:8080:5858",
          "-e", "PUBLIC_ORIGIN=http://localhost:8080",
          "-v", "tldraw-mcp-rooms:/data/rooms",
          "--security-opt", "no-new-privileges:true",
          "ghcr.io/undacmic/tldraw-selfhost:0.2.0", "node", "dist/server/mcp.js"
        ],
        "timeout": { "startup": 30000 }
      }
    }
  }
}
```

OpenCode uses `mcp.servers`, `type: "local"`, and a **single command array**, not `mcpServers` plus `args`. Reload the client and [try drawing](#try-it).

This example follows the current [OpenCode configuration schema](https://opencode.ai/config.json). OpenCode 1.x used `mcp.tldraw`, `enabled`, and a numeric `timeout`; see the [legacy MCP guide](https://opencode.ai/docs/mcp-servers/) if you are on that version.

## Try it

Ask your agent:

> Use tldraw to create a board called Architecture. Give me the browser link, then draw a browser connected to a local server and SQLite.

Open the returned `browserUrl` and keep it beside the chat. You can edit while the agent draws. **Fit drawing** frames the current page. Later, ask the agent to list saved boards and open one.

Only open links from a trusted local server. The link is a private, board-scoped editor invitation; anyone holding it can edit. It is redeemable for one hour, and a redeemed browser session retains access for up to 30 days. Use `open_board` for a fresh link. MCP-created boards are managed through MCP; their browser editor sessions do not have owner-only Invite controls.

## Multiple agents

The defaults intentionally reuse one board collection, but **only one server may own a volume at a time**. To run a second agent simultaneously, change all three settings in that agent's launch arguments:

| Setting | Default | Example for a second agent |
| --- | --- | --- |
| Port mapping | `127.0.0.1:8080:5858` | `127.0.0.1:8081:5858` |
| Browser origin | `PUBLIC_ORIGIN=http://localhost:8080` | `PUBLIC_ORIGIN=http://localhost:8081` |
| Data volume | `tldraw-mcp-rooms:/data/rooms` | `tldraw-codex-rooms:/data/rooms` |

Keep the container-side port **5858** and data path **`/data/rooms`** unchanged. Independent volumes contain independent boards. Do not try to synchronize agents by mounting the same drawing volume into multiple server processes.

## Without Docker

If you prefer a native Node.js 24 process, build from the repository:

```sh
npm ci
npm run build
```

Replace the Docker launch command in your client with:

```sh
node /absolute/path/to/tldraw-selfhost/dist/server/mcp.js
```

For clients with `command`/`args`, use `command: "node"` and a one-element `args` array containing that absolute file path. For OpenCode, use `command: ["node", "/absolute/path/to/tldraw-selfhost/dist/server/mcp.js"]`. Use an absolute Node executable path if your client does not inherit your shell's PATH.

Native mode defaults to an automatically selected loopback port and `~/.tldraw-selfhost/rooms`. Set `PORT` and an absolute `DATA_DIR` in the client's environment configuration if needed. OpenCode calls that setting `environment`; the other JSON examples use `env`. No `npm start`, Vite, or separate server is needed. Avoid npm banners on stdout; use the Node entry point directly (or `npm run --silent mcp` for a terminal client).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Docker cannot connect | Start Docker Desktop/Engine and verify `docker info` in a terminal. |
| Image not found | Pull `ghcr.io/undacmic/tldraw-selfhost:0.2.0` first. If GHCR denies access, authenticate with `docker login ghcr.io` and a token with `read:packages`. |
| Agent cannot find Docker/Node | Use the executable's absolute path in the client configuration. |
| Port 8080 already allocated | Stop the browser-only/other MCP server, or choose a different port **and** `PUBLIC_ORIGIN`. |
| Data directory locked | Stop the other server using the volume. After a crash, follow [lock recovery](operations.md#locks-and-crashes); never delete a live server's lock. |
| `/mcp` returns 404 | Expected: this server uses **stdio**, not HTTP MCP. Configure a launch command, not a URL. |
| Browser home is empty or board access is denied | Open the private board link returned by `create_board`/`open_board`, not just localhost:8080. |
| Invitation expired | Ask the agent to open the board again for a fresh link. |
| Agent is disconnected | Allow the local server/tools in client settings and inspect client MCP logs; server diagnostics go to stderr. |

Keep Docker's `-i`; do not add `-t` or `-d` to the MCP launch command. Stdio must stay attached to the agent. Closing a browser tab does not stop the server; disconnecting the MCP client does. `--rm` removes the stopped container, **not** the named data volume.

These formats follow the linked client documentation. Protocol, browser, and Docker behavior are tested in this repository; end-to-end compatibility with every listed agent is not claimed.
