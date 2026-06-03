# unraid-mcp-server

TypeScript/Node MCP server (stdio transport) for Unraid NAS management via the Unraid GraphQL API.

## What it does

Exposes Unraid management operations as MCP tools. Uses a self-signed TLS agent (`rejectUnauthorized: false`) for Unraid's local HTTPS endpoint.

## Tools

- `get-parity-status` — Parity check status and schedule.

Check `src/index.ts` for the full `server.tool()` list — additional tools may exist.

## Structure

```
src/
  index.ts    Single-file server — McpServer, all tools, GraphQL client
package.json  deps: @modelcontextprotocol/sdk, zod
tsconfig.json
```

## Configuration

| Env var          | Purpose                                          |
|------------------|--------------------------------------------------|
| `UNRAID_URL`     | Unraid base URL, e.g. `https://192.168.1.50` (required) |
| `UNRAID_API_KEY` | Unraid API key                                   |

## Key architecture decisions

- **`rejectUnauthorized: false` is intentional** — Unraid uses a self-signed cert for its local web UI. Do not remove this without adding cert pinning or a CA bundle option.
- **Inline GraphQL queries** — queries are inline strings in the tool handlers, not loaded from an external schema file. Keep queries minimal: only request fields that are actually returned in the tool response.

## Build

```bash
pnpm install && pnpm build
```

(npm also works: `npm install && npm run build`)

## Git workflow

Branch before editing — do not commit directly to `main`.
