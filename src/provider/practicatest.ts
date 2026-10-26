import { CookieJar } from "tough-cookie";
import { load } from "cheerio";
import { AppError } from "../server/errors.js";
import type { Permit, SessionStatus } from "../shared/contracts.js";
import {
  csrfToken,
  isAuthenticated,
  parseLinks,
  parseTest,
  SITE,
  siteUrl,
  testUrl,
  type ParsedTest,
} from "./parser.js";
import { parseRules, parseSections } from "./manual.js";

export class PracticaTest {
  private jar = new CookieJar();
  private csrf = "";
  private expires = 0;
  private readonly lifetime = 2 * 60 * 60 * 1000;
  private tracking = new Map<string, string>();
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  status(): SessionStatus {
    if (this.expires && Date.now() >= this.expires) this.logout();
    return {
      authenticated: this.expires > Date.now(),
      expiresAt: this.expires ? new Date(this.expires).toISOString() : null,
    };
  }
  requireSession() {
    if (!this.status().authenticated)
      throw new AppError(
        401,
        "LOGIN_REQUIRED",
        "Sign in to PracticaTest using the MCP login tool, npm run login, or the optional local web interface.",
      );
  }
  logout() {
    this.jar = new CookieJar();
    this.csrf = "";
    this.expires = 0;
    this.tracking.clear();
  }

