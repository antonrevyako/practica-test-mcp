import { load } from "cheerio";
import type { Question, TestLink } from "../shared/contracts.js";
import { AppError } from "../server/errors.js";

export const SITE = "https://practicatest.com";
export type InternalQuestion = Question & {
  sourceIds: Record<string, string>;
  correctOptionIds: string[];
  order: string;
  code: string | null;
};
export type TestMeta = {
  pais: string;
  lang: string;
  permiso_c: string;
  tipo: string;
  mode_test: string;
  id_test: string;
  type_test: string;
};
export type ParsedTest = {
  title: string;
  questions: InternalQuestion[];
  meta: TestMeta;
  tracking: string;
};
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export function siteUrl(value: string, testsOnly = false): URL {
  const url = new URL(value, SITE);
  if (
    url.origin !== SITE ||
    url.username ||
    url.password ||
    (testsOnly &&
      !/^\/(?:tests(?:\/|$)|en\/?$|en\/spanish-driving-test(?:\/|$))/.test(
        url.pathname,
      ))
  ) {
    throw new AppError(
      400,
      "INVALID_URL",
      "Only practicatest.com test URLs are allowed.",
    );
  }
  url.hash = "";
  return url;
}
export function testUrl(value: string, openExam = false): URL {
  const url = siteUrl(value, true);
  if (/^\/en\/?$/.test(url.pathname)) url.pathname = "/en/spanish-driving-test";
  if (openExam && /^\/en\/spanish-driving-test\/?$/.test(url.pathname))
    url.pathname = "/en/spanish-driving-test/online";
  return url;
}
export function csrfToken(html: string): string {
  return load(html)('meta[name="csrf-token"]').attr("content") ?? "";
}
export function isAuthenticated(html: string): boolean {
  return /\bvar\s+is_logged\s*=\s*true\b/.test(html);
}
export function parseLinks(html: string, pageUrl: string): TestLink[] {
  const $ = load(html);
  const links = new Map<string, TestLink>();
  const root = new URL(pageUrl).pathname.match(
    /^\/(?:en\/spanish-driving-test|tests\/[^/]+)/,
  )?.[0];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#")) return;
    try {
      const url = siteUrl(new URL(href, pageUrl).href, true);
      if (root && url.pathname !== root && !url.pathname.startsWith(`${root}/`))
        return;
      const title = clean($(el).text());
      if (title && url.pathname.split("/").filter(Boolean).length >= 3)
        links.set(url.href, { title, url: url.href });
    } catch {
      /* Navigation and external links are not test entries. */
    }
  });
  return [...links.values()];
}
export function parseTest(html: string): ParsedTest {
  const $ = load(html);
  // Read literal strings only. Never execute scripts received from the site.
  const literal = (key: string) => {
    const pattern = new RegExp(
      "\\b(?:var|let|const)\\s+" +
        key +
        '\\s*=\\s*(["\x27])([^"\x27\\r\\n]*)\\1\\s*;',
    );
    return html.match(pattern)?.[2] ?? "";
  };
  const questions: InternalQuestion[] = [];
  $('#content-test [id^="quest_"]').each((_, el) => {
    const card = $(el);
    const number = Number(card.attr("id")?.replace("quest_", ""));
    if (!number || !card.find(".test_simple").length) return;
    const sourceIds: Record<string, string> = {};
    const correctOptionIds: string[] = [];
    const options: Question["options"] = [];
    card.find(".test_simple > li").each((index, li) => {
      const sourceId = $(li).attr("id") ?? "";
      if (!/^\d{8,30}$/.test(sourceId))
        throw new AppError(
          502,
          "SITE_CHANGED",
          "The website answer format has changed.",
        );
      const id = String.fromCharCode(65 + index);
      sourceIds[id] = sourceId;
      if (Number(sourceId.at(-1)) > 0) correctOptionIds.push(id);
      options.push({
        id,
        text: clean($(li).find("a").first().text() || $(li).text()).replace(
          /^[A-Z][).]\s*/,
          "",
        ),
      });
    });
    const text = clean(
      card.find("h4 span").last().text() || card.find("h4").first().text(),
    ).replace(/^\d+\.\s*/, "");
    if (!text || options.length < 2 || !correctOptionIds.length)
      throw new AppError(502, "SITE_CHANGED", "Could not parse the question.");
    const src = card.find(".watermarked img").first().attr("src");
    let imageUrl: string | null = null;
    if (src) {
      try {
        imageUrl = siteUrl(src).href;
      } catch {
        /* Ignore unknown image hosts. */
      }
    }
    const onclick =
      card
        .find('[onclick*="enviar_duda"], [onclick*="save_favourite"]')
        .first()
        .attr("onclick") ?? "";
    const code =
      onclick.match(
        /(?:enviar_duda|save_favourite)\(['"][^'"]+['"],\s*['"]([^'"]+)['"]/,
      )?.[1] ?? null;
    questions.push({
      id: `q${number}`,
      number,
      text,
      imageUrl,
      options,
      multiple: correctOptionIds.length > 1,
      sourceIds,
      correctOptionIds,
      order: clean(card.find(".order_answer").text()),
      code,
    });
  });
  if (!questions.length || !literal("tipo")) {
    throw new AppError(
      422,
      "NOT_A_TEST",
      "No accessible test was found on this page. Choose an exam link; access depends on your subscription.",
    );
  }
  return {
    title: clean($("h1").first().text() || $("title").text()),
    questions,
    meta: {
      pais: literal("pais") || "ES",
      lang: literal("lang") || "es",
      permiso_c: literal("permiso_c"),
      tipo: literal("tipo"),
      mode_test: literal("mode_test"),
      id_test: literal("id_test"),
      type_test: $(".bt-corregir").first().attr("id") || "clic",
    },
    tracking: literal("seguimiento"),
  };
}
export function publicQuestion(question: InternalQuestion): Question {
  const { id, number, text, imageUrl, options, multiple } = question;
  return { id, number, text, imageUrl, options, multiple };
}
