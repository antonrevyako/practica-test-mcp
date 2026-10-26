import { load } from "cheerio";
import type { ManualSection, SectionRules } from "../shared/contracts.js";
import { AppError } from "../server/errors.js";
import { siteUrl } from "./parser.js";

const clean = (text: string) => text.replace(/\s+/g, " ").trim();
export function manualUrl(value: string): URL {
  const url = siteUrl(value);
  if (
    !/^\/(?:en\/book-theory-driving-test|temario\/(?:permiso-[A-Z0-9-]+|recuperacion-puntos))(?:\/|$)/.test(
      url.pathname,
    )
  )
    throw new AppError(
      400,
      "INVALID_MANUAL_URL",
      "Only driving manual URLs are supported.",
    );
  return url;
}
export function parseSections(
  html: string,
  pageUrl: string,
  permit: string,
  language: "en" | "es",
): ManualSection[] {
  const $ = load(html);
  const sections: ManualSection[] = [];
  $(".box_chapter").each((index, el) => {
    const card = $(el);
    let summaryUrl: string | null = null;
    let fullUrl: string | null = null;
    let testUrl: string | null = null;
    card.find("a[href]").each((_, a) => {
      const href = $(a).attr("href")!;
      if (href.startsWith("#")) return;
      let url: URL;
      try {
        url = siteUrl(new URL(href, pageUrl).href);
      } catch {
        return;
      }
      const label = clean($(a).text());
      if (/test/i.test(label)) {
        try {
          testUrl = siteUrl(url.href, true).href;
        } catch {
          /* Premium links are not accessible exam URLs. */
        }
        return;
      }
      try {
        manualUrl(url.href);
        if (!/\/\d+(?:\/full)?\/?$/.test(url.pathname)) return;
        if (/full|complet/i.test(label) || /\/full\/?$/.test(url.pathname))
          fullUrl = url.href;
        else summaryUrl = url.href;
      } catch {
        /* Skip plans, products and unrelated navigation. */
      }
    });
    if (!summaryUrl) return;
    const url = new URL(summaryUrl);
    const id = url.pathname.match(/\/(\d+)\/?$/)![1];
    const title = clean(card.find(".title-box").first().text());
    sections.push({
      id,
      number: Number(title.match(/^\d+/)?.[0] ?? index + 1),
      title: title.replace(/^\d+\.\s*/, ""),
      language,
      permit,
      summaryUrl,
      fullUrl,
      testUrl,
    });
  });
  if (!sections.length)
    throw new AppError(
      502,
      "MANUAL_CHANGED",
      "Could not find manual sections on the website.",
    );
  return sections;
}
export function parseRules(
  html: string,
  section: ManualSection,
  url: string,
  mode: "summary" | "full",
): SectionRules {
  const $ = load(html);
  const article = $(".content-blog").first();
  if (!article.length)
    throw new AppError(
      422,
      "RULES_UNAVAILABLE",
      "This section is not accessible or the website format has changed.",
    );
  article.find("script,style,iframe,form,button,.d-print-none").remove();
  const headings = article
    .find("h1,h2,h3,h4,h5")
    .map((_, h) => clean($(h).text()))
    .get()
    .filter(Boolean);
  const images: SectionRules["images"] = [];
  article.find("img").each((_, img) => {
    const src = $(img).attr("src") || $(img).attr("data-src");
    if (!src) return;
    try {
      images.push({
        url: siteUrl(new URL(src, url).href).href,
        alt: clean($(img).attr("alt") ?? ""),
      });
    } catch {
      /* Ignore third-party images. */
    }
  });
  const tables: string[][][] = [];
  article.find("table").each((_, table) => {
    const rows: string[][] = [];
    $(table)
      .find("tr")
      .each((_, row) => {
        rows.push(
          $(row)
            .find("th,td")
            .map((_, cell) => clean($(cell).text()))
            .get(),
        );
      });
    tables.push(rows);
  });
  article.find("br").replaceWith("\n");
  article.find("p,li,h1,h2,h3,h4,h5,tr,blockquote").each((_, el) => {
    $(el).append("\n\n");
  });
  const text = article
    .text()
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text && !images.length)
    throw new AppError(
      422,
      "RULES_UNAVAILABLE",
      "No accessible rules were found in this section.",
    );
  return {
    section,
    mode,
    url,
    title: clean($("h1").first().text()) || section.title,
    text,
    headings,
    images,
    tables,
  };
}
