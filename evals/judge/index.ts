import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { JudgeEvidenceInput, JudgeReportInput } from "../types";

/**
 * The independent judge.
 *
 * Isolation is enforced three ways (docs/19-m1c-security-and-evaluation.md §3):
 *
 *  1. INPUT — it receives only the finished report and the raw evidence.
 *     Never the generating prompts, never the category guidance, never
 *     which model wrote what.
 *  2. MODULE — an ESLint `no-restricted-imports` rule forbids anything
 *     under `evals/judge/**` from importing `agents/**`. Wiring the
 *     generating prompt in here is a lint failure, not a code-review
 *     miss. That is why this file re-declares its own input types rather
 *     than importing the pipeline's.
 *  3. MODEL — Opus 5, stronger than and different from both generators
 *     (Haiku 4.5 for categories, Sonnet 5 for synthesis). This reduces
 *     self-preference bias; it does not eliminate same-family bias, and
 *     that limitation is recorded rather than papered over.
 */
export const JUDGE_MODEL = "claude-opus-5";
const JUDGE_MAX_TOKENS = 4_000;

const scoredDimension = z.object({
  score: z.number().int().min(1).max(5),
  reasoning: z.string().min(1),
});

export const judgeVerdictSchema = z.object({
  /**
   * One verdict per finding. This is the load-bearing output: the hard
   * gate counts `unsupported` verdicts, and an aggregate score can never
   * override a single hallucination.
   */
  findingVerdicts: z.array(
    z.object({
      priorityRank: z.number().int(),
      verdict: z.enum(["supported", "unsupported"]),
      reasoning: z.string().min(1),
    }),
  ),
  evidenceFidelity: scoredDimension,
  specificity: scoredDimension.extend({
    /**
     * Strings the judge could find in BOTH the report and the raw
     * evidence. A judge that cannot produce any is telling us the report
     * was generic, regardless of what score it assigned.
     */
    quotedFromSite: z.array(z.string()),
  }),
  actionability: scoredDimension,
  prioritization: scoredDimension,
  wouldPay: z.object({
    yes: z.boolean(),
    reasoning: z.string().min(1),
  }),
});

export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>;

export type JudgeResult = {
  verdict: JudgeVerdict;
  hallucinationCount: number;
  modelUsed: string;
  costUsd: number;
};

const JUDGE_SYSTEM_PROMPT = `You are an independent auditor grading a paid website report. You did NOT write the report and you have no stake in it scoring well. Your job is to find what is wrong with it.

You are given two things and nothing else:
1. THE REPORT, exactly as a customer would receive it.
2. THE RAW EVIDENCE collected from that website by an automated crawl — the ground truth.

You do not know what instructions produced the report. Do not speculate about them. Judge only the artifact in front of you.

## Grade these five things

**1. Evidence fidelity — the most important, and judged per finding.**
For EVERY finding, decide whether the RAW EVIDENCE actually supports the claim it makes.
- "supported": the raw evidence contains facts that genuinely establish the claim.
- "unsupported": the claim asserts something the raw evidence does not show. This includes inventing a fact, overstating what a fact proves, describing something as absent when the evidence does not cover it, or citing a number that does not appear in the evidence.
Be strict. A plausible-sounding claim that the evidence does not actually establish is unsupported. When genuinely uncertain whether the evidence establishes the claim, mark it unsupported — a false "supported" is far more costly here than a false "unsupported".
Then give an overall 1-5 fidelity score.

**2. Specificity (1-5).** Does the report quote real strings, numbers, and elements from THIS site, or is it advice that would read identically for any business? List, in "quotedFromSite", the specific strings or numbers you can find in both the report and the raw evidence. If you can find none, the score must be 1.

**3. Actionability (1-5).** Could a non-technical business owner act on this today, or hand it verbatim to a freelance developer with no follow-up questions? Vague direction ("improve your images") scores low; named elements, files, and concrete steps score high.

**4. Prioritization (1-5).** Are the highest-impact items first? A report that leads with a trivial fix while a severe problem sits at #6 is badly prioritized regardless of content quality.

**5. Would you pay $29 for this?** A blunt yes or no, with reasoning, from the perspective of a small home-service business owner with no marketing background who wants more phone calls. Be honest — most reports are not worth $29.

## Scoring discipline
Use the full 1-5 range. If everything you grade lands in a narrow band, your scores carry no information and are useless for detecting regressions. A report with real problems should score 1s and 2s; reserve 5 for genuinely excellent work.`;

function buildJudgeUserMessage(
  report: JudgeReportInput,
  evidence: JudgeEvidenceInput,
): string {
  const findings = report.findings
    .map(
      (finding) =>
        `--- Finding #${finding.priorityRank} [${finding.category} | severity: ${finding.severity} | effort: ${finding.effortLevel}]\n` +
        `Problem: ${finding.problem}\n` +
        `Why it matters: ${finding.whyItMatters}\n` +
        `Evidence cited: ${finding.evidence}\n` +
        `Recommended action: ${finding.recommendedAction}\n` +
        `Expected impact: ${finding.expectedImpact}`,
    )
    .join("\n\n");

  return `# THE REPORT

Website: ${report.websiteUrl}
Overall score: ${report.overallScore}/100 (grade ${report.letterGrade})

Executive summary:
${report.executiveSummary}

Findings (in the order the customer sees them):

${findings || "(the report contains no findings)"}

# THE RAW EVIDENCE (ground truth from the crawl)

${evidence}`;
}

/**
 * Runs the judge against one report. Takes its own Anthropic client
 * rather than reusing the pipeline's, keeping the judge free of any
 * import path into `agents/`.
 */
export async function judgeReport(params: {
  report: JudgeReportInput;
  evidence: JudgeEvidenceInput;
  apiKey: string;
}): Promise<JudgeResult> {
  const client = new Anthropic({ apiKey: params.apiKey });

  const response = await client.messages.parse({
    model: JUDGE_MODEL,
    max_tokens: JUDGE_MAX_TOKENS,
    system: JUDGE_SYSTEM_PROMPT,
    messages: [
      { role: "user", content: buildJudgeUserMessage(params.report, params.evidence) },
    ],
    output_config: { format: zodOutputFormat(judgeVerdictSchema) },
  });

  const verdict = response.parsed_output;
  if (!verdict) {
    throw new Error("Judge returned no parsed structured output.");
  }

  const hallucinationCount = verdict.findingVerdicts.filter(
    (finding) => finding.verdict === "unsupported",
  ).length;

  // Opus 5 pricing, kept local so the judge imports nothing from agents/.
  const costUsd =
    (response.usage.input_tokens / 1_000_000) * 5 +
    (response.usage.output_tokens / 1_000_000) * 25;

  return {
    verdict,
    hallucinationCount,
    modelUsed: JUDGE_MODEL,
    costUsd: Math.round(costUsd * 100_000) / 100_000,
  };
}
