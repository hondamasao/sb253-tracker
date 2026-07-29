import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropicClient } from "./anthropic-client";
import { formatEvidenceForPrompt, type EvidenceItem } from "./evidence";
import { calculateCostUsd } from "./pricing";
import { buildCategorySystemPrompt } from "./prompt";
import { categoryAgentOutputSchema, type Finding } from "./schemas";
import { validateCategorySummary, validateFinding } from "./validation";

// Fast, cheap, and sufficient for bounded-evidence-in/structured-findings-out
// — see docs/18-m1b-ai-agent-architecture.md §4. The Synthesis Agent (the
// one call that runs once per scan and writes the customer's first
// impression) is the only agent that uses Sonnet 5 instead.
const CATEGORY_AGENT_MODEL = "claude-haiku-4-5-20251001";
const CATEGORY_AGENT_MAX_TOKENS = 1_500;

export type DroppedFinding = { problem: string; reason: string };

/**
 * The shape every category agent (Technical, SEO, Conversion, Trust,
 * Copywriting) puts in its `AgentOutput.raw` — one shared shape since the
 * calling convention is shared. Exported so orchestration code (e.g.
 * inngest/functions/run-scan.ts) can read `agentRunResult.raw` back typed
 * instead of as `Record<string, unknown>`.
 */
export type CategoryAgentRawOutput = {
  categorySummary: string;
  droppedFindings: DroppedFinding[];
  evidenceCount: number;
  analyzedAt: string;
};

export type CategoryAgentCallResult = {
  categorySummary: string;
  findings: Finding[];
  modelUsed: string;
  costUsd: number;
  droppedFindings: DroppedFinding[];
};

/**
 * The one shared calling convention every category agent (Technical, SEO,
 * Conversion, Trust, Copywriting) uses — implemented once here, not
 * duplicated five times, per docs/18-m1b-ai-agent-architecture.md §1.
 * `categoryGuidance` is the only per-agent input; everything else
 * (hallucination-minimization rules, formatting rules, validation) is
 * identical across all five callers.
 */
export async function callCategoryAgent(params: {
  categoryGuidance: string;
  evidence: EvidenceItem[];
}): Promise<CategoryAgentCallResult> {
  const client = getAnthropicClient();
  const systemPrompt = buildCategorySystemPrompt(params.categoryGuidance);
  const userMessage = `EVIDENCE:\n${formatEvidenceForPrompt(params.evidence)}`;

  const response = await client.messages.parse({
    model: CATEGORY_AGENT_MODEL,
    max_tokens: CATEGORY_AGENT_MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    output_config: { format: zodOutputFormat(categoryAgentOutputSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("Anthropic response did not include parsed structured output.");
  }

  const droppedFindings: DroppedFinding[] = [];
  const findings: Finding[] = [];
  for (const finding of parsed.findings) {
    const result = validateFinding(finding, params.evidence);
    if (result.ok) {
      findings.push(finding);
    } else {
      droppedFindings.push({ problem: finding.problem, reason: result.reason });
    }
  }

  const costUsd = calculateCostUsd(CATEGORY_AGENT_MODEL, {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  });

  return {
    categorySummary: validateCategorySummary(parsed.categorySummary),
    findings,
    modelUsed: CATEGORY_AGENT_MODEL,
    costUsd,
    droppedFindings,
  };
}
