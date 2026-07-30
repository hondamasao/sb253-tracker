import "server-only";
import * as cheerio from "cheerio";
import robotsParser from "robots-parser";
import { UnsafeUrlError, type UrlSafetyOptions } from "@/lib/ssrf-guard";
import { Deadline, DeadlineExceededError } from "@/lib/deadline";
import { safeFetch, type SafeFetchOptions } from "./safe-fetch";
import { fetchRobots, CRAWLER_USER_AGENT_TOKEN } from "./robots";
import { fetchSitemap } from "./sitemap";
import { discoverAdditionalPages } from "./discover-pages";
import { normalizeInputUrl } from "./normalize-url";
import type { CrawlResult, CrawledPage, FailedPage, RobotsInfo, SslInfo } from "./types";

const PAGE_FETCH_CONCURRENCY = 2;

/**
 * Whole-crawl wall-clock budget. Per-request timeouts alone never bounded
 * total time (see lib/deadline.ts); this is the number that does.
 */
export const MAX_CRAWL_WALL_CLOCK_MS = 60_000;

export class CrawlFailedError extends Error {}

/**
 * The site's own robots.txt told us not to crawl it. A distinct type
 * because this is a deliberate, correct refusal — not a fault — and the
 * user-facing message must say so rather than implying the site is broken.
 */
export class RobotsDisallowedError extends CrawlFailedError {}

export type CrawlOptions = UrlSafetyOptions & {
  deadline?: Deadline;
  maxWallClockMs?: number;
};

/**
 * Crawls a site end-to-end. Ordering matters and changed in M1c: robots.txt
 * is now fetched and honoured **before** the homepage, closing the M1a gap
 * where the homepage was fetched first and a disallow was merely reported
 * afterwards (see docs/19-m1c-security-and-evaluation.md §1). robots.txt
 * doubles as the scheme probe — it's the one URL never subject to robots
 * rules, so fetching it first costs nothing extra.
 *
 * Every network call shares one Deadline, so a slow site degrades the
 * crawl rather than extending it without bound.
 */
export async function crawlSite(
  websiteUrl: string,
  options: CrawlOptions = {},
): Promise<CrawlResult> {
  const crawledAt = new Date().toISOString();
  const deadline =
    options.deadline ?? new Deadline(options.maxWallClockMs ?? MAX_CRAWL_WALL_CLOCK_MS);
  const fetchOptions: SafeFetchOptions = { ...options, deadline };

  const normalizedInput = normalizeInputUrl(websiteUrl);
  let inputUrl: URL;
  try {
    inputUrl = new URL(normalizedInput);
  } catch {
    throw new CrawlFailedError(`"${websiteUrl}" is not a usable URL.`);
  }

  try {
    const probe = await probeOriginViaRobots(inputUrl, fetchOptions);

    // Honour robots BEFORE requesting any content from the site.
    if (probe.robots.fetched && !probe.robots.homepageAllowed) {
      throw new RobotsDisallowedError(
        `${probe.origin}/robots.txt disallows ${CRAWLER_USER_AGENT_TOKEN} from crawling the homepage. This site has asked not to be crawled, so no scan was performed.`,
      );
    }

    const { homepage, ssl, origin, robots } = probe.origin
      ? await fetchHomepageAtKnownOrigin(
          probe.origin,
          inputUrl,
          probe.robots,
          probe.primaryFailureReason,
          fetchOptions,
        )
      : await fetchHomepageWithSchemeFallback(inputUrl, fetchOptions);

    const sitemap = await fetchSitemap(origin, robots.sitemapUrls, fetchOptions);

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
      await fetchPagesWithConcurrency(additionalPageUrls, fetchOptions);

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
  } catch (error) {
    if (error instanceof DeadlineExceededError) {
      throw new CrawlFailedError(
        `Crawl exceeded its wall-clock budget before the required pages could be fetched: ${error.message}`,
      );
    }
    throw error;
  }
}

type OriginProbe = {
  origin: string | null;
  robots: RobotsInfo;
  /** Why the originally-requested scheme failed, when we fell back to the other one. */
  primaryFailureReason: string | null;
};

/**
 * Determines which scheme actually works for this site by fetching
 * robots.txt, and returns the robots rules at the same time.
 *
 * Returns `origin: null` when robots.txt was unreachable on both schemes.
 * That is not the same as "no robots rules" — it means the probe was
 * inconclusive, so the caller falls back to M1a's homepage-level scheme
 * retry. In that case there are, by definition, no robots rules we could
 * have honoured, so fetching the homepage first is not a violation.
 */
