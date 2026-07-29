import { buildEvidenceList, callCategoryAgent, detectIndustry } from "../shared";
import type { Agent, AgentContext, AgentOutput } from "../types";
import { scoreFromFindings } from "../shared";
import { pageLabel } from "../shared/page-label";

const CATEGORY_GUIDANCE = `You are analyzing ON-PAGE & TECHNICAL SEO: page titles, meta descriptions, heading structure (H1s), canonical tags, structured data (schema.org markup), indexability (noindex), and duplicate titles across pages. Do NOT write about page speed/Core Web Vitals (a separate agent covers that), and do NOT write about persuasive copy quality beyond how it affects search visibility.`;

/**
 * Reads only `site_signals`'s per-page title/metaDescription/headings/
 * canonicalUrl/structuredData and the title/meta/heading/canonical/noindex/
 * duplicate-title entries from `technicalIssues` — see
 * docs/18-m1b-ai-agent-architecture.md §2's data-flow table. Never reads
 * `lighthouse` (that's Technical Analysis's job, even though PageSpeed
 * also reports its own generic "seo" category score).
 */
export const seoAnalysisAgent: Agent = {
  type: "seo_analysis",
  run: runSeoAnalysisAgent,
};

async function runSeoAnalysisAgent(ctx: AgentContext): Promise<AgentOutput> {
  const { siteSignals } = ctx;

  if (!siteSignals) {
    throw new Error(
      "SEO Analysis agent requires the site_signals agent's output, which is missing (that agent may have failed).",
    );
  }

  const pageFacts = siteSignals.pages.flatMap((page) => {
    const label = pageLabel(page.url);
    const h1s = page.headings.filter((heading) => heading.level === 1);
    return [
      page.title
        ? `${label} title tag: "${page.title}" (${page.title.length} characters).`
        : `${label} has no title tag.`,
      page.metaDescription
        ? `${label} meta description: "${page.metaDescription}" (${page.metaDescription.length} characters).`
        : `${label} has no meta description.`,
      h1s.length === 0
        ? `${label} has no H1 heading.`
        : h1s.length > 1
          ? `${label} has ${h1s.length} H1 headings: ${h1s.map((h) => `"${h.text}"`).join(", ")}.`
          : `${label} H1 heading: "${h1s[0]?.text}".`,
      !page.canonicalUrl && `${label} has no canonical tag.`,
      page.isNoIndex && `${label} has a noindex meta tag, telling search engines not to index it.`,
      page.structuredData.jsonLdCount > 0
        ? `${label} has structured data (schema.org) types: ${page.structuredData.jsonLdTypes.join(", ") || "unspecified"}.`
        : `${label} has no structured data (schema.org markup).`,
    ];
  });

  const duplicateTitleFacts = siteSignals.technicalIssues
    .filter((issue) => issue.type === "duplicate_title_across_pages")
    .map((issue) => issue.detail ?? "Duplicate title tag found across multiple pages.");

  const evidence = buildEvidenceList([...pageFacts, ...duplicateTitleFacts]);

  const industry = detectIndustry(siteSignals.pages.map((page) => page.visibleText));

  const result = await callCategoryAgent({
    categoryGuidance: buildGuidance(industry),
    evidence,
  });

  return {
    score: scoreFromFindings(result.findings),
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
  return `${CATEGORY_GUIDANCE} This business appears (best-effort guess from page text, may be wrong) to be in the ${industry} trade — if evidence supports it, you may note that titles/headings lacking the trade name or service area hurt local search visibility for that specific trade, but only using facts actually present in the evidence.`;
}
