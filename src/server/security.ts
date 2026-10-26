import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export const localToken =
  process.env.MCP_TOKEN || randomBytes(32).toString("hex");
export function bearerValid(value: string | undefined) {
  const a = Buffer.from(value ?? "");
  const b = Buffer.from(`Bearer ${localToken}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function localGuard(port: number) {
  const origins = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    `http://[::1]:${port}`,
  ]);
  const hosts = new Set([...origins].map((o) => new URL(o).host));
  return (req: Request, res: Response, next: NextFunction) => {
    const path = req.path.toLowerCase().replace(/\/+$/, "") || "/";
    if (!hosts.has(req.headers.host ?? ""))
      return void res.status(403).json({
        error: "INVALID_HOST",
        message: "Access is allowed through localhost only.",
      });
    const origin = req.headers.origin;
    if (
      (origin && !origins.has(origin)) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      return void res.status(403).json({
        error: "INVALID_ORIGIN",
        message: "Cross-origin requests are not allowed.",
      });
    if (path.startsWith("/api/") || path === "/mcp")
      res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (path === "/mcp" && !bearerValid(req.headers.authorization))
      return void res.status(401).json({
        error: "MCP_UNAUTHORIZED",
        message: "Use the Bearer token from the local interface.",
      });
    next();
  };
}
