import "server-only";
import robotsParser from "robots-parser";
import { safeFetch, FetchFailedError, type SafeFetchOptions } from "./safe-fetch";
import { DeadlineExceededError } from "@/lib/deadline";
import type { RobotsInfo } from "./types";

const MAX_ROBOTS_BYTES_TO_KEEP = 10_000;
export const CRAWLER_USER_AGENT_TOKEN = "GrowthOSBot";

/**
 * Fetches and parses robots.txt for a site's origin. A missing (404) or
 * blocked (403) robots.txt is not an error — it means "no restrictions we
 * know of," which is the overwhelmingly common case and shouldn't fail
 * the scan.
 *
 * `originReachable` distinguishes the two failure modes that M1a
 * collapsed together, and M1c needs apart: a 404 (origin is up, no
 * robots file) versus a DNS/TCP/TLS failure (origin is not usable at all
 * on this scheme). The crawler uses robots.txt as its scheme probe — it's
 * the one URL that is never itself subject to robots rules — so it has to
 * be able to tell "no rules" from "wrong scheme".
 */
export type RobotsProbeResult = {
  robots: RobotsInfo;
  /**
   * Why the origin couldn't be reached at all, when it couldn't. The
   * crawler surfaces this as `ssl.error` after a scheme fallback, so "we
   * tried https first and here's exactly why it failed" survives into the
   * report instead of being swallowed by the probe.
   */
  unreachableReason: string | null;
};

export async function fetchRobots(
  origin: string,
  options: SafeFetchOptions = {},
): Promise<RobotsProbeResult> {
  const robotsUrl = new URL("/robots.txt", origin).toString();

  try {
    const result = await safeFetch(robotsUrl, { ...options, timeoutMs: 8_000 });

    if (result.status >= 400) {
      return {
        robots: {
          fetched: false,
          originReachable: true,
          content: null,
          sitemapUrls: [],
          homepageAllowed: true,
        },
        unreachableReason: null,
      };
    }

    const parser = robotsParser(robotsUrl, result.body);
    const homepageAllowed = parser.isAllowed(origin, CRAWLER_USER_AGENT_TOKEN) ?? true;

    return {
      robots: {
        fetched: true,
        originReachable: true,
        content: result.body.slice(0, MAX_ROBOTS_BYTES_TO_KEEP),
        sitemapUrls: parser.getSitemaps(),
        homepageAllowed,
      },
      unreachableReason: null,
    };
  } catch (error) {
    // The whole-crawl budget is not a per-request concern — let it abort
    // the crawl rather than being misread as "this origin is down".
    if (error instanceof DeadlineExceededError) throw error;

    if (error instanceof FetchFailedError) {
      return {
        robots: {
          fetched: false,
          originReachable: false,
          content: null,
          sitemapUrls: [],
          homepageAllowed: true,
        },
        unreachableReason: error.message,
      };
    }
    throw error;
  }
}
