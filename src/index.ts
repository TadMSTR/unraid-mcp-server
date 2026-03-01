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

server.tool(
  "get-array-status",
  "Get the Unraid array state, overall capacity, and per-disk status including temperature, usage, and error counts.",
  {},
  async () => {
    const data = (await graphql(`{
      array {
        state
        capacity { kilobytes { free used total } }
        disks { name device type status temp rotational fsSize fsFree fsUsed numErrors }
      }
    }`)) as {
      array: {
        state: string;
        capacity: { kilobytes: { free: string; used: string; total: string } };
        disks: {
          name: string; device: string; type: string; status: string;
          temp: number | null; rotational: boolean;
          fsSize: number | null; fsFree: number | null; fsUsed: number | null;
          numErrors: number;
        }[];
      };
    };

    const { state, capacity, disks } = data.array;
    const kb = capacity.kilobytes;
    const toTiB = (k: string) => (Number(k) / 1024 / 1024 / 1024).toFixed(2);

    const lines: string[] = [
      `Array state: ${state}`,
      `Capacity: ${toTiB(kb.used)} TiB used / ${toTiB(kb.total)} TiB total (${toTiB(kb.free)} TiB free)`,
      "",
      "Disks:",
    ];

    for (const disk of disks) {
      const usedGiB = disk.fsUsed ? (disk.fsUsed / 1024 / 1024 / 1024).toFixed(1) : "?";
      const totalGiB = disk.fsSize ? (disk.fsSize / 1024 / 1024 / 1024).toFixed(1) : "?";
      const temp = disk.temp != null ? `${disk.temp}°C` : "N/A";
      const errors = disk.numErrors > 0 ? ` ⚠ ${disk.numErrors} errors` : "";
      lines.push(`  ${disk.name} (${disk.device}) [${disk.type}] ${disk.status} | ${usedGiB}/${totalGiB} GiB | ${temp}${errors}`);
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "get-disk-health",
  "Get SMART status, temperature, interface type, and spin state for all physical disks attached to the Unraid server.",
  {},
  async () => {
    const data = (await graphql(`{
      disks { name vendor device interfaceType smartStatus temperature isSpinning }
    }`)) as {
      disks: {
        name: string; vendor: string; device: string;
        interfaceType: string; smartStatus: string;
        temperature: number | null; isSpinning: boolean;
      }[];
    };

    const lines: string[] = ["Physical disk health:"];
    for (const disk of data.disks) {
      const temp = disk.temperature != null ? `${disk.temperature}°C` : "N/A";
      const spin = disk.isSpinning ? "spinning" : "standby";
      const smartOk = disk.smartStatus === "PASSED" || disk.smartStatus === "OK";
      const smart = smartOk ? `✓ ${disk.smartStatus}` : `✗ ${disk.smartStatus}`;
      lines.push(`  ${disk.device} | ${disk.name} (${disk.vendor}) | ${disk.interfaceType} | SMART: ${smart} | Temp: ${temp} | ${spin}`);
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "get-parity-history",
  "Get the recent parity check history for the Unraid array, showing completed and cancelled runs with duration, speed, and error counts.",
  { limit: z.number().min(1).max(50).default(10).describe("Number of recent entries to return") },
  async ({ limit }) => {
    const data = (await graphql(`{
      parityHistory { date duration speed status errors correcting }
    }`)) as {
      parityHistory: {
        date: string; duration: number; speed: string;
        status: string; errors: number; correcting: boolean | null;
      }[];
    };

    const history = data.parityHistory
      .filter((e) => new Date(e.date).getFullYear() > 1980)
      .slice(0, limit);

    const formatSpeed = (speed: string, duration: number): string => {
      if (!speed || speed === "Unavailable" || duration < 60) return "N/A";
      const n = Number(speed);
      if (!isNaN(n) && n > 1000) return `${(n / 1024 / 1024).toFixed(0)} MB/s`;
      return speed;
    };

    const formatDuration = (seconds: number): string => {
      if (seconds < 60) return `${seconds}s`;
      if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
      return `${(seconds / 3600).toFixed(1)}h`;
    };

    const lines: string[] = [`Parity history (last ${history.length} entries):`];
    for (const entry of history) {
      const date = new Date(entry.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const errors = entry.errors > 0 ? ` ⚠ ${entry.errors} errors` : "";
      lines.push(`  ${date} | ${entry.status} | ${formatDuration(entry.duration)} | ${formatSpeed(entry.speed, entry.duration)}${errors}`);
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
