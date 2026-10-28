import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { Server } from "node:http";
import { ensureCloudflared } from "./cloudflared.js";
import { startGateway, type GatewayTarget } from "./gateway.js";
import { localToken } from "../server/identity.js";

export type TunnelStatus = {
  provider?: "cloudflare" | "hosted";
  status:
    "disabled" | "starting" | "installing" | "ready" | "reconnecting" | "error";
  publicUrl: string | null;
  chatgptUrl: string | null;
  webUrl: string | null;
  error: string | null;
};
export type TunnelDependencies = {
  binary: (onDownload: () => void) => Promise<string>;
  spawn: (binary: string, args: string[]) => ChildProcess;
  enabled: boolean;
  probe?: (origin: string) => Promise<boolean>;
  target?: () => GatewayTarget;
};

async function publicEndpointResponds(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/mcp`, {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (response.status !== 401) {
      await response.body?.cancel();
      return false;
    }
    const body = (await response.json()) as { error?: string };
    return body.error === "MCP_UNAUTHORIZED";
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    if (code !== "ENOTFOUND" && code !== "EAI_AGAIN") throw error;
  }
  // A machine's negative DNS cache can lag behind a newly-created tunnel.
  // Verify through Cloudflare's public resolver while retaining normal TLS validation.
  const url = new URL("/mcp", origin);
  const dnsUrl = new URL("https://cloudflare-dns.com/dns-query");
  dnsUrl.searchParams.set("name", url.hostname);
  dnsUrl.searchParams.set("type", "A");
  const answer = await fetch(dnsUrl, {
    headers: { Accept: "application/dns-json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!answer.ok) return false;
  const dns = (await answer.json()) as {
    Status: number;
    Answer?: { type: number; data: string }[];
  };
  const address =
    dns.Status === 0
      ? dns.Answer?.find((entry) => entry.type === 1 && isIP(entry.data) === 4)
          ?.data
      : undefined;
  if (!address) return false;
  return new Promise<boolean>((resolve) => {
    const request = httpsRequest(
      url,
      {
        family: 4,
        lookup: (_hostname, _options, callback) => callback(null, address, 4),
      },
      (response) => {
        if (response.statusCode !== 401) {
          response.resume();
          resolve(false);
          return;
        }
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
          if (body.length > 4096) {
            response.destroy();
            resolve(false);
          }
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body).error === "MCP_UNAUTHORIZED");
          } catch {
            resolve(false);
          }
        });
        response.on("error", () => resolve(false));
      },
    );
    request.setTimeout(5000, () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
    request.end();
  });
}

export class CloudflareTunnel {
  private child: ChildProcess | null = null;
  private gateway: Server | null = null;
  private timer: NodeJS.Timeout | null = null;
  private generation = 0;
  private port = 0;
  private webEnabled = true;
  private value: TunnelStatus = {
    status: "starting",
    publicUrl: null,
    chatgptUrl: null,
    webUrl: null,
    error: null,
  };
  constructor(
    private readonly deps: TunnelDependencies = {
      binary: ensureCloudflared,
      spawn: (binary, args) =>
        spawn(binary, args, {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        }),
      enabled: process.env.TUNNEL_ENABLED !== "false",
    },
  ) {
    if (!deps.enabled) this.value.status = "disabled";
  }
  status(): TunnelStatus {
    return { ...this.value };
  }
  async start(port: number, webEnabled = true): Promise<void> {
    if (!this.deps.enabled) return;
    this.port = port;
    this.webEnabled = webEnabled;
    const generation = ++this.generation;
    this.value = {
      status: "starting",
      publicUrl: null,
      chatgptUrl: null,
      webUrl: null,
      error: null,
    };
    try {
      const binary = await this.deps.binary(() => {
        if (generation === this.generation) this.value.status = "installing";
      });
      if (generation !== this.generation) return;
      const accessKey = randomBytes(32).toString("hex");
      const webAccessKey = webEnabled
        ? randomBytes(32).toString("hex")
        : undefined;
      const gateway = await startGateway(
        port,
        localToken,
        accessKey,
        webAccessKey,
        { target: this.deps.target },
      );
      if (generation !== this.generation) {
        gateway.server.close();
        return;
      }
      this.gateway = gateway.server;
      this.value.status = "starting";
      const child = this.deps.spawn(binary, [
        "tunnel",
        "--no-autoupdate",
        "--protocol",
        "http2",
        "--url",
        gateway.url,
      ]);
      this.child = child;
      let buffer = "";
      let origin: string | null = null;
      const connections = new Set<string>();
      let verified = false;
      let checking = false;
      const refresh = () => {
        if (generation !== this.generation || this.child !== child || !origin)
          return;
        if (connections.size && !verified) {
          if (!checking) {
            checking = true;
            void verify();
          }
          return;
        }
        if (connections.size) {
          if (this.timer) clearTimeout(this.timer);
          this.timer = null;
          this.value = {
            status: "ready",
            publicUrl: `${origin}/mcp`,
            chatgptUrl: `${origin}/mcp/${accessKey}`,
            webUrl: webAccessKey ? `${origin}/app/${webAccessKey}` : null,
            error: null,
          };
        } else
          this.value = {
            status: "reconnecting",
            publicUrl: `${origin}/mcp`,
            chatgptUrl: null,
            webUrl: null,
            error: null,
          };
      };
      const verify = async () => {
        while (
          generation === this.generation &&
          this.child === child &&
          !verified
        ) {
          try {
            verified = await (this.deps.probe ?? publicEndpointResponds)(
              origin!,
            );
          } catch {
            /* DNS and edge routes may need a moment to propagate. */
          }
          if (verified) break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        checking = false;
        refresh();
      };
      const consume = (chunk: Buffer | string) => {
        buffer = (buffer + chunk.toString()).slice(-16384);
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const address = line.match(
            /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/,
          );
          if (address) origin = address[0];
          const connection = line.match(/connIndex=(\d+)/)?.[1] ?? "0";
          if (line.includes("Registered tunnel connection"))
            connections.add(connection);
          if (line.includes("Unregistered tunnel connection"))
            connections.delete(connection);
          refresh();
        }
      };
      // Consume connection diagnostics in memory. Never forward request URLs or headers to logs.
      child.stdout?.on("data", consume);
      child.stderr?.on("data", consume);
      const failed = () => {
        if (generation !== this.generation) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.value = {
          status: "error",
          publicUrl: null,
          chatgptUrl: null,
          webUrl: null,
          error: "Cloudflare Tunnel disconnected. Retry the connection.",
        };
        this.child = null;
        this.gateway?.closeAllConnections();
        this.gateway?.close();
        this.gateway = null;
      };
      child.once("error", failed);
      child.once("exit", failed);
      this.timer = setTimeout(() => {
        if (generation !== this.generation || this.value.status === "ready")
          return;
        failed();
        child.kill("SIGTERM");
      }, 60000);
      this.timer.unref();
    } catch {
      if (generation !== this.generation) return;
      this.gateway?.closeAllConnections();
      this.gateway?.close();
      this.gateway = null;
      this.value = {
        status: "error",
        publicUrl: null,
        chatgptUrl: null,
        webUrl: null,
        error:
          "Could not start Cloudflare Tunnel. Check internet access or install cloudflared, then retry.",
      };
    }
  }
  async retry() {
    if (
      !this.deps.enabled ||
      ["starting", "installing", "ready"].includes(this.value.status)
    )
      return this.status();
    await this.stop();
    void this.start(this.port, this.webEnabled);
    return this.status();
  }
  async stop() {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null && !child.killed) {
      await new Promise<void>((resolve) => {
        const force = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
        force.unref();
        child.once("exit", () => {
          clearTimeout(force);
          resolve();
        });
        child.kill("SIGTERM");
      });
    }
    if (this.gateway) {
      const gateway = this.gateway;
      this.gateway = null;
      gateway.closeAllConnections();
      await new Promise<void>((resolve) => gateway.close(() => resolve()));
    }
  }
  onApplicationShutdown() {
    return this.stop();
  }
}
