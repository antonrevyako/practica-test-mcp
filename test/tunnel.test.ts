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
    const api = new ApiController({} as StudyService, tunnel);
    const details = api.connection({
      headers: { host: "localhost:3000" },
    } as Request);
    assert.equal(details.chatgptUrl, status.chatgptUrl);
    assert(details.prompt?.includes(status.chatgptUrl!));
    assert(details.prompt?.includes(`Authorization: Bearer ${localToken}`));
    assert(!/http:\/\/(?:localhost|127\.0\.0\.1)/.test(details.prompt!));
    assert(!details.prompt?.includes("OpenAI Platform browser"));
    child.emit("exit", 1);
    assert.equal(tunnel.status().status, "error");
    assert.equal(
      api.connection({ headers: { host: "localhost:3000" } } as Request).prompt,
      null,
    );
  } finally {
    await tunnel.stop();
  }
});
