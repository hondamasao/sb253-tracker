import { parsePage } from "@/lib/parsing/parse-page";
import { detectTechnicalIssues } from "@/lib/parsing/technical-issues";
import type { TechnicalIssue } from "@/lib/parsing/technical-issues";
import type { ParsedPage } from "@/lib/parsing/types";
import type { FailedPage, RobotsInfo, SitemapInfo, SslInfo } from "@/lib/crawler/types";
import type { Agent, AgentContext, AgentOutput } from "../types";

/**
 * The shape of this agent's `raw` output, exported so M1b's category agents
 * (SEO, Conversion, Trust, Copywriting — see agents/*) can read it back
 * typed instead of as `Record<string, unknown>` — see
 * docs/18-m1b-ai-agent-architecture.md §2's data-flow table.
 */
export type SiteSignalsOutput = {
  pages: ParsedPage[];
  failedPages: FailedPage[];
  robots: RobotsInfo;
  sitemap: SitemapInfo;
  ssl: SslInfo;
  technicalIssues: TechnicalIssue[];
  analyzedAt: string;
};

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
  if (!crawlResult) {
    throw new Error(
      "Site Signals agent requires a crawl result — it is a capture-phase agent and cannot run from a stored evidence bundle.",
    );
  }

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
