import "./environment.js";
import "reflect-metadata";
import {
  Module,
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { createRequire } from "node:module";
import type { NextServer, NextServerOptions } from "next/dist/server/next.js";
import { z } from "zod";
import { Store } from "../db/database.js";
import { PracticaTest } from "../provider/practicatest.js";
import { SessionStore } from "../provider/session-store.js";
import { StudyService } from "./study.service.js";
import { ApiController } from "./api.controller.js";
import { AppError } from "./errors.js";
import { localGuard } from "./security.js";
import { CloudflareTunnel } from "../tunnel/cloudflare-tunnel.js";
import { TunnelClient } from "../tunnel/tunnel-client.js";

const dev = process.argv.includes("--dev");
const mcpOnly = process.argv.includes("--mcp-only");
if (!process.env.NODE_ENV)
  Object.assign(process.env, { NODE_ENV: dev ? "development" : "production" });

@Catch()
class SafeErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;
    if (error instanceof AppError)
      return res
        .status(error.status)
        .json({ error: error.code, message: error.message });
    // Do not echo Zod input, upstream responses or request bodies: they may contain credentials.
    if (error instanceof z.ZodError)
      return res.status(400).json({
        error: "INVALID_INPUT",
        message: "Check the format of the supplied data.",
      });
    if (error instanceof HttpException)
      return res.status(error.getStatus()).json({
        error: "HTTP_ERROR",
        message:
          error.getStatus() === 404
            ? "Endpoint not found."
            : "The request could not be processed.",
      });
    return res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Internal application error.",
    });
  }
}
@Module({
  controllers: [ApiController],
  providers: [
    StudyService,
    { provide: Store, useFactory: () => new Store() },
    {
      provide: PracticaTest,
      inject: [Store],
      useFactory: (store: Store) =>
        new PracticaTest(
          fetch,
          store.dataDirectory
            ? new SessionStore(
                store.dataDirectory,
                process.env.PERSIST_SESSION !== "false",
                process.env.PERSIST_CREDENTIALS !== "false",
              )
            : undefined,
        ),
    },
    { provide: CloudflareTunnel, useFactory: () => new TunnelClient() },
  ],
})
class AppModule {}

async function main() {
  const port = z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .parse(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";
  let web: NextServer | null = null;
  if (!mcpOnly) {
    const next = createRequire(import.meta.url)("next") as (
      options: NextServerOptions,
    ) => NextServer;
    web = next({ dev, hostname: host, port });
    await web.prepare();
  }
  const app = await NestFactory.create(AppModule, {
    logger: false,
    bodyParser: false,
  });
  app.use(localGuard(port));
  app.use(express.json({ limit: "16kb" }));
  app.use((req: Request, res: Response, nextMiddleware: NextFunction) => {
    const path = req.path.toLowerCase().replace(/\/+$/, "");
    if (path.startsWith("/api/") || path === "/mcp") return nextMiddleware();
    if (web) void web.getRequestHandler()(req, res);
    else
      res.status(404).json({
        error: "MCP_ONLY",
        message: "MCP-only mode is enabled. Use the /mcp endpoint.",
      });
  });
  app.useGlobalFilters(new SafeErrors());
  await app.init();
  const study = app.get(StudyService);
  const timer = setInterval(() => study.status(), 60000);
  timer.unref();
  await app.listen(port, host);
  void app.get<TunnelClient>(CloudflareTunnel).start(port, !mcpOnly);
  if (web) console.log(`PracticaTest Local: http://localhost:${port}`);
  console.log(`MCP: http://localhost:${port}/mcp`);
  console.log(
    "Sign in with npm run login. The stdio bridge pairs with this process automatically.",
  );
  const shutdown = async () => {
    clearInterval(timer);
    study.provider.dispose();
    await app.close();
    await web?.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}
main().catch((error: unknown) => {
  console.error(
    "Could not start the app. Check the port, SQLite and the production build.",
  );
  if (error instanceof Error) console.error(error.message);
  process.exit(1);
});
