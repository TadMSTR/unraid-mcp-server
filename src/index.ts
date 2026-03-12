#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import https from "https";

const UNRAID_URL = process.env.UNRAID_URL ?? "";
const UNRAID_API_KEY = process.env.UNRAID_API_KEY ?? "";
const tlsAgent = new https.Agent({ rejectUnauthorized: false });

async function graphql(query: string, variables?: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${UNRAID_URL}/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": UNRAID_API_KEY,
    },
    body: JSON.stringify({ query, ...(variables ? { variables } : {}) }),
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
  version: "0.4.0",
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

server.tool(
  "get-notifications",
  "Get Unraid notifications. Returns unread count summary and a list of recent notifications. Optionally fetch archived notifications instead of unread.",
  {
    type: z.enum(["UNREAD", "ARCHIVE"]).default("UNREAD").describe("Whether to fetch unread or archived notifications"),
    limit: z.number().min(1).max(50).default(10).describe("Number of notifications to return"),
  },
  async ({ type, limit }) => {
    const data = (await graphql(
      `query($type: NotificationType!, $limit: Int!) {
        notifications {
          overview { unread { alert warning info total } }
          list(filter: { type: $type, offset: 0, limit: $limit }) {
            title subject description importance formattedTimestamp
          }
        }
      }`,
      { type, limit }
    )) as {
      notifications: {
        overview: { unread: { alert: number; warning: number; info: number; total: number } };
        list: { title: string; subject: string; description: string; importance: string; formattedTimestamp: string }[];
      };
    };

    const { overview, list } = data.notifications;
    const u = overview.unread;

    const lines: string[] = [
      `Unread: ${u.total} total (${u.alert} alerts, ${u.warning} warnings, ${u.info} info)`,
      "",
      `${type} notifications (${list.length}):`,
    ];

    if (list.length === 0) {
      lines.push("  None.");
    } else {
      for (const n of list) {
        const icon = n.importance === "ALERT" ? "🔴" : n.importance === "WARNING" ? "🟡" : "🔵";
        lines.push(`  ${icon} [${n.formattedTimestamp}] ${n.subject}`);
        if (n.description) lines.push(`     ${n.description}`);
      }
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "get-system-info",
  "Get Unraid system information including hostname, uptime, OS version, CPU, RAM, and Unraid/kernel versions.",
  {},
  async () => {
    const data = (await graphql(`{
      info {
        os { hostname uptime platform distro release }
        cpu { manufacturer brand cores threads }
        memory { layout { size type } }
        versions { core { unraid kernel } }
      }
    }`)) as {
      info: {
        os: { hostname: string; uptime: string; platform: string; distro: string; release: string };
        cpu: { manufacturer: string; brand: string; cores: number; threads: number };
        memory: { layout: { size: number; type: string }[] };
        versions: { core: { unraid: string; kernel: string } };
      };
    };

    const { os, cpu, memory, versions } = data.info;

    const uptimeDate = new Date(os.uptime);
    const uptimeSecs = Math.floor((Date.now() - uptimeDate.getTime()) / 1000);
    const uptimeDays = Math.floor(uptimeSecs / 86400);
    const uptimeHours = Math.floor((uptimeSecs % 86400) / 3600);
    const uptimeMins = Math.floor((uptimeSecs % 3600) / 60);
    const uptimeStr = uptimeDays > 0
      ? `${uptimeDays}d ${uptimeHours}h ${uptimeMins}m`
      : `${uptimeHours}h ${uptimeMins}m`;

    const ramTotalGiB = (memory.layout.reduce((sum, m) => sum + m.size, 0) / 1024 / 1024 / 1024).toFixed(0);
    const ramType = memory.layout[0]?.type ?? "Unknown";

    const lines = [
      `Hostname: ${os.hostname}`,
      `Uptime: ${uptimeStr}`,
      `OS: ${os.distro} ${os.release}`,
      `Unraid: ${versions.core.unraid}`,
      `Kernel: ${versions.core.kernel}`,
      `CPU: ${cpu.manufacturer} ${cpu.brand} (${cpu.cores} cores / ${cpu.threads} threads)`,
      `RAM: ${ramTotalGiB} GiB ${ramType} (${memory.layout.length} DIMMs)`,
    ];

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "get-docker-containers",
  "Get Docker container list with name, state, status, and image. Optionally filter to running containers only.",
  {
    runningOnly: z.boolean().default(false).describe("If true, only return running containers"),
  },
  async ({ runningOnly }) => {
    const data = (await graphql(`{
      docker { containers { names state status image } }
    }`)) as {
      docker: {
        containers: { names: string[]; state: string; status: string; image: string }[];
      };
    };

    let containers = data.docker.containers;
    if (runningOnly) containers = containers.filter((c) => c.state === "RUNNING");

    const running = containers.filter((c) => c.state === "RUNNING").length;
    const total = containers.length;

    const lines: string[] = [`Docker containers: ${running} running / ${total} shown`,""];

    for (const c of containers) {
      const name = c.names[0]?.replace(/^\//, "") ?? "unknown";
      const icon = c.state === "RUNNING" ? "▶" : "■";
      lines.push(`  ${icon} ${name} | ${c.status} | ${c.image}`);
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "get-shares",
  "Get Unraid user shares with name, comment, free space, and allocation settings.",
  {},
  async () => {
    const data = (await graphql(`{
      shares { name comment free allocator include exclude splitLevel }
    }`)) as {
      shares: {
        name: string;
        comment: string;
        free: number;
        allocator: string;
        include: string[];
        exclude: string[];
        splitLevel: string;
      }[];
    };

    const shares = data.shares;
    const lines: string[] = [`Shares: ${shares.length} total`, ""];

    for (const s of shares) {
      const freeGiB = (s.free / 1024 ** 3).toFixed(1);
      const comment = s.comment ? ` — ${s.comment}` : "";
      lines.push(`  ${s.name}${comment}`);
      lines.push(`    Free: ${freeGiB} GiB | Allocator: ${s.allocator}${s.splitLevel ? ` | Split: ${s.splitLevel}` : ""}`);
      if (s.include.length) lines.push(`    Include: ${s.include.join(", ")}`);
      if (s.exclude.length) lines.push(`    Exclude: ${s.exclude.join(", ")}`);
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
