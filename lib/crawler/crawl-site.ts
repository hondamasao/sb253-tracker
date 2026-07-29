import "server-only";
import * as cheerio from "cheerio";
import robotsParser from "robots-parser";
import { assertSafeUrl, UnsafeUrlError, type UrlSafetyOptions } from "@/lib/ssrf-guard";
import { safeFetch } from "./safe-fetch";
import { fetchRobots, CRAWLER_USER_AGENT_TOKEN } from "./robots";
import { fetchSitemap } from "./sitemap";
import { discoverAdditionalPages } from "./discover-pages";
import { normalizeInputUrl } from "./normalize-url";
import type { CrawlResult, CrawledPage, FailedPage, SslInfo } from "./types";

const PAGE_FETCH_CONCURRENCY = 2;

export class CrawlFailedError extends Error {}

/**
 * Crawls a site end-to-end: validates the URL, fetches the homepage
 * (falling back to the other scheme once if the first attempt fails
 * outright — see below), fetches robots.txt + sitemap.xml, discovers a
 * handful of additional important pages, and fetches those too. Returns
 * one plain-data CrawlResult that every analyzer reads from — see
 * docs/17-m1-crawler-architecture.md for the full design rationale.
 */
export async function crawlSite(
  websiteUrl: string,
  options: UrlSafetyOptions = {},
): Promise<CrawlResult> {
  const crawledAt = new Date().toISOString();
  const normalizedInput = normalizeInputUrl(websiteUrl);

  const { homepage, ssl, homepageUrl } = await fetchHomepageWithSchemeFallback(
    normalizedInput,
    options,
  );

  const origin = homepageUrl.origin;

  const robots = await fetchRobots(origin, options);
  const sitemap = await fetchSitemap(origin, robots.sitemapUrls, options);

  const robotsChecker =
    robots.fetched && robots.content
      ? robotsParser(new URL("/robots.txt", origin).toString(), robots.content)
      : null;
  const isAllowed = (url: string) =>
    robotsChecker ? (robotsChecker.isAllowed(url, CRAWLER_USER_AGENT_TOKEN) ?? true) : true;

  const $ = cheerio.load(homepage.html);
  const navLinks = $("a[href]")
    .map((_, el) => ({
      href: $(el).attr("href") ?? "",
      text: $(el).text().trim(),
    }))
    .get()
    .filter((link) => link.href.length > 0);

  const additionalPageUrls = discoverAdditionalPages({
    origin,
    homepageUrl: homepage.finalUrl,
    sitemapUrls: sitemap.urls,
    navLinks,
    isAllowed,
  });

  const { pages: additionalPages, failed: failedPages } =
    await fetchPagesWithConcurrency(additionalPageUrls, options);

  return {
    requestedUrl: websiteUrl,
    homepage,
    additionalPages,
    failedPages,
    robots,
    sitemap,
    ssl,
    crawledAt,
  };
}

async function fetchHomepageWithSchemeFallback(
  normalizedInput: string,
  options: UrlSafetyOptions,
): Promise<{ homepage: CrawledPage; ssl: SslInfo; homepageUrl: URL }> {
  const firstAttempt = new URL(normalizedInput);

  try {
    const homepageUrl = await assertSafeUrl(normalizedInput, options);
    const homepage = await fetchAndBuildPage(homepageUrl.toString(), options);
    return {
      homepage,
      ssl: buildSslInfo(firstAttempt, homepage),
      homepageUrl: new URL(homepage.finalUrl),
    };
  } catch (firstError) {
    if (firstError instanceof UnsafeUrlError) {
      throw new CrawlFailedError(firstError.message);
    }

    // The site might genuinely not support the scheme we guessed (or the
    // one the user typed) — e.g. no valid HTTPS at all, which is itself a
    // real, common, worth-reporting finding for a small business site, not
    // just a dead end. Try the other scheme once before giving up.
    const fallbackScheme = firstAttempt.protocol === "https:" ? "http:" : "https:";
    const fallbackUrl = new URL(normalizedInput);
    fallbackUrl.protocol = fallbackScheme;

    try {
      const validatedFallback = await assertSafeUrl(fallbackUrl.toString(), options);
      const homepage = await fetchAndBuildPage(validatedFallback.toString(), options);
      const firstErrorMessage =
        firstError instanceof Error ? firstError.message : String(firstError);
      return {
        homepage,
        ssl: {
          requestedHttps: firstAttempt.protocol === "https:",
          finalUrlIsHttps: new URL(homepage.finalUrl).protocol === "https:",
          certificateValid: fallbackScheme === "https:",
          error: firstAttempt.protocol === "https:" ? firstErrorMessage : null,
        },
        homepageUrl: new URL(homepage.finalUrl),
      };
    } catch (fallbackError) {
      const firstMessage =
        firstError instanceof Error ? firstError.message : String(firstError);
      const fallbackMessage =
        fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new CrawlFailedError(
        `Could not fetch the homepage over ${firstAttempt.protocol} (${firstMessage}) or ${fallbackScheme} (${fallbackMessage}).`,
      );
    }
  }
}

async function fetchAndBuildPage(
  url: string,
  options: UrlSafetyOptions,
): Promise<CrawledPage> {
  const result = await safeFetch(url, options);
  return {
    requestedUrl: url,
    finalUrl: result.finalUrl,
    status: result.status,
    redirected: result.redirected,
    htmlByteLength: Buffer.byteLength(result.body),
    fetchedAt: new Date().toISOString(),
    html: result.body,
  };
}

async function fetchPagesWithConcurrency(
  urls: string[],
  options: UrlSafetyOptions,
): Promise<{ pages: CrawledPage[]; failed: FailedPage[] }> {
  const pages: CrawledPage[] = [];
  const failed: FailedPage[] = [];
  const queue = [...urls];

  const workers = Array.from(
    { length: Math.min(PAGE_FETCH_CONCURRENCY, queue.length) },
    async () => {
      for (;;) {
        const url = queue.shift();
        if (!url) return;
        try {
          pages.push(await fetchAndBuildPage(url, options));
        } catch (error) {
          failed.push({
            url,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
  );

  await Promise.all(workers);
  return { pages, failed };
}

function buildSslInfo(requestedUrl: URL, homepage: CrawledPage): SslInfo {
  const finalUrl = new URL(homepage.finalUrl);
  return {
    requestedHttps: requestedUrl.protocol === "https:",
    finalUrlIsHttps: finalUrl.protocol === "https:",
    certificateValid: finalUrl.protocol === "https:",
    error: null,
  };
}
