import { createServer, request, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";

function equal(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// MCP and browser access use separate capabilities on this private tunnel listener.
export type GatewayTarget = {
  port: number;
  token: string;
  hostname?: string;
  webEnabled?: boolean;
};
export async function startGateway(
  appPort: number,
  bearerToken: string,
  accessKey: string,
  webAccessKey?: string,
  options: { target?: () => GatewayTarget } = {},
): Promise<{ server: Server; url: string }> {
  const server = createServer((incoming, outgoing) => {
    const target = options.target?.() ?? { port: appPort, token: bearerToken };
    const browserKey = target.webEnabled === false ? undefined : webAccessKey;
    outgoing.setHeader("Cache-Control", "no-store");
    outgoing.setHeader("Referrer-Policy", "no-referrer");
    outgoing.setHeader("X-Content-Type-Options", "nosniff");
    outgoing.setHeader("X-Frame-Options", "DENY");
    if (!incoming.url?.startsWith("/") || incoming.url.startsWith("//")) {
      outgoing.writeHead(404);
      outgoing.end();
      return;
    }
    let url: URL;
    try {
      url = new URL(incoming.url, "http://localhost");
      if (url.origin !== "http://localhost")
        throw new Error("Invalid request target.");
    } catch {
      outgoing.writeHead(400, { "Content-Type": "application/json" });
      outgoing.end('{"error":"INVALID_REQUEST_TARGET"}');
      return;
    }
    const browserCookie = "__Host-practica_web";
    const cookieValue =
      (incoming.headers.cookie ?? "")
        .split(";")
        .map((value) => value.trim())
        .find((value) => value.startsWith(`${browserCookie}=`))
        ?.slice(browserCookie.length + 1) ?? "";
    if (
      browserKey &&
      incoming.method === "GET" &&
      !url.search &&
      equal(url.pathname, `/app/${browserKey}`)
    ) {
      outgoing.writeHead(303, {
        Location: "/",
        "Set-Cookie": `${browserCookie}=${browserKey}; Path=/; Secure; HttpOnly; SameSite=Lax`,
      });
      outgoing.end();
      return;
    }
    const browserAllowed = Boolean(
      browserKey && equal(cookieValue, browserKey),
    );
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(incoming.method ?? "");
    if (browserAllowed && unsafe) {
      let sameOrigin = incoming.headers["sec-fetch-site"] !== "cross-site";
      if (incoming.headers.origin) {
        try {
          const origin = new URL(incoming.headers.origin);
          sameOrigin =
            sameOrigin &&
            origin.host.toLowerCase() ===
              incoming.headers.host?.toLowerCase() &&
            (origin.protocol === "https:" ||
              (origin.protocol === "http:" &&
                ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)));
        } catch {
          sameOrigin = false;
        }
      }
      if (!sameOrigin) {
        outgoing.writeHead(403, { "Content-Type": "application/json" });
        outgoing.end('{"error":"ORIGIN_NOT_ALLOWED"}');
        return;
      }
    }
    const keyedPath = `/mcp/${accessKey}`;
    const keyAllowed = equal(url.pathname.replace(/\/$/, ""), keyedPath);
    const plainPath = /^\/mcp\/?$/.test(url.pathname);
    if (!browserAllowed && ((!keyAllowed && !plainPath) || url.search)) {
      outgoing.writeHead(404, { "Content-Type": "application/json" });
      outgoing.end('{"error":"NOT_FOUND"}');
      return;
    }
    if (
      !browserAllowed &&
      !keyAllowed &&
      !equal(incoming.headers.authorization ?? "", `Bearer ${target.token}`)
    ) {
      outgoing.writeHead(401, {
        "Content-Type": "application/json",
        "WWW-Authenticate": "Bearer",
      });
      outgoing.end('{"error":"MCP_UNAUTHORIZED"}');
      return;
    }
    const methods = browserAllowed
      ? ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"]
      : ["GET", "POST", "DELETE"];
    if (!methods.includes(incoming.method ?? "")) {
      outgoing.writeHead(405, { Allow: methods.join(", ") });
      outgoing.end();
      return;
    }
    const headers: Record<string, string> = {
      host: `127.0.0.1:${target.port}`,
      authorization: `Bearer ${target.token}`,
    };
    const forwarded = browserAllowed
      ? [
          "accept",
          "accept-encoding",
          "content-type",
          "content-length",
          "if-none-match",
          "if-modified-since",
          "range",
          "rsc",
          "next-router-state-tree",
          "next-router-prefetch",
          "next-url",
          "mcp-protocol-version",
          "mcp-session-id",
          "last-event-id",
        ]
      : [
          "accept",
          "content-type",
          "mcp-protocol-version",
          "mcp-session-id",
          "last-event-id",
        ];
    for (const name of forwarded) {
      const value = incoming.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    const upstream = request(
      {
        hostname: target.hostname ?? "127.0.0.1",
        port: target.port,
        path: keyAllowed
          ? "/mcp"
          : browserAllowed
            ? `${url.pathname}${url.search}`
            : "/mcp",
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
