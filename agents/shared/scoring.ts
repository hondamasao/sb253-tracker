import type { Finding } from "./schemas";

const SEVERITY_DEDUCTIONS: Record<Finding["severity"], number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
};

/**
 * 100 minus severity-weighted deductions from validated findings, clamped
 * to [0, 100] — see docs/18-m1b-ai-agent-architecture.md's scoring
 * section. Used by SEO Analysis, Conversion Optimization, Trust &
 * Credibility, and Copywriting. Technical Analysis is the one exception:
 * it derives its score directly from Lighthouse's own category scores
 * instead (see agents/technical-analysis) so the same PageSpeed issues
 * aren't deducted for twice — once in Lighthouse's number, again per
 * finding here.
 *
 * Deliberately code, never an LLM's own arithmetic — the same principle
 * already established in docs/06-ai-agent-architecture.md.
 */
export function scoreFromFindings(findings: Finding[]): number {
  const totalDeduction = findings.reduce(
    (sum, finding) => sum + SEVERITY_DEDUCTIONS[finding.severity],
    0,
  );
  return Math.max(0, Math.min(100, 100 - totalDeduction));
}
