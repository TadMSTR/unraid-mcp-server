#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import https from "https";

const UNRAID_URL = process.env.UNRAID_URL ?? "";
const UNRAID_API_KEY = process.env.UNRAID_API_KEY ?? "";

const tlsAgent = new https.Agent({ rejectUnauthorized: false });

async function graphql(query: string): Promise<unknown> {
  const res = await fetch(`${UNRAID_URL}/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": UNRAID_API_KEY,
    },
    body: JSON.stringify({ query }),
    // @ts-ignore - Node fetch accepts agent for self-signed certs
    agent: tlsAgent,
  });

  if (!res.ok) {
    throw new Error(`Unraid API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { data?: unknown; errors?: { message: string }[] };

  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join(", "));
  }

  return json.data;
}

const server = new McpServer({
  name: "unraid-mcp-server",
  version: "0.1.0",
});

server.tool(
  "get-parity-status",
  "Get the current parity check status for the Unraid array, including progress, speed, errors, and duration.",
  {},
  async () => {
    const data = (await graphql(`{
      array {
        parityCheckStatus {
          date
          duration
          speed
          status
          errors
          progress
          correcting
          paused
          running
        }
      }
    }`)) as { array: { parityCheckStatus: Record<string, unknown> } };

    const p = data.array.parityCheckStatus;

    const durationHours = p.duration
      ? (Number(p.duration) / 3600).toFixed(1)
      : null;

    const lines = [
      `Status: ${p.status}`,
      `Progress: ${p.progress ?? 0}%`,
      `Speed: ${p.speed ? p.speed + " MB/s" : "N/A"}`,
      `Duration: ${durationHours ? durationHours + " hours" : "N/A"}`,
      `Errors: ${p.errors ?? 0}`,
      `Correcting: ${p.correcting ?? false}`,
      `Paused: ${p.paused ?? false}`,
      `Last run: ${p.date ?? "unknown"}`,
    ];

    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
