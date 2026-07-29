import { BANNED_GENERIC_PHRASES } from "./prompt";
import type { EvidenceItem } from "./evidence";
import type { Finding } from "./schemas";

/**
 * Patterns for this milestone's explicit "no revenue / no lost-leads"
 * constraint (see docs/18-m1b-ai-agent-architecture.md, "Explicit deviation
 * from docs/16"). Deliberately broader than just "$" — a model could
 * satisfy a naive dollar-sign check while still writing "you're losing
 * roughly 12 calls a month," which is the exact claim this milestone
 * excludes.
 */
const DOLLAR_OR_LOST_LEAD_PATTERNS: RegExp[] = [
  /\$\s?\d/,
  /\blost\s+(leads?|calls?|customers?|jobs?)\b/i,
  /\bleads?\s+(lost|per\s+month)\b/i,
  /\bestimated\s+revenue\b/i,
  /\bROI\b/,
  /\brevenue\b/i,
];

export type FindingValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * The deterministic validation pipeline from
 * docs/18-m1b-ai-agent-architecture.md §3/§5 — code, not another model
 * call. Order matters: the evidence-ID existence check is the hard
 * traceability gate and runs first; the remaining checks enforce
 * docs/16-report-quality-standard.md's rules. A finding failing any check
 * is dropped entirely, never edited — editing a possibly-hallucinated
 * finding to sound better would hide the problem instead of catching it.
 */
export function validateFinding(
  finding: Finding,
  evidenceList: EvidenceItem[],
): FindingValidationResult {
  const validIds = new Set(evidenceList.map((item) => item.id));
  for (const id of finding.evidenceIds) {
    if (!validIds.has(id)) {
      return {
        ok: false,
        reason: `Cited evidence ID "${id}" does not exist in this scan's evidence list.`,
      };
    }
  }

  const combinedText = [
    finding.problem,
    finding.whyItMatters,
    finding.evidence,
    finding.recommendedAction,
    finding.expectedImpact,
  ].join(" ");

  const bannedPhrase = findBannedPhrase(combinedText);
  if (bannedPhrase) {
    return { ok: false, reason: `Contains banned generic phrase: "${bannedPhrase}".` };
  }

  if (containsDollarOrLostLeadClaim(combinedText)) {
    return {
      ok: false,
      reason: "Contains a dollar figure or lost-lead/revenue estimate, which this milestone excludes.",
    };
  }

  if (!hasConcreteDetail(finding.evidence)) {
    return {
      ok: false,
      reason: "Evidence field lacks a concrete number or quoted detail (specificity heuristic).",
    };
  }

  return { ok: true };
}

/**
 * The two checks that apply to any piece of generated prose that isn't a
 * full finding (a `categorySummary`, the Synthesis Agent's executive
 * summary) — banned filler phrases and dollar/lost-lead claims.
 * Evidence-ID citation and the specificity heuristic only make sense for
 * a finding, so they're not part of this shared check.
 */
export function passesBannedContentRules(text: string): boolean {
  return !findBannedPhrase(text) && !containsDollarOrLostLeadClaim(text);
}

/**
 * Applied to the agent's `categorySummary` when zero findings survive
 * validation (docs/18 §1's fallback rule, satisfying docs/16 Rule 5.6's
 * "a category with nothing wrong still says so" requirement).
 */
export function validateCategorySummary(summary: string): string {
  if (!passesBannedContentRules(summary)) {
    return "No further summary is available for this category on this scan.";
  }
  return summary;
}

function findBannedPhrase(text: string): string | undefined {
  const lower = text.toLowerCase();
  return BANNED_GENERIC_PHRASES.find((phrase) => lower.includes(phrase.toLowerCase()));
}

function containsDollarOrLostLeadClaim(text: string): boolean {
  return DOLLAR_OR_LOST_LEAD_PATTERNS.some((pattern) => pattern.test(text));
}

function hasConcreteDetail(evidenceText: string): boolean {
  const hasDigit = /\d/.test(evidenceText);
  const hasQuote = /["'“”‘’]/.test(evidenceText);
  return hasDigit || hasQuote;
}
