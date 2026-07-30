/**
 * Published, standard (non-introductory) per-token Anthropic pricing —
 * see docs/18-m1b-ai-agent-architecture.md §4. Standard rates are used
 * even during any temporary introductory pricing window so this internal
 * cost figure doesn't silently become wrong the day introductory pricing
 * ends; it's a tracking/analytics number, not a customer invoice, so
 * erring slightly high is the safe direction.
 */
export const MODEL_PRICING: Record<
  string,
  { inputPerMillionUsd: number; outputPerMillionUsd: number }
> = {
  "claude-haiku-4-5-20251001": { inputPerMillionUsd: 1, outputPerMillionUsd: 5 },
  "claude-sonnet-5": { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  // Judge only (evals/judge) — never used by the scan pipeline. A stronger
  // model than either generator, to reduce self-preference bias.
  "claude-opus-5": { inputPerMillionUsd: 5, outputPerMillionUsd: 25 },
};

/**
 * Computes the real dollar cost of one Anthropic call from its actual
 * reported token usage — never estimated or guessed, matching the same
 * "always know the real number" discipline as the Lighthouse agent (M1a).
 */
export function calculateCostUsd(
  model: string,
  usage: { input_tokens: number; output_tokens: number },
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    throw new Error(
      `No pricing configured for Anthropic model "${model}". Add it to agents/shared/pricing.ts.`,
    );
  }
  const cost =
    (usage.input_tokens / 1_000_000) * pricing.inputPerMillionUsd +
    (usage.output_tokens / 1_000_000) * pricing.outputPerMillionUsd;
  // Rounded to 5 decimal places to match the `cost_usd numeric(10,5)` column.
  return Math.round(cost * 100_000) / 100_000;
}
