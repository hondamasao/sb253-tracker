import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropicClient, passesBannedContentRules } from "../shared";
import { calculateCostUsd } from "../shared/pricing";
import { buildSynthesisSystemPrompt } from "../shared/prompt";
import { synthesisOutputSchema } from "../shared/schemas";
import type { Finding } from "../shared/schemas";
import type { Agent, AgentContext, AgentOutput } from "../types";

// The one call per scan that reads across every category and writes the
// customer's first impression — the higher per-token cost of Sonnet 5
// (vs. Haiku 4.5 for the five category agents) has a small absolute
// impact since it only runs once. See docs/18-m1b-ai-agent-architecture.md §4.
const SYNTHESIS_MODEL = "claude-sonnet-5";
const SYNTHESIS_MAX_TOKENS = 700;

/** The shape this agent puts in `AgentOutput.raw` — exported so orchestration code can read it back typed. */
export type SynthesisRawOutput = {
  executiveSummary: string;
  analyzedAt: string;
};

export type SynthesisInput = {
  categorySummaries: Array<{ category: string; categorySummary: string }>;
  findings: Array<{ category: string; problem: string; severity: Finding["severity"] }>;
  overallScore: number;
  letterGrade: string;
};

/**
 * Architecturally narrower than the five category agents (see
 * docs/18-m1b-ai-agent-architecture.md §1): writes ONLY the executive
 * summary. Overall score, letter grade, the prioritized checklist, and the
 * monthly action plan are computed entirely in
 * lib/report/assemble-report.ts before this agent ever runs — this agent
 * receives those numbers as fixed input to stay consistent with, never
 * recomputes them.
 */
export const reportSynthesisAgent: Agent = {
  type: "report_synthesis",
  run: runReportSynthesisAgent,
};

async function runReportSynthesisAgent(ctx: AgentContext): Promise<AgentOutput> {
  const { synthesisInput } = ctx;
  if (!synthesisInput) {
    throw new Error(
      "Report Synthesis agent requires synthesisInput (category findings + overall score), which is missing.",
    );
  }

  const client = getAnthropicClient();

  const response = await client.messages.parse({
    model: SYNTHESIS_MODEL,
    max_tokens: SYNTHESIS_MAX_TOKENS,
    system: buildSynthesisSystemPrompt(),
    messages: [{ role: "user", content: buildUserMessage(synthesisInput) }],
    output_config: { format: zodOutputFormat(synthesisOutputSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("Anthropic response did not include parsed structured output.");
  }

  const executiveSummary = passesBannedContentRules(parsed.executiveSummary)
    ? parsed.executiveSummary
    : buildFallbackExecutiveSummary(synthesisInput);

  const costUsd = calculateCostUsd(SYNTHESIS_MODEL, {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  });

  return {
    score: null,
    raw: { executiveSummary, analyzedAt: new Date().toISOString() },
    modelUsed: SYNTHESIS_MODEL,
    costUsd,
  };
}

function buildUserMessage(input: SynthesisInput): string {
  const summaryLines =
    input.categorySummaries.map((entry) => `${entry.category}: ${entry.categorySummary}`).join("\n") ||
    "(no category summaries available)";
  const findingLines =
    input.findings.length > 0
      ? input.findings.map((finding) => `- [${finding.category}/${finding.severity}] ${finding.problem}`).join("\n")
      : "(no findings were flagged in any category)";

  return `Overall score: ${input.overallScore}/100 (grade ${input.letterGrade})

Category summaries:
${summaryLines}

Findings, most important first:
${findingLines}`;
}

const SEVERITY_ORDER: Record<Finding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * A plain, non-AI executive summary built entirely from data already
 * computed deterministically — used when the Synthesis Agent's own call
 * fails outright (missing API key, rate limit, etc. — runAgentSafely
 * catches the throw) or when its output fails the banned-content check
 * above. Ships a still-useful report rather than failing the whole scan —
 * see docs/18-m1b-ai-agent-architecture.md §1.
 */
export function buildFallbackExecutiveSummary(
  input: Pick<SynthesisInput, "overallScore" | "letterGrade" | "findings">,
): string {
  if (input.findings.length === 0) {
    return `This site scored ${input.overallScore}/100 (grade ${input.letterGrade}). No significant issues were flagged in any category checked — see the category breakdown below for exactly what was reviewed.`;
  }
  // Non-null: this branch is only reached when input.findings.length > 0.
  const topFinding = [...input.findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )[0]!;
  return `This site scored ${input.overallScore}/100 (grade ${input.letterGrade}). The most significant issue found: ${topFinding.problem} See the prioritized checklist below for this and every other finding, ranked by impact.`;
}
