# unraid-mcp-server

An MCP server for Unraid, exposing Unraid data to Claude via the Unraid GraphQL API.

## Tools

### `get-parity-status`
Returns the current parity check status for the Unraid array, including progress percentage, speed, duration, error count, and whether it is running, paused, or correcting.

### `get-array-status`
Returns the array state (started/stopped), total capacity with used/free in TiB, and a per-disk summary including device name, type, status, usage in GiB, and temperature.

### `get-disk-health`
Returns SMART status, temperature, interface type (SAS/SATA/PCIE/USB), and spin state for all physical disks attached to the server.

### `get-parity-history`
Returns recent parity check history. Accepts an optional `limit` parameter (1–50, default 10). Each entry shows date, status (COMPLETED/CANCELLED), duration, speed, and error count.

### `get-notifications`
Returns unread notification count summary (alerts, warnings, info) and a list of recent notifications. Accepts optional `type` (UNREAD or ARCHIVE, default UNREAD) and `limit` (1–50, default 10) parameters.

### `get-system-info`
Returns hostname, uptime, OS version, Unraid and kernel versions, CPU model and core/thread count, and total RAM with DIMM count.

### `get-docker-containers`
Returns all Docker containers with name, state, status string, and image. Accepts optional `runningOnly` boolean (default false) to filter to running containers only.

### `get-shares`
Returns Unraid user shares with name, comment, free space, and allocation settings (allocator, split level, include/exclude disk lists if configured).

## Not Implemented

**User accounts** — The Unraid GraphQL API exposes a `me` query that returns the current API key's identity, but no endpoint for listing local user accounts. Managing users is a rare task better handled in the Unraid web UI.

**VMs** — No running VMs available to test against; skipped until there's something to validate the output.

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
