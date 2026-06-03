# Changelog

## [0.4.0] — 2026-03-01

### Added

- `get-shares` — List Unraid user shares with name, path, and permissions

## [0.3.0] — 2026-03-01

### Added

- `get-system-info` — Unraid system information: hostname, version, uptime, CPU, memory
- `get-docker-containers` — List Docker containers managed by Unraid with status and image

## [0.2.0] — 2026-03-01

### Added

- `get-notifications` — Fetch recent Unraid notifications (alerts, warnings, notices)

### Security

- GraphQL variables used in `get-notifications` instead of string interpolation

## [0.1.0] — 2026-03-01

### Added

- Initial release of `unraid-mcp-server` — TypeScript MCP server (stdio) for Unraid NAS management
- `get-parity-status` — Current parity check status: progress, speed, errors, duration, running state
- `get-array-status` — Array state, disk count, capacity, and per-disk status
- `get-disk-health` — S.M.A.R.T. health summary for all array disks
- `get-parity-history` — Historical parity check results
- GraphQL client targeting Unraid's `/graphql` endpoint; self-signed TLS accepted via custom agent
- Env vars: `UNRAID_URL`, `UNRAID_API_KEY`
