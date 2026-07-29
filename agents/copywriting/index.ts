import { buildEvidenceList, callCategoryAgent, detectIndustry, pageLabel, scoreFromFindings } from "../shared";
import type { Agent, AgentContext, AgentOutput } from "../types";

const HOMEPAGE_EXCERPT_LENGTH = 600;
const OTHER_PAGE_EXCERPT_LENGTH = 250;

const CATEGORY_GUIDANCE = `You are analyzing COPYWRITING & MESSAGING: does the actual text on the site say why a customer should choose THIS business, or does it just describe generic services in generic language? Do NOT write about SEO/titles as a search-ranking factor, page speed, contact forms, or licensing/trust signals — separate agents cover those (you may reference a title or heading as a piece of copy, but only for how it reads to a human, not for search ranking).

If — and only if — the EVIDENCE contains an exact quoted sentence of real site copy that is weak or generic, you may set "beforeExample" to that exact quoted sentence and "afterExample" to a specific, improved rewrite that still describes the same real business. Never invent a "beforeExample" that wasn't actually quoted in the evidence. Leave both null for findings that aren't about a specific rewritable sentence.`;

/**
 * Reads only `site_signals`'s per-page `visibleText` (capped excerpts —
 * never full raw HTML), `title`, `metaDescription`, and homepage
 * `headings` — see docs/18-m1b-ai-agent-architecture.md §2's data-flow
 * table. Excerpts are capped per page (not just relying on parse-page's
 * whole-page 4,000-char cap) to keep this agent's prompt small across a
 * multi-page evidence list, per docs/18 §4's cost-control rationale.
 */
export const copywritingAgent: Agent = {
  type: "copywriting",
  run: runCopywritingAgent,
};

async function runCopywritingAgent(ctx: AgentContext): Promise<AgentOutput> {
  const { siteSignals } = ctx;

  if (!siteSignals) {
    throw new Error(
      "Copywriting agent requires the site_signals agent's output, which is missing (that agent may have failed).",
    );
  }

  const pageFacts = siteSignals.pages.flatMap((page, index) => {
    const label = pageLabel(page.url);
    const isHomepage = index === 0;
    const excerptLength = isHomepage ? HOMEPAGE_EXCERPT_LENGTH : OTHER_PAGE_EXCERPT_LENGTH;
    const excerpt = page.visibleText.slice(0, excerptLength);

    const facts = [
      page.title && `${label} title/headline text: "${page.title}".`,
      page.metaDescription && `${label} meta description text: "${page.metaDescription}".`,
      excerpt && `${label} visible body text (excerpt): "${excerpt}"${page.visibleText.length > excerptLength ? "..." : ""}`,
    ];

    if (isHomepage) {
      const headingTexts = page.headings.map((heading) => `H${heading.level}: "${heading.text}"`);
      if (headingTexts.length > 0) {
        facts.push(`${label} heading structure: ${headingTexts.join("; ")}.`);
      }
    }

    return facts;
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
  return `${CATEGORY_GUIDANCE} This business appears (best-effort guess from page text, may be wrong) to be in the ${industry} trade — you may suggest copy that names specific differentiators common to that trade (e.g. emergency availability, financing, service-area specificity) only if the evidence shows that information is genuinely missing or only vaguely stated.`;
}
