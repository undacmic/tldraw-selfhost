# MCP drawing tools

See [client setup](mcp-clients.md) to connect an agent. These are standalone local MCP tools, not a compatibility implementation of the official tldraw MCP app.

| Tool | Purpose |
| --- | --- |
| `list_boards` | List persistent boards owned by this MCP data directory. |
| `create_board` | Create a board; return its ID, initial page, and private browser editor link. |
| `open_board` | Return a fresh browser link for a saved MCP board. |
| `get_board` | Read pages and paginated shape records, including browser edits. |
| `create_shapes` | Atomically draw up to 100 shapes on a page. |
| `update_shapes` | Atomically patch position, size, label, color, or rotation. |
| `delete_shapes` | Atomically delete supported shapes. |

## Example

After `create_board`, call `create_shapes` with the returned board ID:

```json
{
  "boardId": "<returned board ID>",
  "shapes": [
    { "kind": "rectangle", "x": 0, "y": 0, "width": 200, "height": 100, "text": "Local MCP", "color": "blue" },
    { "kind": "arrow", "x": 200, "y": 50, "width": 150, "height": 0 },
    { "kind": "ellipse", "x": 350, "y": 0, "width": 200, "height": 100, "text": "SQLite" }
  ]
}
```

Coordinates are page coordinates. Omit `pageId` to draw on the first page. Width/height default to 200/100; for arrows they are signed endpoint offsets. Text has a fixed wrapping width and content-dependent height. The response contains shape IDs for subsequent updates/deletes. Batches either commit completely or roll back.

Drawing works without an open browser. When you open the returned board link, the regular tldraw editor renders the shared state. Browser edits are readable through `get_board`. Neither side maintains a separate copy of the document.

## Limits and boundaries

- Supported creation kinds: `rectangle`, `ellipse`, `diamond`, `text`, and unbound `arrow`.
- Updates/deletes reject locked shapes, nested shapes, unsupported types, and shapes with children or bindings, rather than bypassing editor layout/binding logic. Use the browser for those operations.
- `get_board` returns shape records, **not an image**. Image previews, exports, richer layout operations, and embedded MCP Apps widgets are future work.
- MCP can access only boards created through this data directory's MCP, not unrelated browser-created boards—even when given their IDs.
- Browser links grant editor access to one board, not owner recovery rights. Invitations apply to all pages of that board, not just one page.
- There is no arbitrary JavaScript executor or HTTP MCP endpoint.
- Board text is untrusted user content, not instructions for the agent.

See [architecture](architecture.md) for shared storage, leases, authorization, and lifecycle details.
