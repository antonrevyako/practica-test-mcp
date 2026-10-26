import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { localToken } from "../server/identity.js";
import { readRegistry, type TunnelRegistry } from "./runtime-paths.js";
import type { TunnelStatus } from "./cloudflare-tunnel.js";

const empty = (
  status: TunnelStatus["status"],
  error: string | null = null,
): TunnelStatus => ({
  status,
  publicUrl: null,
  chatgptUrl: null,
  webUrl: null,
  error,
});
export class TunnelClient {
  private value = empty(
    process.env.TUNNEL_ENABLED === "false" ? "disabled" : "starting",
  );
  private timer: NodeJS.Timeout | null = null;
  private closed = false;
  private generation = 0;
  private appPort = 0;
  private webEnabled = true;
  private enabled = process.env.TUNNEL_ENABLED !== "false";
  status(): TunnelStatus {
    return { ...this.value };
  }
  private endpoint(registry: TunnelRegistry) {
    const value =
      process.env.TUNNEL_SERVICE_URL ?? `http://127.0.0.1:${registry.port}`;
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]", "tunnel"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid tunnel service address.");
    return url;
  }
  private async request(path: string, body?: unknown) {
    const registry = readRegistry();
    if (!registry) throw new Error("Tunnel process is unavailable.");
    const response = await fetch(new URL(path, this.endpoint(registry)), {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      signal: AbortSignal.timeout(3000),
      headers: {
        Authorization: `Bearer ${registry.token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error("Tunnel process is unavailable.");
    const result = (await response.json()) as {
      service: string;
      version: number;
      status: TunnelStatus;
    };
    if (
      result.service !== "practica-test-tunnel" ||
      result.version !== 1 ||
      !result.status
    )
      throw new Error("Tunnel protocol is unsupported.");
    return result.status;
  }
  private launch() {
    const source = import.meta.url.endsWith(".ts");
    const daemon = fileURLToPath(
      new URL(source ? "./daemon.ts" : "./daemon.js", import.meta.url),
    );
    const args = source
      ? [resolve("node_modules/tsx/dist/cli.mjs"), daemon]
      : [daemon];
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        PORT: String(this.appPort),
        TUNNEL_CONTROL_PORT:
          process.env.TUNNEL_CONTROL_PORT ??
          String(this.appPort === 65535 ? 65534 : this.appPort + 1),
        TUNNEL_BIND_HOST: "127.0.0.1",
        TUNNEL_WEB_ENABLED: String(this.webEnabled),
      },
    });
    child.on("error", () => {});
    child.unref();
  }
  private async attach() {
    this.value = await this.request("/attach", {
      port: this.appPort,
      token: localToken,
      webEnabled: this.webEnabled,
      enabled: this.enabled,
    });
  }
  async start(port: number, webEnabled = true) {
    this.appPort = port;
    this.webEnabled = webEnabled;
    this.closed = false;
    const generation = ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    try {
      try {
        await this.attach();
      } catch {
        if (!this.enabled) {
          this.value = empty("disabled");
          return;
        }
        if (!process.env.TUNNEL_SERVICE_URL) this.launch();
        let attached = false;
        for (let attempt = 0; attempt < 100 && !this.closed; attempt++) {
          try {
            await this.attach();
            attached = true;
            break;
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        if (!attached) throw new Error("Tunnel process is unavailable.");
      }
      this.schedule(generation);
    } catch {
      if (!this.closed)
        this.value = empty(
          "error",
          "Could not connect to the tunnel process. Retry the connection or check the independent tunnel service.",
        );
    }
  }
  private schedule(generation: number) {
    if (this.closed || generation !== this.generation) return;
    this.timer = setTimeout(async () => {
      try {
        const value = await this.request("/status");
        if (!this.closed && generation === this.generation) this.value = value;
      } catch {
        if (!this.closed && generation === this.generation)
          this.value = empty(
            "error",
            "The tunnel process is unavailable. Retry the connection.",
          );
      }
      this.schedule(generation);
    }, 1000);
    this.timer.unref();
  }
  async retry() {
    try {
      this.value = await this.request("/retry", {});
    } catch {
      await this.start(this.appPort, this.webEnabled);
    }
    return this.status();
  }
  onApplicationShutdown() {
    this.closed = true;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
