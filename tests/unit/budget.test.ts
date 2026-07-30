import { describe, expect, it } from "vitest";
import {
  ScanBudget,
  BudgetExceededError,
  projectWorstCaseCostUsd,
  estimateInputTokens,
  PROVISIONAL_SCAN_COST_CEILING_USD,
} from "@/lib/budget";

describe("cost projection", () => {
  it("estimates input tokens pessimistically (3 chars/token, not 4)", () => {
    // Under-estimating would let concurrent reservations overshoot.
    expect(estimateInputTokens(300)).toBe(100);
  });

  it("projects the worst case as full max_tokens of output plus estimated input", () => {
    const cost = projectWorstCaseCostUsd({
      model: "claude-haiku-4-5-20251001",
      promptChars: 3_000, // -> 1,000 input tokens at $1/MTok = $0.001
      maxTokens: 1_000, //           1,000 output tokens at $5/MTok = $0.005
    });
    expect(cost).toBeCloseTo(0.006, 6);
  });

  it("throws rather than guessing for an unknown model", () => {
    expect(() =>
      projectWorstCaseCostUsd({ model: "not-a-model", promptChars: 100, maxTokens: 100 }),
    ).toThrow(/No pricing configured/);
  });
});

describe("ScanBudget", () => {
  it("defaults to the provisional ceiling", () => {
    expect(new ScanBudget().ceiling).toBe(PROVISIONAL_SCAN_COST_CEILING_USD);
  });

  it("allows reservations that fit under the ceiling", () => {
    const budget = new ScanBudget(0.1);
    expect(() => budget.reserve(0.04, "a")).not.toThrow();
    expect(() => budget.reserve(0.04, "b")).not.toThrow();
    expect(budget.hasBreached).toBe(false);
  });

  it("BLOCKS a reservation that would breach the ceiling, and records the breach", () => {
    const budget = new ScanBudget(0.1);
    budget.reserve(0.09, "first");
    expect(() => budget.reserve(0.05, "second")).toThrow(BudgetExceededError);
    expect(budget.hasBreached).toBe(true);
  });

  it("counts reservations, not just settled spend — so concurrent calls cannot collectively overshoot", () => {
    const budget = new ScanBudget(0.1);
    // Five agents dispatching in parallel each reserve before any settles.
    budget.reserve(0.03, "a");
    budget.reserve(0.03, "b");
    budget.reserve(0.03, "c");
    // Nothing has settled yet; a naive spent-only check would allow this.
    expect(budget.spentUsd).toBe(0);
    expect(() => budget.reserve(0.03, "d")).toThrow(BudgetExceededError);
  });

  it("settles a reservation down to the real cost, freeing headroom", () => {
    const budget = new ScanBudget(0.1);
    budget.reserve(0.06, "big projection");
    budget.settle(0.06, 0.001); // actual cost was far lower
    expect(budget.spentUsd).toBeCloseTo(0.001, 6);
    expect(budget.remainingUsd).toBeCloseTo(0.099, 6);
    expect(() => budget.reserve(0.09, "next")).not.toThrow();
  });

  it("releases a reservation for a call that failed and cost nothing", () => {
    const budget = new ScanBudget(0.1);
    budget.reserve(0.06, "doomed");
    budget.release(0.06);
    expect(budget.spentUsd).toBe(0);
    expect(budget.remainingUsd).toBeCloseTo(0.1, 6);
  });

  it("never reports negative remaining budget", () => {
    const budget = new ScanBudget(0.01);
    budget.settle(0, 0.05);
    expect(budget.remainingUsd).toBe(0);
  });
});
