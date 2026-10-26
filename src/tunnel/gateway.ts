import { createServer, request, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";

function equal(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// cloudflared reaches this private listener, never the UI or administrative API.
export async function startGateway(
  appPort: number,
  bearerToken: string,
  accessKey: string,
): Promise<{ server: Server; url: string }> {
  const server = createServer((incoming, outgoing) => {
    outgoing.setHeader("Cache-Control", "no-store");
    outgoing.setHeader("Referrer-Policy", "no-referrer");
    outgoing.setHeader("X-Content-Type-Options", "nosniff");
    const url = new URL(incoming.url ?? "/", "http://localhost");
    const keyedPath = `/mcp/${accessKey}`;
    const keyAllowed = equal(url.pathname.replace(/\/$/, ""), keyedPath);
    const plainPath = /^\/mcp\/?$/.test(url.pathname);
    if ((!keyAllowed && !plainPath) || url.search) {
      outgoing.writeHead(404, { "Content-Type": "application/json" });
      outgoing.end('{"error":"NOT_FOUND"}');
      return;
    }
    if (
      !keyAllowed &&
      !equal(incoming.headers.authorization ?? "", `Bearer ${bearerToken}`)
    ) {
      outgoing.writeHead(401, {
        "Content-Type": "application/json",
        "WWW-Authenticate": "Bearer",
      });
      outgoing.end('{"error":"MCP_UNAUTHORIZED"}');
      return;
    }
    if (!["GET", "POST", "DELETE"].includes(incoming.method ?? "")) {
      outgoing.writeHead(405, { Allow: "GET, POST, DELETE" });
      outgoing.end();
      return;
    }
    const headers: Record<string, string> = {
      host: `127.0.0.1:${appPort}`,
      authorization: `Bearer ${bearerToken}`,
    };
    for (const name of [
      "accept",
      "content-type",
      "mcp-protocol-version",
      "mcp-session-id",
      "last-event-id",
    ]) {
      const value = incoming.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    const upstream = request(
      {
        hostname: "127.0.0.1",
        port: appPort,
        path: "/mcp",
        method: incoming.method,
        headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, {
          ...response.headers,
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        });
        response.pipe(outgoing);
      },
    );
    upstream.setTimeout(90000, () => upstream.destroy());
    upstream.on("error", () => {
      if (!outgoing.headersSent) {
        outgoing.writeHead(502, { "Content-Type": "application/json" });
        outgoing.end('{"error":"MCP_UNAVAILABLE"}');
      } else outgoing.destroy();
    });
    incoming.on("aborted", () => upstream.destroy());
    incoming.on("error", () => upstream.destroy());
    outgoing.on("close", () => {
      if (!outgoing.writableEnded) upstream.destroy();
    });
    incoming.pipe(upstream);
  });
  server.requestTimeout = 90000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    server,
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
  };
}
