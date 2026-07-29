import { buildEvidenceList, callCategoryAgent, detectIndustry } from "../shared";
import type { Agent, AgentContext, AgentOutput } from "../types";

const CATEGORY_GUIDANCE = `You are analyzing TECHNICAL HEALTH: page speed, Core Web Vitals, accessibility, and whether the site can reliably be reached and crawled at all (HTTPS, robots.txt, sitemap.xml). Do NOT write about on-page SEO content like titles/meta descriptions/headings (a separate agent covers that), and do NOT write about persuasive copy or trust signals (separate agents cover those too).`;

/**
 * Reads only `lighthouse` (PageSpeed's own scores/Core Web Vitals/top
 * opportunities) and the technical/reachability facts from `site_signals`
 * (SSL, robots.txt, sitemap.xml) — see
 * docs/18-m1b-ai-agent-architecture.md §2's data-flow table.
 *
 * Score is the average of Lighthouse's own performance/accessibility/
 * bestPractices category scores, NOT "100 minus deductions from this
 * agent's findings" like the other four category agents — Lighthouse's
 * numbers already reflect these exact issues, so deducting again per
 * finding would double-count them (see agents/shared/scoring.ts).
 */
export const technicalAnalysisAgent: Agent = {
  type: "technical_analysis",
  run: runTechnicalAnalysisAgent,
};

async function runTechnicalAnalysisAgent(ctx: AgentContext): Promise<AgentOutput> {
  const { lighthouse, siteSignals } = ctx;

  if (!lighthouse) {
    throw new Error(
      "Technical Analysis agent requires the lighthouse agent's output, which is missing (that agent may have failed).",
    );
  }

  const { categoryScores, coreWebVitals, topOpportunities } = lighthouse;

  const evidence = buildEvidenceList([
    categoryScores.performance !== null &&
      `PageSpeed Insights (mobile) Performance score: ${categoryScores.performance}/100.`,
    categoryScores.accessibility !== null &&
      `PageSpeed Insights (mobile) Accessibility score: ${categoryScores.accessibility}/100.`,
    categoryScores.bestPractices !== null &&
      `PageSpeed Insights (mobile) Best Practices score: ${categoryScores.bestPractices}/100.`,
    coreWebVitals.largestContentfulPaintMs !== null &&
      `Largest Contentful Paint (mobile): ${(coreWebVitals.largestContentfulPaintMs / 1000).toFixed(1)}s (Google considers over 2.5s poor).`,
    coreWebVitals.cumulativeLayoutShift !== null &&
      `Cumulative Layout Shift (mobile): ${coreWebVitals.cumulativeLayoutShift.toFixed(2)} (Google considers over 0.25 poor).`,
    coreWebVitals.totalBlockingTimeMs !== null &&
      `Total Blocking Time (mobile): ${Math.round(coreWebVitals.totalBlockingTimeMs)}ms.`,
    ...topOpportunities.map(
      (opportunity) =>
        opportunity.title &&
        opportunity.potentialSavingsMs !== null &&
        `PageSpeed opportunity: "${opportunity.title}" — potential savings of ~${Math.round(opportunity.potentialSavingsMs)}ms.`,
    ),
    siteSignals && !siteSignals.ssl.finalUrlIsHttps && "The site does not serve its final URL over HTTPS.",
    siteSignals &&
      siteSignals.ssl.finalUrlIsHttps &&
      !siteSignals.ssl.certificateValid &&
      `The site's SSL certificate is invalid${siteSignals.ssl.error ? `: ${siteSignals.ssl.error}` : "."}`,
    siteSignals && !siteSignals.robots.fetched && "No robots.txt file was found at the site's root.",
    siteSignals &&
      siteSignals.robots.fetched &&
      !siteSignals.robots.homepageAllowed &&
      "robots.txt explicitly disallows crawling the homepage.",
    siteSignals && !siteSignals.sitemap.fetched && "No sitemap.xml was found (checked robots.txt and the default /sitemap.xml location).",
  ]);

  const industry = siteSignals ? detectIndustry(siteSignals.pages.map((page) => page.visibleText)) : null;

  const result = await callCategoryAgent({
    categoryGuidance: buildGuidance(industry),
    evidence,
  });

  const score = averageScore([
    categoryScores.performance,
    categoryScores.accessibility,
    categoryScores.bestPractices,
  ]);

  return {
    score,
    raw: {
      categorySummary: result.categorySummary,
      droppedFindings: result.droppedFindings,
      evidenceCount: evidence.length,
      analyzedAt: new Date().toISOString(),
    },
    modelUsed: result.modelUsed,
    costUsd: result.costUsd,
    findings: result.findings,
  };
}

function buildGuidance(industry: string | null): string {
  if (!industry) return CATEGORY_GUIDANCE;
  return `${CATEGORY_GUIDANCE} This business appears (best-effort guess from page text, may be wrong) to be in the ${industry} trade — you may mention that mobile speed/reachability disproportionately affects urgent, mobile-driven searches common in that trade, but only if the evidence itself supports the specific claim.`;
}

function averageScore(scores: Array<number | null>): number | null {
  const present = scores.filter((score): score is number => score !== null);
  if (present.length === 0) return null;
  return Math.round(present.reduce((sum, score) => sum + score, 0) / present.length);
}
