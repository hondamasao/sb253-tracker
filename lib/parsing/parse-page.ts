import * as cheerio from "cheerio";
import type {
  Heading,
  ImageInfo,
  LinkInfo,
  ParsedPage,
  StructuredDataInfo,
} from "./types";

const MAX_LINKS_PER_PAGE = 50;
const MAX_IMAGES_PER_PAGE = 50;
const MAX_HEADINGS_PER_PAGE = 30;

/**
 * Extracts the structured facts a page contains — never the raw HTML
 * itself (see docs/17-m1-crawler-architecture.md §5). Pure function: HTML
 * string + its URL in, a plain-data ParsedPage out. No network, no
 * database — this is what makes it trivially unit-testable with static
 * HTML fixtures.
 */
export function parsePage(html: string, pageUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  const pageOrigin = safeOrigin(pageUrl);

  const title = normalizeText($("title").first().text()) || null;
  const metaDescription =
    normalizeText($('meta[name="description"]').attr("content")) || null;

  const canonicalHref = $('link[rel="canonical"]').attr("href");
  const canonicalUrl = canonicalHref ? resolveUrl(canonicalHref, pageUrl) : null;

  const robotsMeta = ($('meta[name="robots"]').attr("content") ?? "").toLowerCase();
  const isNoIndex = robotsMeta.includes("noindex");

  const headings: Heading[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    if (headings.length >= MAX_HEADINGS_PER_PAGE) return;
    const level = Number(el.tagName.slice(1));
    const text = normalizeText($(el).text());
    if (text && level >= 1 && level <= 6) {
      headings.push({ level: level as Heading["level"], text });
    }
  });

  const internalLinks: LinkInfo[] = [];
  $("a[href]").each((_, el) => {
    if (internalLinks.length >= MAX_LINKS_PER_PAGE) return;
    const href = $(el).attr("href");
    if (!href) return;
    const resolved = resolveUrl(href, pageUrl);
    if (!resolved) return;
    if (pageOrigin === null || safeOrigin(resolved) !== pageOrigin) return;
    internalLinks.push({ href: resolved, text: normalizeText($(el).text()) });
  });

  const images: ImageInfo[] = [];
  $("img").each((_, el) => {
    if (images.length >= MAX_IMAGES_PER_PAGE) return;
    const src = $(el).attr("src");
    if (!src) return;
    const alt = $(el).attr("alt");
    images.push({
      src: resolveUrl(src, pageUrl) ?? src,
      alt: alt === undefined ? null : alt,
    });
  });

  return {
    url: pageUrl,
    title,
    metaDescription,
    canonicalUrl,
    isNoIndex,
    headings,
    internalLinks,
    images,
    structuredData: parseStructuredData($),
  };
}

function parseStructuredData($: cheerio.CheerioAPI): StructuredDataInfo {
  const jsonLdTypes = new Set<string>();
  let jsonLdCount = 0;
  let parseErrors = 0;

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    jsonLdCount++;
    try {
      collectTypes(JSON.parse(raw), jsonLdTypes);
    } catch {
      parseErrors++;
    }
  });

  return {
    jsonLdTypes: Array.from(jsonLdTypes),
    jsonLdCount,
    hasMicrodata: $("[itemscope]").length > 0,
    parseErrors,
  };
}

function collectTypes(node: unknown, types: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectTypes(item, types);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const type = obj["@type"];
    if (typeof type === "string") types.add(type);
    if (Array.isArray(type)) {
      for (const t of type) if (typeof t === "string") types.add(t);
    }
    if (Array.isArray(obj["@graph"])) {
      for (const item of obj["@graph"]) collectTypes(item, types);
    }
  }
}

function normalizeText(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function resolveUrl(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
