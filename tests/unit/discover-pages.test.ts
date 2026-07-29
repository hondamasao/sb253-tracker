import { describe, expect, it } from "vitest";
import { discoverAdditionalPages } from "@/lib/crawler/discover-pages";

const origin = "https://acmeplumbing.example";
const homepageUrl = "https://acmeplumbing.example/";
const allow = () => true;

describe("discoverAdditionalPages", () => {
  it("matches sitemap URLs containing important-page keywords", () => {
    const result = discoverAdditionalPages({
      origin,
      homepageUrl,
      sitemapUrls: [
        "https://acmeplumbing.example/contact",
        "https://acmeplumbing.example/blog/2024/some-post",
      ],
      navLinks: [],
      isAllowed: allow,
    });
    expect(result).toEqual(["https://acmeplumbing.example/contact"]);
  });

  it("matches nav links by href or link text", () => {
    const result = discoverAdditionalPages({
      origin,
      homepageUrl,
      sitemapUrls: [],
      navLinks: [
        { href: "/team", text: "About Us" },
        { href: "/blog", text: "Blog" },
      ],
      isAllowed: allow,
    });
    expect(result).toEqual(["https://acmeplumbing.example/team"]);
  });

  it("never returns off-origin links even if they match a keyword", () => {
    const result = discoverAdditionalPages({
      origin,
      homepageUrl,
      sitemapUrls: [],
      navLinks: [{ href: "https://evil.example/contact", text: "Contact" }],
      isAllowed: allow,
    });
    expect(result).toEqual([]);
  });

  it("excludes the homepage itself even if it happens to match a keyword", () => {
    const result = discoverAdditionalPages({
      origin,
      homepageUrl: "https://acmeplumbing.example/services",
      sitemapUrls: ["https://acmeplumbing.example/services"],
      navLinks: [],
      isAllowed: allow,
    });
    expect(result).toEqual([]);
  });

  it("caps additional pages at 4 even when more candidates match", () => {
    const sitemapUrls = [
      "https://acmeplumbing.example/contact",
      "https://acmeplumbing.example/about",
      "https://acmeplumbing.example/services",
      "https://acmeplumbing.example/pricing",
      "https://acmeplumbing.example/locations",
    ];
    const result = discoverAdditionalPages({
      origin,
      homepageUrl,
      sitemapUrls,
      navLinks: [],
      isAllowed: allow,
    });
    expect(result).toHaveLength(4);
  });

  it("filters out candidates disallowed by robots.txt", () => {
    const result = discoverAdditionalPages({
      origin,
      homepageUrl,
      sitemapUrls: ["https://acmeplumbing.example/contact"],
      navLinks: [],
      isAllowed: (url) => !url.includes("/contact"),
    });
    expect(result).toEqual([]);
  });

  it("prefers sitemap matches over nav-link matches for the same URL", () => {
    const result = discoverAdditionalPages({
      origin,
      homepageUrl,
      sitemapUrls: ["https://acmeplumbing.example/contact"],
      navLinks: [{ href: "/contact", text: "Contact" }],
      isAllowed: allow,
    });
    expect(result).toEqual(["https://acmeplumbing.example/contact"]);
  });
});
