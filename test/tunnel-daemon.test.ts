import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { TunnelClient } from "../src/tunnel/tunnel-client.js";

test("the independent process survives app-client shutdown and reattaches without restarting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "practica-tunnel-daemon-"));
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const saved = {
    DATABASE_PATH: process.env.DATABASE_PATH,
    TUNNEL_ENABLED: process.env.TUNNEL_ENABLED,
    TUNNEL_SERVICE_URL: process.env.TUNNEL_SERVICE_URL,
  };
  process.env.DATABASE_PATH = join(directory, "test.sqlite");
  process.env.TUNNEL_ENABLED = "false";
  delete process.env.TUNNEL_SERVICE_URL;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TUNNEL_CONTROL_PORT: String(port),
    TUNNEL_BIND_HOST: "127.0.0.1",
    PORT: "39001",
  };
  delete env.MCP_TOKEN;
  const child = spawn(
    process.execPath,
    [resolve("node_modules/tsx/dist/cli.mjs"), resolve("src/tunnel/daemon.ts")],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const first = new TunnelClient(),
    second = new TunnelClient();
  let registry: { pid: number; port: number; token: string } | undefined;
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (child.exitCode !== null)
        throw new Error("Fixture tunnel process exited early.");
      try {
        registry = JSON.parse(
          await readFile(join(directory, "tunnel-runtime.json"), "utf8"),
        );
        break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert(registry);
    const base = `http://127.0.0.1:${registry.port}`;
    const status = async () => {
      const response = await fetch(base + "/status", {
        headers: { Authorization: `Bearer ${registry!.token}` },
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    assert.equal((await fetch(base + "/status")).status, 401);
    if (process.platform !== "win32")
      assert.equal(
        (await stat(join(directory, "tunnel-runtime.json"))).mode & 0o777,
        0o600,
      );
    await first.start(39001, true);
    const before = await status();
    assert.equal(before.backendPort, 39001);
    first.onApplicationShutdown();
    assert.equal((await status()).pid, before.pid);
    await second.start(39002, false);
    const after = await status();
    assert.equal(after.pid, before.pid);
    assert.equal(after.backendPort, 39002);
    second.onApplicationShutdown();
    assert.equal(child.exitCode, null);
    const exiting = once(child, "exit");
    assert.equal(
      (
        await fetch(base + "/stop", {
          method: "POST",
          headers: { Authorization: `Bearer ${registry.token}` },
        })
      ).status,
      200,
    );
    await exiting;
    assert(!existsSync(join(directory, "tunnel-runtime.json")));
  } finally {
    first.onApplicationShutdown();
    second.onApplicationShutdown();
    if (child.exitCode === null) {
      const exiting = once(child, "exit");
      child.kill("SIGTERM");
      await exiting;
    }
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
