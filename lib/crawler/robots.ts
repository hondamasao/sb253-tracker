import "server-only";
import robotsParser from "robots-parser";
import { safeFetch, FetchFailedError } from "./safe-fetch";
import type { RobotsInfo } from "./types";
import type { UrlSafetyOptions } from "@/lib/ssrf-guard";

const MAX_ROBOTS_BYTES_TO_KEEP = 10_000;
export const CRAWLER_USER_AGENT_TOKEN = "GrowthOSBot";

/**
 * Fetches and parses robots.txt for a site's origin. A missing (404) or
 * blocked (403) robots.txt is not an error — it means "no restrictions we
 * know of," which is the overwhelmingly common case and shouldn't fail
 * the scan.
 */
export async function fetchRobots(
  origin: string,
  options: UrlSafetyOptions = {},
): Promise<RobotsInfo> {
  const robotsUrl = new URL("/robots.txt", origin).toString();

  try {
    const result = await safeFetch(robotsUrl, { ...options, timeoutMs: 8_000 });

    if (result.status >= 400) {
      return {
        fetched: false,
        content: null,
        sitemapUrls: [],
        homepageAllowed: true,
      };
    }

    const parser = robotsParser(robotsUrl, result.body);
    const homepageAllowed = parser.isAllowed(origin, CRAWLER_USER_AGENT_TOKEN) ?? true;

    return {
      fetched: true,
      content: result.body.slice(0, MAX_ROBOTS_BYTES_TO_KEEP),
      sitemapUrls: parser.getSitemaps(),
      homepageAllowed,
    };
  } catch (error) {
    if (error instanceof FetchFailedError) {
      return {
        fetched: false,
        content: null,
        sitemapUrls: [],
        homepageAllowed: true,
      };
    }
    throw error;
  }
}
