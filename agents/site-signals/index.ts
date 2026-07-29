import { parsePage } from "@/lib/parsing/parse-page";
import { detectTechnicalIssues } from "@/lib/parsing/technical-issues";
import type { ParsedPage } from "@/lib/parsing/types";
import type { Agent, AgentContext, AgentOutput } from "../types";

/**
 * Turns the crawler's raw CrawlResult into the structured technical +
 * on-page + local SEO facts listed in this milestone's requirements:
 * titles, meta descriptions, headings, internal links, images/alt text,
 * structured data, robots.txt, sitemap.xml, SSL status, canonical tags,
 * and the deterministic technical-issue flags derived from all of that.
 *
 * `score` stays null — no weighting formula has been decided for this
 * category yet (see docs/17-m1-crawler-architecture.md §5); that's a
 * later milestone's job, using exactly this stored data as its input.
 */
export const siteSignalsAgent: Agent = {
  type: "site_signals",
  run: runSiteSignalsAgent,
};

async function runSiteSignalsAgent(ctx: AgentContext): Promise<AgentOutput> {
  const { crawlResult } = ctx;

  const crawledPages = [crawlResult.homepage, ...crawlResult.additionalPages];
  const parsedPages: ParsedPage[] = crawledPages.map((page) =>
    parsePage(page.html, page.finalUrl),
  );

  const technicalIssues = detectTechnicalIssues({
    pages: parsedPages,
    robots: crawlResult.robots,
    sitemap: crawlResult.sitemap,
    ssl: crawlResult.ssl,
  });

  return {
    score: null,
    raw: {
      pages: parsedPages,
      failedPages: crawlResult.failedPages,
      robots: crawlResult.robots,
      sitemap: crawlResult.sitemap,
      ssl: crawlResult.ssl,
      technicalIssues,
      analyzedAt: new Date().toISOString(),
    },
  };
}
