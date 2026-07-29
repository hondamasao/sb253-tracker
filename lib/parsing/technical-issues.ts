import type { RobotsInfo, SitemapInfo, SslInfo } from "@/lib/crawler/types";
import type { ParsedPage } from "./types";

/**
 * A deterministic fact, not a written recommendation — e.g.
 * `{ type: "missing_meta_description", page: "/contact" }`, never a
 * sentence. Turning this into customer-facing prose is the Synthesis
 * Agent's job in a later milestone (see docs/16-report-quality-standard.md
 * and docs/17-m1-crawler-architecture.md §5) — M1 is explicitly forbidden
 * from writing that copy.
 */
export type TechnicalIssue = {
  type: string;
  severity: "high" | "medium" | "low";
  page?: string;
  detail?: string;
};

const TITLE_MAX_LENGTH = 60;
const META_DESCRIPTION_MAX_LENGTH = 160;

export function detectTechnicalIssues(params: {
  pages: ParsedPage[];
  robots: RobotsInfo;
  sitemap: SitemapInfo;
  ssl: SslInfo;
}): TechnicalIssue[] {
  const { pages, robots, sitemap, ssl } = params;
  const issues: TechnicalIssue[] = [];

  for (const page of pages) {
    if (!page.title) {
      issues.push({ type: "missing_title", severity: "high", page: page.url });
    } else if (page.title.length > TITLE_MAX_LENGTH) {
      issues.push({
        type: "title_too_long",
        severity: "low",
        page: page.url,
        detail: `${page.title.length} characters (recommended under ${TITLE_MAX_LENGTH}).`,
      });
    }

    if (!page.metaDescription) {
      issues.push({
        type: "missing_meta_description",
        severity: "medium",
        page: page.url,
      });
    } else if (page.metaDescription.length > META_DESCRIPTION_MAX_LENGTH) {
      issues.push({
        type: "meta_description_too_long",
        severity: "low",
        page: page.url,
        detail: `${page.metaDescription.length} characters (recommended under ${META_DESCRIPTION_MAX_LENGTH}).`,
      });
    }

    const h1Count = page.headings.filter((h) => h.level === 1).length;
    if (h1Count === 0) {
      issues.push({ type: "missing_h1", severity: "medium", page: page.url });
    } else if (h1Count > 1) {
      issues.push({
        type: "multiple_h1",
        severity: "low",
        page: page.url,
        detail: `${h1Count} H1 tags found.`,
      });
    }

    if (!page.canonicalUrl) {
      issues.push({ type: "missing_canonical", severity: "low", page: page.url });
    }

    if (page.isNoIndex) {
      issues.push({ type: "noindex_detected", severity: "high", page: page.url });
    }

    const missingAltCount = page.images.filter((img) => img.alt === null).length;
    if (missingAltCount > 0) {
      issues.push({
        type: "missing_alt_text",
        severity: "medium",
        page: page.url,
        detail: `${missingAltCount} of ${page.images.length} images missing alt text.`,
      });
    }
  }

  const pagesByTitle = new Map<string, string[]>();
  for (const page of pages) {
    if (!page.title) continue;
    const urls = pagesByTitle.get(page.title) ?? [];
    urls.push(page.url);
    pagesByTitle.set(page.title, urls);
  }
  for (const [title, urls] of pagesByTitle) {
    if (urls.length > 1) {
      issues.push({
        type: "duplicate_title_across_pages",
        severity: "medium",
        detail: `"${title}" used on ${urls.length} pages: ${urls.join(", ")}`,
      });
    }
  }

  if (!robots.fetched) {
    issues.push({ type: "robots_txt_missing", severity: "low" });
  } else if (!robots.homepageAllowed) {
    issues.push({ type: "robots_disallows_homepage", severity: "high" });
  }

  if (!sitemap.fetched) {
    issues.push({ type: "sitemap_missing", severity: "medium" });
  }

  if (!ssl.finalUrlIsHttps) {
    issues.push({ type: "ssl_missing", severity: "high" });
  } else if (!ssl.certificateValid) {
    issues.push({
      type: "ssl_certificate_invalid",
      severity: "high",
      detail: ssl.error ?? undefined,
    });
  }

  return issues;
}
