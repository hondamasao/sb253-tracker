import { describe, expect, it } from "vitest";
import { detectTechnicalIssues } from "@/lib/parsing/technical-issues";
import type { ParsedPage } from "@/lib/parsing/types";
import type { RobotsInfo, SitemapInfo, SslInfo } from "@/lib/crawler/types";

function page(overrides: Partial<ParsedPage> = {}): ParsedPage {
  return {
    url: "https://acmeplumbing.example/",
    title: "Acme Plumbing",
    metaDescription: "A description that is a totally reasonable length.",
    canonicalUrl: "https://acmeplumbing.example/",
    isNoIndex: false,
    headings: [{ level: 1, text: "Acme Plumbing" }],
    internalLinks: [],
    images: [],
    structuredData: { jsonLdTypes: [], jsonLdCount: 0, hasMicrodata: false, parseErrors: 0 },
    ...overrides,
  };
}

const goodRobots: RobotsInfo = {
  fetched: true,
  content: "User-agent: *\nAllow: /",
  sitemapUrls: [],
  homepageAllowed: true,
};
const goodSitemap: SitemapInfo = {
  fetched: true,
  sourceUrl: "https://acmeplumbing.example/sitemap.xml",
  urls: ["https://acmeplumbing.example/"],
  isIndex: false,
};
const goodSsl: SslInfo = {
  requestedHttps: true,
  finalUrlIsHttps: true,
  certificateValid: true,
  error: null,
};

describe("detectTechnicalIssues", () => {
  it("finds no issues for a clean page + clean site-level signals", () => {
    const issues = detectTechnicalIssues({
      pages: [page()],
      robots: goodRobots,
      sitemap: goodSitemap,
      ssl: goodSsl,
    });
    expect(issues).toEqual([]);
  });

  it("flags a missing title", () => {
    const issues = detectTechnicalIssues({
      pages: [page({ title: null })],
      robots: goodRobots,
      sitemap: goodSitemap,
      ssl: goodSsl,
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ type: "missing_title", severity: "high" }),
    );
  });

  it("flags a missing meta description", () => {
    const issues = detectTechnicalIssues({
      pages: [page({ metaDescription: null })],
      robots: goodRobots,
      sitemap: goodSitemap,
      ssl: goodSsl,
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ type: "missing_meta_description" }),
    );
  });

  it("flags zero H1s and more than one H1 differently", () => {
    const noH1 = detectTechnicalIssues({
      pages: [page({ headings: [{ level: 2, text: "Services" }] })],
      robots: goodRobots,
      sitemap: goodSitemap,
      ssl: goodSsl,
    });
    expect(noH1).toContainEqual(expect.objectContaining({ type: "missing_h1" }));

    const twoH1s = detectTechnicalIssues({
      pages: [
        page({
          headings: [
            { level: 1, text: "Acme Plumbing" },
            { level: 1, text: "Welcome" },
          ],
        }),
      ],
      robots: goodRobots,
      sitemap: goodSitemap,
      ssl: goodSsl,
    });
    expect(twoH1s).toContainEqual(expect.objectContaining({ type: "multiple_h1" }));
  });

  it("flags images missing alt text but not intentionally-empty alt", () => {
    const issues = detectTechnicalIssues({
      pages: [
        page({
          images: [
            { src: "/a.jpg", alt: null },
            { src: "/b.jpg", alt: "" },
            { src: "/c.jpg", alt: "A plumber" },
          ],
        }),
      ],
      robots: goodRobots,
      sitemap: goodSitemap,
      ssl: goodSsl,
    });
    const issue = issues.find((i) => i.type === "missing_alt_text");
    expect(issue?.detail).toContain("1 of 3");
  });

  it("flags a noindex tag as high severity", () => {
    const issues = detectTechnicalIssues({
      pages: [page({ isNoIndex: true })],
      robots: goodRobots,
      sitemap: goodSitemap,
      ssl: goodSsl,
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ type: "noindex_detected", severity: "high" }),
    );
  });

  it("flags duplicate titles across pages", () => {
    const issues = detectTechnicalIssues({
      pages: [
        page({ url: "https://acmeplumbing.example/" }),
        page({ url: "https://acmeplumbing.example/contact" }),
      ],
      robots: goodRobots,
      sitemap: goodSitemap,
      ssl: goodSsl,
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ type: "duplicate_title_across_pages" }),
    );
  });

  it("flags robots.txt disallowing the homepage as high severity", () => {
    const issues = detectTechnicalIssues({
      pages: [page()],
      robots: { ...goodRobots, homepageAllowed: false },
      sitemap: goodSitemap,
      ssl: goodSsl,
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ type: "robots_disallows_homepage", severity: "high" }),
    );
  });

  it("flags a missing sitemap as medium severity, not fetched robots as low", () => {
    const issues = detectTechnicalIssues({
      pages: [page()],
      robots: { fetched: false, content: null, sitemapUrls: [], homepageAllowed: true },
      sitemap: { fetched: false, sourceUrl: null, urls: [], isIndex: false },
      ssl: goodSsl,
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ type: "robots_txt_missing", severity: "low" }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ type: "sitemap_missing", severity: "medium" }),
    );
  });

  it("flags a site with no HTTPS as high severity", () => {
    const issues = detectTechnicalIssues({
      pages: [page()],
      robots: goodRobots,
      sitemap: goodSitemap,
      ssl: { requestedHttps: false, finalUrlIsHttps: false, certificateValid: false, error: null },
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ type: "ssl_missing", severity: "high" }),
    );
  });
});
