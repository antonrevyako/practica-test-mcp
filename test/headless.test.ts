import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ConnectionInfo } from "../src/shared/contracts.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("headless MCP starts without a UI, pairs stdio automatically and survives token rotation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "practica-headless-"));
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    DATABASE_PATH: join(directory, "test.sqlite"),
    NODE_ENV: "production",
    TUNNEL_ENABLED: "false",
  };
  delete env.MCP_TOKEN;
  let child: ChildProcess | undefined;
  const start = async () => {
    child = spawn(
      process.execPath,
      [
        resolve("node_modules/tsx/dist/cli.mjs"),
        resolve("src/server/main.ts"),
        "--mcp-only",
      ],
      { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout!.on("data", (data) => {
      output += data;
    });
    child.stderr!.on("data", (data) => {
      output += data;
    });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null)
        throw new Error(`Headless process exited: ${output}`);
      try {
        if ((await fetch(`${base}/api/health`)).ok) return;
      } catch {
        /* Wait for the local listener. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Headless server did not start: ${output}`);
  };
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    const exiting = once(child, "exit");
    child.kill("SIGTERM");
    const timer = setTimeout(() => child?.kill("SIGKILL"), 5000);
    timer.unref();
    await exiting;
    clearTimeout(timer);
  };
  const client = new Client({ name: "headless-integration", version: "1.0.0" });
  try {
    await start();
    assert.equal((await fetch(base)).status, 404);
    assert.equal((await fetch(`${base}/mcp`)).status, 401);
    const stdioEnv: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          entry[1] !== undefined && entry[0] !== "MCP_TOKEN",
      ),
    );
    const connectionResponse = await fetch(`${base}/api/connection`);
    assert.equal(connectionResponse.headers.get("cache-control"), "no-store");
    const connection = (await connectionResponse.json()) as ConnectionInfo;
    const inContainer =
      existsSync("/.dockerenv") || existsSync("/run/.containerenv");
    assert.equal(connection.claudeDesktopConfig === null, inContainer);
    const desktop = connection.claudeDesktopConfig
      ? JSON.parse(connection.claudeDesktopConfig).mcpServers.practicatest
      : {
          command: process.execPath,
          args: [resolve("scripts/mcp-stdio.mjs")],
          env: { PRACTICA_URL: base },
        };
    assert.equal(desktop.command, process.execPath);
    assert.deepEqual(desktop.args, [resolve("scripts/mcp-stdio.mjs")]);
    assert.deepEqual(desktop.env, { PRACTICA_URL: base });
    assert(!connection.claudeDesktopConfig?.includes(connection.token));
    await client.connect(
      new StdioClientTransport({
        ...desktop,
        env: { ...stdioEnv, ...desktop.env },
        stderr: "pipe",
      }),
    );
    assert(
      (await client.listTools()).tools.some(
        (tool) => tool.name === "get_section_rules",
      ),
    );
    const status = async () => {
      const result = await client.callTool({
        name: "session_status",
        arguments: {},
      });
      assert(!result.isError);
      return JSON.parse((result.content as { text: string }[])[0].text);
    };
    assert.equal((await status()).authenticated, false);
    const archive = await client.callTool({
      name: "get_statistics",
      arguments: {},
    });
    assert(!archive.isError);
    assert.equal(
      JSON.parse((archive.content as { text: string }[])[0].text).answerEvents,
      0,
    );
    const response = await fetch(`${base}/api/connection`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const before = (await response.json()) as {
      token: string;
      prompt: string | null;
      localUrl: string;
    };
    assert.equal(before.prompt, null);
    assert.equal(before.localUrl, `${base}/mcp`);
    await stop();
    await start();
    const after = (await (await fetch(`${base}/api/connection`)).json()) as {
      token: string;
      prompt: string | null;
    };
    assert.notEqual(before.token, after.token);
    assert.equal(after.prompt, null);
    assert.equal((await status()).authenticated, false);
  } finally {
    await client.close();
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});
