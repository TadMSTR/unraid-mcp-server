# unraid-mcp-server

An MCP server for Unraid, exposing Unraid data to Claude via the Unraid GraphQL API.

## Tools

### `get-parity-status`
Returns the current parity check status for the Unraid array, including progress percentage, speed, duration, error count, and whether it is running, paused, or correcting.

## Requirements

- Unraid 7.x with API enabled
- An Unraid API key (Viewer role is sufficient for read-only tools)
- Node.js 18+

## Configuration

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
"unraid": {
  "command": "node",
  "args": ["/path/to/unraid-mcp-server/build/src/index.js"],
  "env": {
    "UNRAID_URL": "https://your-unraid-ip:4443",
    "UNRAID_API_KEY": "your-api-key"
  }
}
```

The server disables TLS certificate verification to support Unraid's self-signed certificate.

## Building

```bash
pnpm install
pnpm run build
```

## License

MIT
