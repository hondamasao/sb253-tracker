import { z } from "zod";

/**
 * The 5-part finding structure required by docs/16-report-quality-standard.md
 * §6, plus `evidenceIds` (the traceability mechanism from that doc's §5) and
 * `severity`/`effortLevel` (needed for deterministic scoring/ranking in
 * lib/report/assemble-report.ts — never computed by the model itself).
 *
 * `beforeExample`/`afterExample` are nullable rather than optional: Claude's
 * structured-output mode returns a JSON Schema where every declared key is
 * always present in the response, so "not applicable" is represented as an
 * explicit `null`, matching the nullable `findings.before_example` /
 * `after_example` columns.
 */
export const findingSchema = z.object({
  problem: z.string().min(1),
  whyItMatters: z.string().min(1),
  evidence: z.string().min(1),
  evidenceIds: z.array(z.string()).min(1),
  recommendedAction: z.string().min(1),
  expectedImpact: z.string().min(1),
  severity: z.enum(["critical", "high", "medium", "low"]),
  effortLevel: z.enum(["low", "medium", "high"]),
  beforeExample: z.string().nullable(),
  afterExample: z.string().nullable(),
});
export type Finding = z.infer<typeof findingSchema>;

/**
 * Every category agent (Technical, SEO, Conversion, Trust, Copywriting)
 * returns exactly this shape — one shared schema, not one per agent, since
 * the calling convention (agents/shared/call-category-agent.ts) is itself
 * shared. Capped at 5 findings per docs/18 §4's cost-control rationale.
 */
export const categoryAgentOutputSchema = z.object({
  categorySummary: z.string().min(1),
  findings: z.array(findingSchema).max(5),
});
export type CategoryAgentOutput = z.infer<typeof categoryAgentOutputSchema>;

/**
 * The Report Synthesis Agent's entire output — one field. Overall score,
 * letter grade, the prioritized checklist, and the monthly action plan are
 * all deterministic code (lib/report/assemble-report.ts), never part of
 * this schema — see docs/18-m1b-ai-agent-architecture.md §1.
 */
export const synthesisOutputSchema = z.object({
  executiveSummary: z.string().min(1),
});
export type SynthesisOutput = z.infer<typeof synthesisOutputSchema>;
