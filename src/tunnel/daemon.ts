import "../server/environment.js";
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { CloudflareTunnel, type TunnelStatus } from "./cloudflare-tunnel.js";
import { ensureCloudflared } from "./cloudflared.js";
import { spawn } from "node:child_process";
import { localToken } from "../server/identity.js";
import {
  readRegistry,
  registryPath,
  runtimeDirectory,
} from "./runtime-paths.js";

const service = "practica-test-tunnel";
const port = Number(process.env.TUNNEL_CONTROL_PORT ?? 4300);
const bind = process.env.TUNNEL_BIND_HOST ?? "127.0.0.1";
const token = randomBytes(32).toString("hex");
const target = {
  port: Number(process.env.PORT ?? 3000),
  token: localToken,
  hostname: process.env.TUNNEL_APP_HOST ?? "127.0.0.1",
  webEnabled: process.env.TUNNEL_WEB_ENABLED !== "false",
};
let enabled = process.env.TUNNEL_ENABLED !== "false";
let closing = false;
const runner = new CloudflareTunnel({
  enabled: true,
  binary: ensureCloudflared,
  spawn: (binary, args) =>
    spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }),
  target: () => target,
});
const disabled: TunnelStatus = {
  status: "disabled",
  publicUrl: null,
  chatgptUrl: null,
  webUrl: null,
  error: null,
};
const status = () => ({
  service,
  version: 1,
  pid: process.pid,
  backendPort: target.port,
  status: enabled
    ? { ...runner.status(), ...(target.webEnabled ? {} : { webUrl: null }) }
    : disabled,
});
const authorized = (value: string | undefined) => {
  const left = Buffer.from(value ?? ""),
    right = Buffer.from(`Bearer ${token}`);
  return left.length === right.length && timingSafeEqual(left, right);
};
const control = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/health" && req.method === "GET") {
    res.end('{"ok":true}');
    return;
  }
  if (req.headers.origin || !authorized(req.headers.authorization)) {
    res.writeHead(401);
    res.end('{"error":"UNAUTHORIZED"}');
    return;
  }
  try {
    if (req.url === "/status" && req.method === "GET") {
      res.end(JSON.stringify(status()));
      return;
    }
    if (req.url === "/attach" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 8192) throw new Error("Invalid request.");
      }
      const input = JSON.parse(body);
      if (
        !Number.isInteger(input.port) ||
        input.port < 1 ||
        input.port > 65535 ||
        typeof input.token !== "string" ||
        !/^[\x20-\x7e]{1,2048}$/.test(input.token) ||
        typeof input.webEnabled !== "boolean" ||
        typeof input.enabled !== "boolean"
      )
        throw new Error("Invalid request.");
      target.port = input.port;
      target.token = input.token;
      target.webEnabled = input.webEnabled;
      if (enabled && !input.enabled) {
        enabled = false;
        await runner.stop();
      } else if (!enabled && input.enabled) {
        enabled = true;
        void runner.start(target.port, true);
      }
      res.end(JSON.stringify(status()));
      return;
    }
    if (req.url === "/retry" && req.method === "POST") {
      if (enabled) await runner.retry();
      res.end(JSON.stringify(status()));
      return;
    }
    if (req.url === "/restart" && req.method === "POST") {
      await runner.stop();
      if (enabled) void runner.start(target.port, true);
      res.end(JSON.stringify(status()));
      return;
    }
    if (req.url === "/stop" && req.method === "POST") {
      res.end('{"stopping":true}');
      setTimeout(() => void shutdown(), 50).unref();
      return;
    }
    res.writeHead(404);
    res.end('{"error":"NOT_FOUND"}');
  } catch {
    if (!res.headersSent) res.writeHead(400);
    res.end('{"error":"INVALID_REQUEST"}');
  }
});
control.requestTimeout = 10000;
control.headersTimeout = 5000;
async function shutdown() {
  if (closing) return;
  closing = true;
  await runner.stop();
  control.closeAllConnections();
  await new Promise<void>((resolve) => control.close(() => resolve()));
  if (readRegistry()?.pid === process.pid)
    rmSync(registryPath(), { force: true });
  process.exit(0);
}
async function main() {
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !["127.0.0.1", "0.0.0.0"].includes(bind) ||
    !["127.0.0.1", "localhost", "practica"].includes(target.hostname)
  )
    throw new Error("Invalid tunnel configuration.");
  await new Promise<void>((resolve, reject) => {
    control.once("error", reject);
    control.listen(port, bind, () => {
      control.off("error", reject);
      resolve();
    });
  });
  mkdirSync(runtimeDirectory(), { recursive: true, mode: 0o700 });
  const temporary = `${registryPath()}.${process.pid}.tmp`;
  writeFileSync(
    temporary,
    JSON.stringify({ version: 1, pid: process.pid, port, token }),
    { flag: "wx", mode: 0o600 },
  );
  renameSync(temporary, registryPath());
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  console.log("Independent tunnel process is ready.");
  if (enabled) void runner.start(target.port, true);
}
main().catch(() => {
  console.error(
    "Could not start the independent tunnel process. Check the data directory and control port.",
  );
  process.exit(1);
});
