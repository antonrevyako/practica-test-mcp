import {
  All,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  answerSchema,
  credentialsSchema,
  languageSchema,
  permitSchema,
  sectionIdSchema,
  startSchema,
  workspacePreferencesSchema,
} from "../shared/contracts.js";
import { StudyService } from "./study.service.js";
import { createMcp } from "./mcp.js";
import { localToken } from "./security.js";
import { connectionPrompt } from "../../scripts/chatgpt-prompt.mjs";
import { CloudflareTunnel } from "../tunnel/cloudflare-tunnel.js";

const idSchema = z.uuid();
@Controller()
export class ApiController {
  constructor(
    @Inject(StudyService) private readonly study: StudyService,
    @Inject(CloudflareTunnel)
    private readonly tunnel: Pick<CloudflareTunnel, "status" | "retry">,
  ) {}
  @Get("api/health") health() {
    return { ok: true };
  }
  @Get("api/session") status() {
    return this.study.status();
  }
  @Post("api/session") login(@Body() body: unknown) {
    const data = credentialsSchema.parse(body);
    return this.study.login(data.email, data.password);
  }
  @Delete("api/session") logout() {
    return this.study.logout();
  }
  @Get("api/account/access") checkAccountAccess(
    @Query("permit") permit?: string,
    @Query("language") language?: string,
  ) {
    return this.study.checkAccountAccess(
      permitSchema.parse(permit ?? "B"),
      languageSchema.parse(language ?? "en"),
    );
  }
  @Get("api/preferences") preferences() {
    return this.study.getPreferences();
  }
  @Patch("api/preferences") updatePreferences(@Body() body: unknown) {
    return this.study.updatePreferences(workspacePreferencesSchema.parse(body));
  }
  @Get("api/connection") connection(@Req() req: Request) {
    const origin = `http://${req.headers.host}`;
    const port = Number(new URL(origin).port || 80);
    const tunnel = this.tunnel.status();
    return {
      token: localToken,
      path: "/mcp",
      localUrl: `${origin}/mcp`,
      publicUrl: tunnel.publicUrl,
      chatgptUrl: tunnel.chatgptUrl,
      webUrl: tunnel.webUrl,
      tunnel,
      claudeDesktopConfig:
        existsSync("/.dockerenv") || existsSync("/run/.containerenv")
          ? null
          : JSON.stringify(
              {
                mcpServers: {
                  practicatest: {
                    command: process.execPath,
                    args: [resolve("scripts/mcp-stdio.mjs")],
                    env: { PRACTICA_URL: origin },
                  },
                },
              },
              null,
              2,
            ),
      prompt: tunnel.chatgptUrl
        ? connectionPrompt(process.cwd(), port, {
            origin: new URL(tunnel.chatgptUrl).origin,
            token: localToken,
            publicUrl: tunnel.chatgptUrl,
          })
        : null,
    };
  }
  @Post("api/tunnel") retryTunnel() {
    return this.tunnel.retry();
  }
  @Get("api/tests") list(
    @Query("permit") permit?: string,
    @Query("url") url?: string,
    @Query("language") language?: string,
    @Query("sectionId") sectionId?: string,
  ) {
    return this.study.list(
      permitSchema.parse(permit ?? "B"),
      url === undefined ? undefined : z.url().max(2048).parse(url),
      languageSchema.parse(language ?? "en"),
      sectionId === undefined ? undefined : sectionIdSchema.parse(sectionId),
    );
  }
  @Post("api/attempts") start(@Body() body: unknown) {
    return this.study.startSelection(startSchema.parse(body));
  }
  @Get("api/sections") sections(
    @Query("permit") permit?: string,
    @Query("language") language?: string,
  ) {
    return this.study.sections(
      permitSchema.parse(permit ?? "B"),
      languageSchema.parse(language ?? "en"),
    );
  }
  @Get("api/sections/:section/rules") rules(
    @Param("section") section: string,
    @Query("permit") permit?: string,
    @Query("language") language?: string,
    @Query("mode") mode?: string,
  ) {
    return this.study.rules(
      permitSchema.parse(permit ?? "B"),
      languageSchema.parse(language ?? "en"),
      sectionIdSchema.parse(section),
      z.enum(["summary", "full"]).parse(mode ?? "summary"),
    );
  }
  @Get("api/attempts") history() {
    return this.study.history();
  }
  @Delete("api/attempts") clear() {
    return this.study.clear();
  }
  @Get("api/attempts/:id") get(@Param("id") id: string) {
    return this.study.get(idSchema.parse(id));
  }
  @Get("api/attempts/:id/next") next(@Param("id") id: string) {
    return this.study.next(idSchema.parse(id));
  }
  @Post("api/attempts/:id/answers") answer(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const a = answerSchema.parse(body);
    return this.study.answer(idSchema.parse(id), a.questionId, a.optionIds);
  }
  @Post("api/attempts/:id/finish") finish(@Param("id") id: string) {
    return this.study.finish(idSchema.parse(id));
  }
  @Get("api/attempts/:id/explanation/:question") explanation(
    @Param("id") id: string,
    @Param("question") question: string,
  ) {
    return this.study.explanation(
      idSchema.parse(id),
      z.string().max(80).parse(question),
    );
  }
  @All("mcp") async mcp(@Req() req: Request, @Res() res: Response) {
    const server = createMcp(this.study);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close().catch(() => {});
      void server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
}
