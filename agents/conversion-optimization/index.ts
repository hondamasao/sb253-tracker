import { buildEvidenceList, callCategoryAgent, detectIndustry, pageLabel, scoreFromFindings } from "../shared";
import type { Agent, AgentContext, AgentOutput } from "../types";

const CATEGORY_GUIDANCE = `You are analyzing CONVERSION OPTIMIZATION: how easily a visitor can actually contact this business — visible phone numbers, contact forms, and calls-to-action (CTA language like "call now" or "book online"). Do NOT write about SEO/titles/meta descriptions, page speed, trust signals, or copy quality beyond CTA wording — separate agents cover those.`;

/**
 * Reads only `site_signals`'s per-page `phoneNumbers`/`hasContactForm`/
 * `ctaPhrases` — see docs/18-m1b-ai-agent-architecture.md §2's data-flow
 * table.
 */
export const conversionOptimizationAgent: Agent = {
  type: "conversion_optimization",
  run: runConversionOptimizationAgent,
};

async function runConversionOptimizationAgent(ctx: AgentContext): Promise<AgentOutput> {
  const { siteSignals } = ctx;

  if (!siteSignals) {
    throw new Error(
      "Conversion Optimization agent requires the site_signals agent's output, which is missing (that agent may have failed).",
    );
  }

  const pageFacts = siteSignals.pages.flatMap((page) => {
    const label = pageLabel(page.url);
    return [
      page.phoneNumbers.length > 0
        ? `${label} shows a phone number in its visible text: ${page.phoneNumbers.join(", ")}.`
        : `${label} has no phone number anywhere in its visible text.`,
      `${label} ${page.hasContactForm ? "has" : "does not have"} a <form> element (contact/quote form).`,
      page.ctaPhrases.length > 0
        ? `${label} contains call-to-action language: ${page.ctaPhrases.map((phrase) => `"${phrase}"`).join(", ")}.`
        : `${label} contains none of the common call-to-action phrases checked for (e.g. "call now," "book online," "free estimate," "24/7").`,
    ];
  });

  const evidence = buildEvidenceList(pageFacts);
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
  return `${CATEGORY_GUIDANCE} This business appears (best-effort guess from page text, may be wrong) to be in the ${industry} trade, where urgent/emergency searches are common — a visible tap-to-call phone number matters more than for a typical retail site, but only make this point if the evidence actually shows a missing or hard-to-find phone number.`;
}
