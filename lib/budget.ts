import { env } from "@/lib/env";
import { MODEL_PRICING } from "@/agents/shared/pricing";

/**
 * ============================================================================
 * PROVISIONAL AND UNVERIFIED — the $0.15 default has never been measured.
 * ============================================================================
 *
 * Two independent estimates disagree about what a normal scan actually
 * costs: this codebase's own reasoning suggested roughly $0.01–0.03
 * (six small calls: five Haiku 4.5 category agents plus one Sonnet 5
 * synthesis), while the product owner's estimate is $0.06–0.10. That gap
 * is a factor of three to six, and **it is deliberately not being resolved
 * by estimating again** — a third guess adds nothing.
 *
 * The ceiling stays at $0.15 until the golden set has been captured and
 * run for real. At that point, report the measured per-scan cost
 * distribution (min / median / p95 / max across all ten sites) and reset
 * this default from that data rather than from anyone's prior. Until then,
 * treat every cost figure in this file as a guardrail against runaway
 * spend, not as a forecast.
 */
export const PROVISIONAL_SCAN_COST_CEILING_USD = 0.15;
export const DEFAULT_DAILY_SPEND_CAP_USD = 25;
export const DEFAULT_EVAL_SPEND_CAP_USD = 10;

export class BudgetExceededError extends Error {}

export function scanCostCeilingUsd(): number {
  return env.SCAN_COST_CEILING_USD ?? PROVISIONAL_SCAN_COST_CEILING_USD;
}

export function dailySpendCapUsd(): number {
  return env.DAILY_SPEND_CAP_USD ?? DEFAULT_DAILY_SPEND_CAP_USD;
}

export function evalSpendCapUsd(): number {
  return env.EVAL_SPEND_CAP_USD ?? DEFAULT_EVAL_SPEND_CAP_USD;
}

/**
 * Rough token estimate from raw prompt characters. Deliberately
 * pessimistic (3 chars/token rather than the usual ~4) because this
 * feeds a *reservation*: under-estimating would let parallel calls
 * collectively overshoot the ceiling, which is the exact failure the
 * reservation exists to prevent.
 */
export function estimateInputTokens(promptChars: number): number {
  return Math.ceil(promptChars / 3);
}

/**
 * Worst case this call could possibly cost: every requested output token
 * generated, plus the estimated input. Reserved before dispatch and
 * reconciled to the real figure afterwards.
 */
export function projectWorstCaseCostUsd(params: {
  model: string;
  promptChars: number;
  maxTokens: number;
}): number {
  const pricing = MODEL_PRICING[params.model];
  if (!pricing) {
    throw new Error(
      `No pricing configured for model "${params.model}". Add it to agents/shared/pricing.ts.`,
    );
  }
  const inputTokens = estimateInputTokens(params.promptChars);
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMillionUsd +
    (params.maxTokens / 1_000_000) * pricing.outputPerMillionUsd
  );
}

/**
 * A single scan's spend ceiling, enforced by reserve-then-settle.
 *
 * Reservation happens *before* dispatch on purpose. The five category
 * agents run concurrently via `Promise.all`, so a design that only
 * debited actual cost after each call would let all five start, discover
 * the breach afterwards, and bill for work already done. Reserving the
 * worst case up front means the ceiling holds even under full
 * concurrency; the reservation is released back down to the true cost
 * once the call returns.
 *
 * Per docs/19 §5, a breach is **always unshippable**: it truncates the
 * analysis at an arbitrary point, which is categorically different from a
 * category legitimately having nothing to report.
 */
export class ScanBudget {
  private settledUsd = 0;
  private reservedUsd = 0;
  private breached = false;

  constructor(private readonly ceilingUsd: number = scanCostCeilingUsd()) {}

  get committedUsd(): number {
    return this.settledUsd + this.reservedUsd;
  }

  get spentUsd(): number {
    return this.settledUsd;
  }

  get remainingUsd(): number {
    return Math.max(0, this.ceilingUsd - this.committedUsd);
  }

  get ceiling(): number {
    return this.ceilingUsd;
  }

  /** True once any reservation has been refused — the scan is unshippable. */
  get hasBreached(): boolean {
    return this.breached;
  }

  reserve(estimateUsd: number, label: string): void {
    if (this.committedUsd + estimateUsd > this.ceilingUsd) {
      this.breached = true;
      throw new BudgetExceededError(
        `Per-scan cost ceiling of $${this.ceilingUsd.toFixed(4)} would be exceeded by "${label}" ` +
          `(already committed $${this.committedUsd.toFixed(5)}, this call projects $${estimateUsd.toFixed(5)}). ` +
          `Analysis aborted.`,
      );
    }
    this.reservedUsd += estimateUsd;
  }

  /** Replaces a reservation with the real cost once the call has returned. */
  settle(reservedEstimateUsd: number, actualUsd: number): void {
    this.reservedUsd = Math.max(0, this.reservedUsd - reservedEstimateUsd);
    this.settledUsd += actualUsd;
  }

  /** Releases a reservation for a call that failed and cost nothing. */
  release(reservedEstimateUsd: number): void {
    this.reservedUsd = Math.max(0, this.reservedUsd - reservedEstimateUsd);
  }
}
