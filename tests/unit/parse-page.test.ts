import { describe, expect, it } from "vitest";
import { parsePage } from "@/lib/parsing/parse-page";

const PAGE_URL = "https://acmeplumbing.example/";

describe("parsePage", () => {
  it("extracts title, meta description, and canonical", () => {
    const html = `
      <html><head>
        <title>Acme Plumbing — 24/7 Emergency Plumber</title>
        <meta name="description" content="Licensed plumbers serving the metro area." />
        <link rel="canonical" href="https://acmeplumbing.example/" />
      </head><body></body></html>
    `;
    const result = parsePage(html, PAGE_URL);

    expect(result.title).toBe("Acme Plumbing — 24/7 Emergency Plumber");
    expect(result.metaDescription).toBe("Licensed plumbers serving the metro area.");
    expect(result.canonicalUrl).toBe("https://acmeplumbing.example/");
  });

  it("returns null for missing title/meta/canonical instead of empty strings", () => {
    const result = parsePage("<html><head></head><body></body></html>", PAGE_URL);
    expect(result.title).toBeNull();
    expect(result.metaDescription).toBeNull();
    expect(result.canonicalUrl).toBeNull();
  });

  it("detects a noindex robots meta tag", () => {
    const html = `<html><head><meta name="robots" content="noindex, nofollow"></head></html>`;
    expect(parsePage(html, PAGE_URL).isNoIndex).toBe(true);
  });

  it("collects headings with their levels, in document order", () => {
    const html = `
      <html><body>
        <h1>Emergency Plumbing Services</h1>
        <h2>Residential</h2>
        <h2>Commercial</h2>
        <h3>Water Heater Repair</h3>
      </body></html>
    `;
    const result = parsePage(html, PAGE_URL);
    expect(result.headings).toEqual([
      { level: 1, text: "Emergency Plumbing Services" },
      { level: 2, text: "Residential" },
      { level: 2, text: "Commercial" },
      { level: 3, text: "Water Heater Repair" },
    ]);
  });

  it("keeps only same-origin links as internal links", () => {
    const html = `
      <html><body>
        <a href="/contact">Contact</a>
        <a href="https://acmeplumbing.example/about">About</a>
        <a href="https://facebook.com/acmeplumbing">Facebook</a>
        <a href="mailto:hello@acmeplumbing.example">Email</a>
      </body></html>
    `;
    const result = parsePage(html, PAGE_URL);
    const hrefs = result.internalLinks.map((link) => link.href);
    expect(hrefs).toContain("https://acmeplumbing.example/contact");
    expect(hrefs).toContain("https://acmeplumbing.example/about");
    expect(hrefs).not.toContain("https://facebook.com/acmeplumbing");
    expect(hrefs.some((href) => href.startsWith("mailto:"))).toBe(false);
  });

  it("distinguishes a missing alt attribute from an intentionally empty one", () => {
    const html = `
      <html><body>
        <img src="/hero.jpg" alt="Plumber fixing a sink" />
        <img src="/decorative.png" alt="" />
        <img src="/no-alt.png" />
      </body></html>
    `;
    const result = parsePage(html, PAGE_URL);
    expect(result.images).toEqual([
      { src: "https://acmeplumbing.example/hero.jpg", alt: "Plumber fixing a sink" },
      { src: "https://acmeplumbing.example/decorative.png", alt: "" },
      { src: "https://acmeplumbing.example/no-alt.png", alt: null },
    ]);
  });

  it("extracts JSON-LD structured data types, including inside @graph", () => {
    const html = `
      <html><head>
        <script type="application/ld+json">
          { "@context": "https://schema.org", "@graph": [
            { "@type": "LocalBusiness", "name": "Acme Plumbing" },
            { "@type": "FAQPage" }
          ]}
        </script>
      </head></html>
    `;
    const result = parsePage(html, PAGE_URL);
    expect(result.structuredData.jsonLdCount).toBe(1);
    expect(result.structuredData.jsonLdTypes.sort()).toEqual(["FAQPage", "LocalBusiness"]);
    expect(result.structuredData.parseErrors).toBe(0);
  });

  it("counts a malformed JSON-LD block as a parse error without throwing", () => {
    const html = `<script type="application/ld+json">{ not valid json </script>`;
    const result = parsePage(html, PAGE_URL);
    expect(result.structuredData.parseErrors).toBe(1);
    expect(result.structuredData.jsonLdTypes).toEqual([]);
  });

  it("detects microdata presence as a fallback signal", () => {
    const html = `<div itemscope itemtype="https://schema.org/LocalBusiness"></div>`;
    expect(parsePage(html, PAGE_URL).structuredData.hasMicrodata).toBe(true);
  });
});