async function probeOriginViaRobots(
  inputUrl: URL,
  fetchOptions: SafeFetchOptions,
): Promise<OriginProbe> {
  const primary = await fetchRobots(inputUrl.origin, fetchOptions);
  if (primary.robots.originReachable) {
    return { origin: inputUrl.origin, robots: primary.robots, primaryFailureReason: null };
  }

  const fallbackUrl = new URL(inputUrl.toString());
  fallbackUrl.protocol = inputUrl.protocol === "https:" ? "http:" : "https:";

  const fallback = await fetchRobots(fallbackUrl.origin, fetchOptions);
  if (fallback.robots.originReachable) {
    return {
      origin: fallbackUrl.origin,
      robots: fallback.robots,
      primaryFailureReason: primary.unreachableReason,
    };
  }

  return {
    origin: null,
    robots: primary.robots,
    primaryFailureReason: primary.unreachableReason,
  };
}

type HomepageOutcome = {
  homepage: CrawledPage;
  ssl: SslInfo;
  origin: string;
  robots: RobotsInfo;
};

async function fetchHomepageAtKnownOrigin(
  origin: string,
  inputUrl: URL,
  robots: RobotsInfo,
  primaryFailureReason: string | null,
  fetchOptions: SafeFetchOptions,
): Promise<HomepageOutcome> {
  const homepageUrl = new URL(inputUrl.pathname + inputUrl.search, origin).toString();
  const homepage = await fetchAndBuildPage(homepageUrl, fetchOptions);
  const finalUrl = new URL(homepage.finalUrl);

  return {
    homepage,
    origin: finalUrl.origin,
    robots,
    ssl: {
      requestedHttps: inputUrl.protocol === "https:",
      finalUrlIsHttps: finalUrl.protocol === "https:",
      certificateValid: finalUrl.protocol === "https:",
      // Populated when https was tried first and failed — a site with no
      // working HTTPS is itself a real, reportable finding for a small
      // business, so the reason must survive the scheme fallback.
      error: inputUrl.protocol === "https:" ? primaryFailureReason : null,
    },
  };
}

/**
 * Only reached when robots.txt was unreachable on both schemes — the site
 * might still serve content while blocking /robots.txt at the network
 * level, so this preserves M1a's "try the other scheme once" behaviour
 * rather than declaring the site dead.
 */
async function fetchHomepageWithSchemeFallback(
  inputUrl: URL,
  fetchOptions: SafeFetchOptions,
): Promise<HomepageOutcome> {
  const unreachableRobots: RobotsInfo = {
    fetched: false,
    originReachable: false,
    content: null,
    sitemapUrls: [],
    homepageAllowed: true,
  };

  try {
    const homepage = await fetchAndBuildPage(inputUrl.toString(), fetchOptions);
    const finalUrl = new URL(homepage.finalUrl);
    return {
      homepage,
      origin: finalUrl.origin,
      robots: unreachableRobots,
      ssl: {
        requestedHttps: inputUrl.protocol === "https:",
        finalUrlIsHttps: finalUrl.protocol === "https:",
        certificateValid: finalUrl.protocol === "https:",
        error: null,
      },
    };
  } catch (firstError) {
    if (firstError instanceof UnsafeUrlError) {
      throw new CrawlFailedError(firstError.message);
    }
    if (firstError instanceof DeadlineExceededError) throw firstError;

    const fallbackUrl = new URL(inputUrl.toString());
    fallbackUrl.protocol = inputUrl.protocol === "https:" ? "http:" : "https:";

    try {
      const homepage = await fetchAndBuildPage(fallbackUrl.toString(), fetchOptions);
      const finalUrl = new URL(homepage.finalUrl);
      const firstErrorMessage =
        firstError instanceof Error ? firstError.message : String(firstError);
      return {
        homepage,
        origin: finalUrl.origin,
        robots: unreachableRobots,
        ssl: {
          requestedHttps: inputUrl.protocol === "https:",
          finalUrlIsHttps: finalUrl.protocol === "https:",
          certificateValid: fallbackUrl.protocol === "https:",
          error: inputUrl.protocol === "https:" ? firstErrorMessage : null,
        },
      };
    } catch (fallbackError) {
      if (fallbackError instanceof DeadlineExceededError) throw fallbackError;
      const firstMessage =
        firstError instanceof Error ? firstError.message : String(firstError);
      const fallbackMessage =
        fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new CrawlFailedError(
        `Could not fetch the homepage over ${inputUrl.protocol} (${firstMessage}) or ${fallbackUrl.protocol} (${fallbackMessage}).`,
      );
    }
  }
}

async function fetchAndBuildPage(
  url: string,
  fetchOptions: SafeFetchOptions,
): Promise<CrawledPage> {
  const result = await safeFetch(url, fetchOptions);
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
  fetchOptions: SafeFetchOptions,
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
        // Extra pages are best-effort: once the shared budget is spent we
        // stop rather than failing the whole crawl, since the homepage
        // (the only mandatory page) is already in hand.
        if (fetchOptions.deadline?.hasExpired()) {
          failed.push({ url, reason: "Crawl wall-clock budget exhausted before this page was fetched." });
          continue;
        }
        try {
          pages.push(await fetchAndBuildPage(url, fetchOptions));
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
