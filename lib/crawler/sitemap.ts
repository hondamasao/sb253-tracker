import "server-only";
import * as cheerio from "cheerio";
import { safeFetch, FetchFailedError } from "./safe-fetch";
import type { SitemapInfo } from "./types";
import type { UrlSafetyOptions } from "@/lib/ssrf-guard";

const MAX_URLS_TO_COLLECT = 200;
const MAX_CHILD_SITEMAPS_TO_FOLLOW = 2;

/**
 * Fetches and parses a sitemap, trying each candidate URL (from
 * robots.txt's `Sitemap:` directives, falling back to the conventional
 * `/sitemap.xml`) until one works. Handles sitemap index files by
 * following a capped number of child sitemaps — never a full recursive
 * crawl of a site's entire sitemap tree (see "avoid crawling too much" in
 * docs/17-m1-crawler-architecture.md §2).
 */
export async function fetchSitemap(
  origin: string,
  candidateUrls: string[],
  options: UrlSafetyOptions = {},
): Promise<SitemapInfo> {
  const urlsToTry =
    candidateUrls.length > 0
      ? candidateUrls
      : [new URL("/sitemap.xml", origin).toString()];

  for (const sitemapUrl of urlsToTry) {
    const result = await tryFetchSitemap(sitemapUrl, options, 0);
    if (result) return result;
  }

  return { fetched: false, sourceUrl: null, urls: [], isIndex: false };
}

async function tryFetchSitemap(
  sitemapUrl: string,
  options: UrlSafetyOptions,
  depth: number,
): Promise<SitemapInfo | null> {
  try {
    const response = await safeFetch(sitemapUrl, { ...options, timeoutMs: 8_000 });
    if (response.status >= 400) return null;

    const $ = cheerio.load(response.body, { xmlMode: true });
    const isIndex = $("sitemapindex").length > 0;

    if (isIndex) {
      // Only one level of index-following — a sitemap index pointing at
      // another index is unusual enough not to be worth chasing further.
      const childSitemapUrls =
        depth === 0
          ? $("sitemap > loc")
              .map((_, el) => $(el).text().trim())
              .get()
              .filter(Boolean)
              .slice(0, MAX_CHILD_SITEMAPS_TO_FOLLOW)
          : [];

      const collected: string[] = [];
      for (const childUrl of childSitemapUrls) {
        if (collected.length >= MAX_URLS_TO_COLLECT) break;
        const child = await tryFetchSitemap(childUrl, options, depth + 1);
        if (child) collected.push(...child.urls);
      }

      return {
        fetched: true,
        sourceUrl: sitemapUrl,
        urls: collected.slice(0, MAX_URLS_TO_COLLECT),
        isIndex: true,
      };
    }

    const urls = $("url > loc")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .slice(0, MAX_URLS_TO_COLLECT);

    return { fetched: true, sourceUrl: sitemapUrl, urls, isIndex: false };
  } catch (error) {
    if (error instanceof FetchFailedError) return null;
    throw error;
  }
}
