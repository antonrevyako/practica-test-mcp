import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once, EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import type { Request } from "express";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { startGateway } from "../src/tunnel/gateway.js";
import { CloudflareTunnel } from "../src/tunnel/cloudflare-tunnel.js";
import { localGuard, localToken } from "../src/server/security.js";
import { createMcp } from "../src/server/mcp.js";
import { ApiController } from "../src/server/api.controller.js";
import type { StudyService } from "../src/server/study.service.js";

test("public gateway authenticates MCP and keeps the UI and administrative API private", async () => {
  const app = express();
  let port = 0;
  app.use((req, res, next) => localGuard(port)(req, res, next));
  app.use(express.json({ limit: "16kb" }));
  const study = {
    status: () => ({ authenticated: false, expiresAt: null }),
    restoreSession: async () => ({ authenticated: false, expiresAt: null }),
  } as StudyService;
  app.all("/mcp", async (req, res) => {
    const mcp = createMcp(study);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close().catch(() => {});
      void mcp.close().catch(() => {});
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const backend = createServer(app);
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  port = (backend.address() as { port: number }).port;
  const key = "a".repeat(64);
  const gateway = await startGateway(port, localToken, key);
  const client = new Client({ name: "public-gateway-test", version: "1.0.0" });
  try {
    for (const path of [
      "/",
      "/api/connection",
      "/api/session",
      "/mcp/wrong",
      `/mcp/${key}?token=ignored`,
    ]) {
      assert.equal(
        (
          await fetch(`${gateway.url}${path}`, {
            headers: { Authorization: `Bearer ${localToken}` },
          })
        ).status,
        404,
      );
    }
    assert.equal((await fetch(`${gateway.url}/mcp`)).status, 401);
    assert.equal(
      (
        await fetch(`${gateway.url}/mcp`, {
          headers: { Authorization: "Bearer invalid" },
        })
      ).status,
      401,
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${gateway.url}/mcp/${key}`), {
        requestInit: {
          headers: {
            Origin: "https://chatgpt.com",
            "Sec-Fetch-Site": "cross-site",
          },
        },
      }),
    );
    const tools = await client.listTools();
    assert(tools.tools.some((tool) => tool.name === "login"));
    const status = await client.callTool({
      name: "session_status",
      arguments: {},
    });
    assert(!status.isError);
    assert.equal(
      JSON.parse((status.content as { text: string }[])[0].text).authenticated,
      false,
    );
    const response = await fetch(`${gateway.url}/mcp`, {
      headers: { Authorization: `Bearer ${localToken}` },
    });
    assert.notEqual(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    await client.close();
    gateway.server.closeAllConnections();
    backend.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => gateway.server.close(() => resolve())),
      new Promise<void>((resolve) => backend.close(() => resolve())),
    ]);
  }
});

test("private browser links authenticate UI and API access without granting that access to MCP clients", async () => {
  const app = express();
  let port = 0;
  let premiumPurchased = true;
  app.use((req, res, next) => localGuard(port)(req, res, next));
  app.use(express.json());
  app.use((req, _res, next) => {
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.origin, undefined);
    assert.equal(req.headers.authorization, `Bearer ${localToken}`);
    next();
  });
  app.get("/", (_req, res) =>
    res.type("html").send("<h1>Practice interface</h1>"),
  );
  app.get("/_next/static/fixture.js", (_req, res) =>
    res.type("js").send("fixture();"),
  );
  app.get("/api/preferences", (_req, res) => res.json({ premiumPurchased }));
  app.patch("/api/preferences", (req, res) => {
    premiumPurchased = req.body.premiumPurchased;
    res.json({ premiumPurchased });
  });
  const backend = createServer(app);
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  port = (backend.address() as { port: number }).port;
  const mcpKey = "a".repeat(64),
    webKey = "b".repeat(64);
  const gateway = await startGateway(port, localToken, mcpKey, webKey);
  try {
    for (const path of [
      "/",
      "/api/preferences",
      "/_next/static/fixture.js",
      `/app/${mcpKey}`,
      `/mcp/${webKey}`,
    ]) {
      assert.equal(
        (
          await fetch(gateway.url + path, {
            headers: { Authorization: `Bearer ${localToken}` },
          })
        ).status,
        404,
      );
    }
    const entry = await fetch(`${gateway.url}/app/${webKey}`, {
      redirect: "manual",
    });
    assert.equal(entry.status, 303);
    assert.equal(entry.headers.get("location"), "/");
    assert.equal(entry.headers.get("referrer-policy"), "no-referrer");
    const cookie = entry.headers.get("set-cookie")!;
    for (const flag of ["Secure", "HttpOnly", "SameSite=Lax", "Path=/"])
      assert(cookie.includes(flag));
    const headers = { Cookie: cookie.split(";")[0] };
    assert.equal((await fetch(gateway.url + "/", { headers })).status, 200);
    assert.equal(
      (
        await fetch(gateway.url + "/_next/static/fixture.js?cache=fixture", {
          headers,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await (
          await fetch(gateway.url + "/api/preferences", { headers })
        ).json()
      ).premiumPurchased,
      true,
    );
    for (const extra of [
      { Origin: "https://evil.invalid", "Sec-Fetch-Site": "same-origin" },
      { Origin: "null", "Sec-Fetch-Site": "same-origin" },
      { Origin: gateway.url, "Sec-Fetch-Site": "cross-site" },
    ]) {
      const blocked = await fetch(gateway.url + "/api/preferences", {
        method: "PATCH",
        headers: { ...headers, ...extra, "Content-Type": "application/json" },
        body: JSON.stringify({ premiumPurchased: false }),
      });
      assert.equal(blocked.status, 403);
    }
    assert.equal(premiumPurchased, true);
    const updated = await fetch(gateway.url + "/api/preferences", {
      method: "PATCH",
      headers: {
        ...headers,
        Origin: gateway.url,
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ premiumPurchased: false }),
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).premiumPurchased, false);
    assert.equal(updated.headers.get("cache-control"), "no-store");
    assert.equal(
      (
        await fetch(gateway.url + "/", {
          headers: { Cookie: "__Host-practica_web=wrong" },
        })
      ).status,
      404,
    );
  } finally {
    gateway.server.closeAllConnections();
    backend.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => gateway.server.close(() => resolve())),
      new Promise<void>((resolve) => backend.close(() => resolve())),
    ]);
  }
});

test("a surviving gateway keeps MCP and browser capabilities while its backend restarts on another port", async () => {
  const target = { port: 0, token: "first-fixture-token", webEnabled: true };
  async function backend(expected: string, label: string) {
    const server = createServer((req, res) => {
      if (req.headers.authorization !== `Bearer ${expected}`) {
        res.writeHead(401);
        res.end();
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ label, path: req.url }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return server;
  }
  const first = await backend(target.token, "first");
  target.port = (first.address() as { port: number }).port;
  const key = "c".repeat(64),
    browser = "d".repeat(64);
  const gateway = await startGateway(target.port, target.token, key, browser, {
    target: () => target,
  });
  let second: ReturnType<typeof createServer> | undefined;
  try {
    const mcpUrl = `${gateway.url}/mcp/${key}`;
    const webUrl = `${gateway.url}/app/${browser}`;
    assert.equal((await (await fetch(mcpUrl)).json()).label, "first");
    const entry = await fetch(webUrl, { redirect: "manual" });
    const cookie = entry.headers.get("set-cookie")!.split(";")[0];
    first.closeAllConnections();
    await new Promise<void>((resolve) => first.close(() => resolve()));
    assert.equal((await fetch(mcpUrl)).status, 502);
    target.token = "second-fixture-token";
    second = await backend(target.token, "second");
    target.port = (second.address() as { port: number }).port;
    assert.deepEqual(await (await fetch(mcpUrl)).json(), {
      label: "second",
      path: "/mcp",
    });
    assert.equal((await fetch(webUrl, { redirect: "manual" })).status, 303);
    assert.equal(
      (
        await (
          await fetch(gateway.url + "/", { headers: { Cookie: cookie } })
        ).json()
      ).label,
      "second",
    );
    target.webEnabled = false;
    assert.equal((await fetch(webUrl, { redirect: "manual" })).status, 404);
    assert.equal(
      (await fetch(gateway.url + "/", { headers: { Cookie: cookie } })).status,
      404,
    );
    assert.equal((await (await fetch(mcpUrl)).json()).label, "second");
  } finally {
    gateway.server.closeAllConnections();
    await new Promise<void>((resolve) => gateway.server.close(() => resolve()));
    if (first.listening) {
      first.closeAllConnections();
      await new Promise<void>((resolve) => first.close(() => resolve()));
    }
    if (second?.listening) {
      second.closeAllConnections();
      await new Promise<void>((resolve) => second!.close(() => resolve()));
    }
  }
});

test("Cloudflare connection lifecycle updates the public URL and copied instruction without leaking local URLs", async () => {
  const child = new EventEmitter() as ChildProcess;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(child, {
    stdout,
    stderr,
    exitCode: null,
    killed: false,
    kill: () => {
      queueMicrotask(() => child.emit("exit", 0));
      return true;
    },
  });
  let publish!: (ready: boolean) => void;
  const tunnel = new CloudflareTunnel({
    probe: () =>
      new Promise((resolve) => {
        publish = resolve;
      }),
    enabled: true,
    binary: async (onDownload) => {
      onDownload();
      return "fixture-cloudflared";
    },
    spawn: (_binary, args) => {
      assert(args.includes("http2"));
      assert(args.includes("--url"));
      return child;
    },
  });
  try {
    await tunnel.start(3000);
    stderr.write(
      "INF Your quick Tunnel has been created https://practice-fixture.trycloudflare.com\n",
    );
    assert.notEqual(tunnel.status().status, "ready");
    stderr.write("INF Registered tunnel ");
    stderr.write("connection connIndex=0 protocol=http2\n");
    assert.notEqual(tunnel.status().status, "ready");
    publish(true);
    await new Promise((resolve) => setImmediate(resolve));
    const status = tunnel.status();
    assert.equal(status.status, "ready");
    assert.equal(
      status.publicUrl,
      "https://practice-fixture.trycloudflare.com/mcp",
    );
    assert.match(
      status.chatgptUrl!,
      /^https:\/\/practice-fixture\.trycloudflare\.com\/mcp\/[a-f0-9]{64}$/,
    );
    assert.match(
      status.webUrl!,
      /^https:\/\/practice-fixture\.trycloudflare\.com\/app\/[a-f0-9]{64}$/,
    );
    assert.notEqual(
      status.webUrl!.split("/").at(-1),
      status.chatgptUrl!.split("/").at(-1),
    );
    const api = new ApiController({} as StudyService, tunnel);
    const details = api.connection({
      headers: { host: "localhost:3000" },
    } as Request);
    assert.equal(details.chatgptUrl, status.chatgptUrl);
    assert.equal(details.webUrl, status.webUrl);
    assert(details.prompt?.includes(status.chatgptUrl!));
    assert(details.prompt?.includes(`Authorization: Bearer ${localToken}`));
    assert(!/http:\/\/(?:localhost|127\.0\.0\.1)/.test(details.prompt!));
    assert(!details.prompt?.includes("OpenAI Platform browser"));
    child.emit("exit", 1);
    assert.equal(tunnel.status().status, "error");
    assert.equal(tunnel.status().webUrl, null);
    assert.equal(
      api.connection({ headers: { host: "localhost:3000" } } as Request).prompt,
      null,
    );
  } finally {
    await tunnel.stop();
  }
});
