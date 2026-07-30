import { env } from "@/lib/env";
import type { Agent, AgentContext, AgentOutput } from "../types";

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const PSI_TIMEOUT_MS = 45_000; // Google's own Lighthouse run is genuinely slow — see architecture doc §3
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;

/**
 * The shape of this agent's `raw` output, exported so M1b's Technical
 * Analysis agent (agents/technical-analysis) can read it back typed
 * instead of as `Record<string, unknown>` — see
 * docs/18-m1b-ai-agent-architecture.md §2's data-flow table.
 */
export type LighthouseOutput = {
  finalUrl: string;
  strategy: "mobile";
  categoryScores: {
    performance: number | null;
    accessibility: number | null;
    bestPractices: number | null;
    seo: number | null;
  };
  coreWebVitals: {
    largestContentfulPaintMs: number | null;
    cumulativeLayoutShift: number | null;
    totalBlockingTimeMs: number | null;
    speedIndexMs: number | null;
    timeToInteractiveMs: number | null;
  };
  topOpportunities: Array<{
    id: string | null;
    title: string | null;
    potentialSavingsMs: number | null;
  }>;
  analyzedAt: string;
};

type PsiAudit = {
  id?: string;
  title?: string;
  numericValue?: number;
  details?: { type?: string };
};

type PsiResponse = {
  error?: { message?: string };
  lighthouseResult?: {
    finalDisplayedUrl?: string;
    categories?: Record<string, { score?: number } | undefined>;
    audits?: Record<string, PsiAudit | undefined>;
  };
};

/**
 * Calls Google's PageSpeed Insights API once (mobile strategy) for the
 * scan's homepage. One call gives us four Lighthouse category scores
 * (Performance, Accessibility, Best Practices, SEO) for free — this is
 * the key simplification from docs/15-mvp-scope-and-m0-plan.md §1.2 that
 * removes the need for a separate accessibility pipeline entirely.
 *
 * `score` on the returned AgentOutput is the Performance category
 * specifically (this agent's namesake metric); the other three category
 * scores live in `raw.categoryScores` for the scoring formula to pull out
 * later, once that weighting logic exists.
 */
export const lighthouseAgent: Agent = {
  type: "lighthouse",
  run: runLighthouseAgent,
};

async function runLighthouseAgent(ctx: AgentContext): Promise<AgentOutput> {
  if (!ctx.crawlResult) {
    throw new Error(
      "Lighthouse agent requires a crawl result — it is a capture-phase agent and cannot run from a stored evidence bundle.",
    );
  }
  const targetUrl = ctx.crawlResult.homepage.finalUrl;

  const params = new URLSearchParams();
  params.set("url", targetUrl);
  params.set("strategy", "mobile");
  for (const category of CATEGORIES) params.append("category", category);
  // Optional — works without a key at a much lower shared quota; a real
  // key (once GOOGLE_PAGESPEED_API_KEY is set) raises that quota, it
  // doesn't unlock new functionality.
  if (env.GOOGLE_PAGESPEED_API_KEY) {
    params.set("key", env.GOOGLE_PAGESPEED_API_KEY);
  }

  const response = await fetch(`${PSI_ENDPOINT}?${params.toString()}`, {
    signal: AbortSignal.timeout(PSI_TIMEOUT_MS),
  });

  const body = (await response.json()) as PsiResponse;

  if (!response.ok) {
    throw new Error(
      body.error?.message ?? `PageSpeed Insights returned HTTP ${response.status}.`,
    );
  }

  const categories = body.lighthouseResult?.categories ?? {};
  const audits = body.lighthouseResult?.audits ?? {};

  const categoryScores = {
    performance: toScore(categories.performance?.score),
    accessibility: toScore(categories.accessibility?.score),
    bestPractices: toScore(categories["best-practices"]?.score),
    seo: toScore(categories.seo?.score),
  };

  const coreWebVitals = {
    largestContentfulPaintMs: audits["largest-contentful-paint"]?.numericValue ?? null,
    cumulativeLayoutShift: audits["cumulative-layout-shift"]?.numericValue ?? null,
    totalBlockingTimeMs: audits["total-blocking-time"]?.numericValue ?? null,
    speedIndexMs: audits["speed-index"]?.numericValue ?? null,
    timeToInteractiveMs: audits.interactive?.numericValue ?? null,
  };

  const topOpportunities = Object.values(audits)
    .filter(
      (audit): audit is PsiAudit =>
        audit !== undefined &&
        audit.details?.type === "opportunity" &&
        (audit.numericValue ?? 0) > 0,
    )
    .sort((a, b) => (b.numericValue ?? 0) - (a.numericValue ?? 0))
    .slice(0, 5)
    .map((audit) => ({
      id: audit.id ?? null,
      title: audit.title ?? null,
      potentialSavingsMs: audit.numericValue ?? null,
    }));

  return {
    score: categoryScores.performance,
    raw: {
      finalUrl: body.lighthouseResult?.finalDisplayedUrl ?? targetUrl,
      strategy: "mobile",
      categoryScores,
      coreWebVitals,
      topOpportunities,
      analyzedAt: new Date().toISOString(),
    },
    costUsd: 0,
  };
}

function toScore(value: number | undefined): number | null {
  return typeof value === "number" ? Math.round(value * 100) : null;
}