  private async request(
    path: string,
    data?: Record<string, string>,
  ): Promise<string> {
    let url = siteUrl(path);
    let body = data ? new URLSearchParams(data).toString() : undefined;
    for (let hop = 0; hop < 5; hop++) {
      const cookie = await this.jar.getCookieString(url.href);
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: body === undefined ? "GET" : "POST",
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(20000),
          headers: {
            "User-Agent": "Mozilla/5.0 PracticaTestLocal/1.0",
            Accept: "text/html,application/json",
            Referer: `${SITE}/`,
            ...(cookie ? { Cookie: cookie } : {}),
            ...(this.csrf ? { "X-CSRF-TOKEN": this.csrf } : {}),
            ...(body !== undefined
              ? {
                  "Content-Type": "application/x-www-form-urlencoded",
                  "X-Requested-With": "XMLHttpRequest",
                  Origin: SITE,
                }
              : {}),
          },
        });
      } catch {
        throw new AppError(
          502,
          "SITE_UNREACHABLE",
          "PracticaTest is unreachable. Check your connection and try again.",
        );
      }
      for (const value of response.headers.getSetCookie())
        await this.jar.setCookie(value, url.href);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) break;
        url = siteUrl(new URL(location, url).href);
        if ([301, 302, 303].includes(response.status)) body = undefined;
        continue;
      }
      if (response.status === 401 || response.status === 419) {
        this.logout();
        throw new AppError(
          401,
          "SESSION_EXPIRED",
          "Your PracticaTest session has expired. Sign in again.",
        );
      }
      if (response.status === 403 || response.status === 429)
        throw new AppError(
          502,
          "SITE_BLOCKED",
          "PracticaTest has limited this request. Open the website manually and try again later.",
        );
      if (!response.ok)
        throw new AppError(
          502,
          "SITE_ERROR",
          `PracticaTest returned HTTP ${response.status}.`,
        );
      const text = await response.text();
      const token = csrfToken(text);
      if (token) this.csrf = token;
      return text;
    }
    throw new AppError(
      502,
      "SITE_REDIRECT",
      "Could not open the PracticaTest page.",
    );
  }
  private json(text: string): Record<string, unknown> {
    try {
      const value: unknown = JSON.parse(text);
      if (value && typeof value === "object" && !Array.isArray(value))
        return value as Record<string, unknown>;
    } catch {
      /* Return a safe message without the remote response. */
    }
    throw new AppError(
      502,
      "SITE_CHANGED",
      "The website returned an unexpected response.",
    );
  }
  async login(email: string, password: string) {
    this.logout();
    try {
      await this.request("/");
      const result = this.json(
        await this.request("/ajax/login", {
          "login-email": email,
          "login-password": password,
          "login-redirect": "",
        }),
      );
      if (!result.success)
        throw new AppError(
          401,
          "INVALID_CREDENTIALS",
          "Sign-in failed. Check your email and password on PracticaTest.",
        );
      const check = await this.request("/tests/permiso-B");
      if (!isAuthenticated(check))
        throw new AppError(
          401,
          "LOGIN_UNVERIFIED",
          "The website did not confirm authentication.",
        );
      this.expires = Date.now() + this.lifetime;
      return this.status();
    } catch (error) {
      this.logout();
      throw error;
    }
  }
  private async authenticatedPage(url: string) {
    this.requireSession();
    const html = await this.request(url);
    if (!isAuthenticated(html)) {
      this.logout();
      throw new AppError(
        401,
        "SESSION_EXPIRED",
        "Your website session has expired. Sign in again.",
      );
    }
    return html;
  }
  async list(
    permit: Permit,
    url?: string,
    language: "en" | "es" = "en",
    sectionId?: string,
  ) {
    if (sectionId) {
      if (url)
        throw new AppError(
          400,
          "INVALID_SELECTION",
          "Choose a section or a URL, not both.",
        );
      const section = await this.section(permit, language, sectionId);
      if (!section.testUrl)
        throw new AppError(
          403,
          "SECTION_TEST_PREMIUM_REQUIRED",
          "PracticaTest does not provide a test link for this section to your account. A Premium subscription may be required.",
        );
      return [{ title: section.title, url: section.testUrl }];
    }
    if (!url && language === "en" && permit !== "B")
      throw new AppError(
        400,
        "ENGLISH_B_ONLY",
        "English exams are available for category B in Spain. Select Spanish for other categories.",
      );
    const path = url
      ? testUrl(url).href
      : language === "en"
        ? `${SITE}/en/spanish-driving-test`
        : `${SITE}/tests/${permit === "puntos" ? "recuperacion-puntos" : `permiso-${permit}`}`;
    return parseLinks(await this.authenticatedPage(path), path);
  }
  async start(url: string): Promise<ParsedTest> {
    return parseTest(await this.authenticatedPage(testUrl(url, true).href));
  }
  async sections(permit: Permit = "B", language: "en" | "es" = "en") {
    if (language === "en" && permit !== "B")
      throw new AppError(
        400,
        "ENGLISH_B_ONLY",
        "English sections are available for category B in Spain.",
      );
    const path =
      language === "en"
        ? `${SITE}/en/book-theory-driving-test`
        : `${SITE}/temario/${permit === "puntos" ? "recuperacion-puntos" : `permiso-${permit}`}`;
    return parseSections(
      await this.authenticatedPage(path),
      path,
      permit,
      language,
    );
  }
  private async section(permit: Permit, language: "en" | "es", id: string) {
    const section = (await this.sections(permit, language)).find(
      (s) => s.id === id,
    );
    if (!section)
      throw new AppError(
        404,
        "SECTION_NOT_FOUND",
        "Manual section not found. Use list_sections to discover valid section IDs.",
      );
    return section;
  }
  async rules(
    permit: Permit,
    language: "en" | "es",
    sectionId: string,
    mode: "summary" | "full" = "summary",
  ) {
    const section = await this.section(permit, language, sectionId);
    const url = mode === "full" ? section.fullUrl : section.summaryUrl;
    if (!url)
      throw new AppError(
        403,
        "SECTION_RULES_PREMIUM_REQUIRED",
        "The full section is not available to this account. Request its summary or check your Premium subscription.",
      );
    return parseRules(await this.authenticatedPage(url), section, url, mode);
  }
  remember(runId: string, tracking: string) {
    this.tracking.set(runId, tracking);
  }
  async image(url: string, signal?: AbortSignal) {
    this.requireSession();
    const imageUrl = siteUrl(url);
    if (!imageUrl.pathname.startsWith("/static/img/test/"))
      throw new AppError(
        400,
        "INVALID_IMAGE",
        "Only question illustrations are supported.",
      );
    let response: Response;
    try {
      response = await this.fetcher(imageUrl, {
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
        headers: { "User-Agent": "Mozilla/5.0" },
      });
    } catch {
      throw new AppError(
        502,
        "IMAGE_UNREACHABLE",
        "Could not load the question illustration.",
      );
    }
    if (
      !response.ok ||
      Number(response.headers.get("content-length") ?? 0) > 5 * 1024 * 1024
    )
      throw new AppError(
        502,
        "INVALID_IMAGE",
        "The website returned an unsupported illustration.",
      );
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 5 * 1024 * 1024)
      throw new AppError(
        502,
        "IMAGE_TOO_LARGE",
        "The question illustration is too large.",
      );
    // The real site sometimes omits Content-Type. Detect supported formats from bytes.
    const mimeType = buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? "image/png"
      : buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
        ? "image/jpeg"
        : ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))
          ? "image/gif"
          : buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
              buffer.subarray(8, 12).toString("ascii") === "WEBP"
            ? "image/webp"
            : null;
    if (!mimeType)
      throw new AppError(
        502,
        "INVALID_IMAGE",
        "The website returned an unsupported illustration.",
      );
    return { mimeType, data: buffer.toString("base64") };
  }
  async explanation(test: ParsedTest, questionId: string) {
    this.requireSession();
    const q = test.questions.find((q) => q.id === questionId);
    if (!q?.code) return null;
    const html = await this.request("/ajax/dudas-permiso", {
      permiso_c: test.meta.permiso_c,
      codigo: q.code,
      numero: String(q.number),
      tipo: test.meta.tipo,
    });
    const $ = load(html);
    $("script,style").remove();
    return $.root().text().replace(/\s+/g, " ").trim();
  }
  async finish(
    runId: string,
    test: ParsedTest,
    selected: Map<string, string[]>,
    elapsedMinutes: number,
  ) {
    this.requireSession();
    const result = this.json(
      await this.request("/ajax/correccion", {
        ...test.meta,
        type_test: "clic",
        respuestas: test.questions
          .map((q) =>
            selected
              .get(q.id)!
              .map((id) => q.sourceIds[id])
              .join("-"),
          )
          .join("||"),
        order_answser: test.questions.map((q) => q.order).join("||"),
        enviar: "2",
        real_counter: String(elapsedMinutes),
        seguimiento: this.tracking.get(runId) ?? "",
      }),
    );
    if (result.success === false || result.error)
      throw new AppError(
        502,
        "SUBMISSION_REJECTED",
        "The website rejected the result. Check it on PracticaTest.",
      );
    this.tracking.delete(runId);
    // The site returns no stable public result schema. Never return its raw response or tokens.
    return { accepted: true };
  }
}
