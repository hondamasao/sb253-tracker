import { buildEvidenceList, callCategoryAgent, detectIndustry, pageLabel, scoreFromFindings } from "../shared";
import type { Agent, AgentContext, AgentOutput } from "../types";

const CATEGORY_GUIDANCE = `You are analyzing TRUST & CREDIBILITY: whether the site shows the signals a homeowner looks for before hiring a home-service business — licensing/insurance/bonding/certification mentions, guarantees/warranties, "years in business," and structured data that search engines use to show trust signals (e.g. LocalBusiness, AggregateRating/review markup). Do NOT write about SEO/titles, page speed, contact forms/phone visibility, or general copywriting quality — separate agents cover those.`;

/**
 * Reads only `site_signals`'s per-page `trustSignalMentions` and
 * `structuredData` (specifically LocalBusiness/review-related types) — see
 * docs/18-m1b-ai-agent-architecture.md §2's data-flow table.
 */
export const trustCredibilityAgent: Agent = {
  type: "trust_credibility",
  run: runTrustCredibilityAgent,
};

const REVIEW_RELATED_TYPES = ["LocalBusiness", "AggregateRating", "Review", "Organization"];

async function runTrustCredibilityAgent(ctx: AgentContext): Promise<AgentOutput> {
  const { siteSignals } = ctx;

  if (!siteSignals) {
    throw new Error(
      "Trust & Credibility agent requires the site_signals agent's output, which is missing (that agent may have failed).",
    );
  }

  const pageFacts = siteSignals.pages.flatMap((page) => {
    const label = pageLabel(page.url);
    const relevantTypes = page.structuredData.jsonLdTypes.filter((type) =>
      REVIEW_RELATED_TYPES.includes(type),
    );
    return [
      page.trustSignalMentions.length > 0
        ? `${label} mentions these trust-related terms in its visible text: ${page.trustSignalMentions.join(", ")}.`
        : `${label} contains none of the trust-related terms checked for (e.g. "licensed," "insured," "bonded," "guarantee," "certified," "family owned," "BBB accredited").`,
      relevantTypes.length > 0
        ? `${label} has structured data marking it up as: ${relevantTypes.join(", ")}.`
        : `${label} has no LocalBusiness, Review, or AggregateRating structured data.`,
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

const TRADE_TRUST_CONTEXT: Record<string, string> = {
  plumbing:
    "licensing/bonding is table-stakes and often legally required for plumbers — its absence is worth calling out by name if the evidence shows no such mention.",
  hvac: "manufacturer certifications (e.g. Trane, Carrier dealer badges) are a trust signal homeowners specifically look for when comparing HVAC quotes.",
  roofing:
    "roofing is a high-ticket, high-trust purchase — insurance/licensing and visible proof of past work matter more here than almost any other trade.",
  electrical:
    "licensing as a master/journeyman electrician is one of the first things homeowners check before letting someone work on their home's electrical system.",
};

function buildGuidance(industry: string | null): string {
  const tradeContext = industry ? TRADE_TRUST_CONTEXT[industry] : undefined;
  if (!tradeContext) return CATEGORY_GUIDANCE;
  return `${CATEGORY_GUIDANCE} This business appears (best-effort guess from page text, may be wrong) to be in the ${industry} trade: ${tradeContext} Only make trade-specific claims that the evidence actually supports.`;
}
