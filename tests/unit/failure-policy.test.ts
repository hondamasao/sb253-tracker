import { describe, expect, it } from "vitest";
import {
  assessShippability,
  discloseOmissionsInSummary,
  isRetriableFailure,
} from "@/lib/pipeline/failure-policy";

const ALL_FIVE = [
  "technical_analysis",
  "seo_analysis",
  "conversion_optimization",
  "trust_credibility",
  "copywriting",
];

function assess(overrides: Partial<Parameters<typeof assessShippability>[0]> = {}) {
  return assessShippability({
    succeeded: ALL_FIVE,
    failed: [],
    budgetBreached: false,
    analysisDeadlineExceeded: false,
    ...overrides,
  });
}

describe("shippability — mandatory categories", () => {
  it("ships when all five categories succeed", () => {
    const verdict = assess();
    expect(verdict.shippable).toBe(true);
    if (verdict.shippable) expect(verdict.omitted).toEqual([]);
  });

  it("BLOCKS when Technical Analysis fails, however many others succeeded", () => {
    const verdict = assess({
      succeeded: ALL_FIVE.filter((c) => c !== "technical_analysis"),
      failed: [{ category: "technical_analysis", reason: "api error" }],
    });
    expect(verdict.shippable).toBe(false);
    if (!verdict.shippable) {
      expect(verdict.userMessage).toMatch(/not been charged/i);
      expect(verdict.userMessage).toMatch(/Technical health/i);
    }
  });

  it("BLOCKS when SEO Analysis fails", () => {
    const verdict = assess({
      succeeded: ALL_FIVE.filter((c) => c !== "seo_analysis"),
      failed: [{ category: "seo_analysis", reason: "api error" }],
    });
    expect(verdict.shippable).toBe(false);
  });
});

describe("shippability — degradable categories", () => {
  it("ships with ONE degradable failure and discloses it", () => {
    const verdict = assess({
      succeeded: ALL_FIVE.filter((c) => c !== "copywriting"),
      failed: [{ category: "copywriting", reason: "rate limited" }],
    });
    expect(verdict.shippable).toBe(true);
    if (verdict.shippable) {
      expect(verdict.omitted).toHaveLength(1);
      expect(verdict.omitted[0]?.category).toBe("copywriting");
      expect(verdict.omitted[0]?.disclosure).toMatch(/could not be completed/i);
    }
  });

  it("BLOCKS on two degradable failures — the policy names categories, not a bare count", () => {
    const verdict = assess({
      succeeded: ["technical_analysis", "seo_analysis", "trust_credibility"],
      failed: [
        { category: "copywriting", reason: "x" },
        { category: "conversion_optimization", reason: "y" },
      ],
    });
    expect(verdict.shippable).toBe(false);
  });
});

describe("shippability — truncated analysis is always unshippable", () => {
  it("BLOCKS on a budget breach even when every category succeeded", () => {
    const verdict = assess({ budgetBreached: true });
    expect(verdict.shippable).toBe(false);
    if (!verdict.shippable) {
      expect(verdict.internalReason).toMatch(/cost ceiling/i);
      expect(verdict.userMessage).toMatch(/not been charged/i);
    }
  });

  it("BLOCKS on analysis deadline exhaustion even when every category succeeded", () => {
    const verdict = assess({ analysisDeadlineExceeded: true });
    expect(verdict.shippable).toBe(false);
    if (!verdict.shippable) expect(verdict.internalReason).toMatch(/wall-clock/i);
  });

  it("treats a budget breach as unshippable ahead of any category reasoning", () => {
    // Truncation is categorically different from a category legitimately
    // finding nothing, so it must not be rescued by completions.
    const verdict = assess({ budgetBreached: true, failed: [] });
    expect(verdict.shippable).toBe(false);
  });
});

describe("omission disclosure reaches the report body", () => {
  it("appends the disclosure to the executive summary itself", () => {
    const summary = discloseOmissionsInSummary("Your site scored 72/100.", [
      { category: "copywriting", reason: "x", disclosure: "Website copy: not completed." },
    ]);
    expect(summary).toContain("Your site scored 72/100.");
    expect(summary).toContain("Website copy: not completed.");
  });

  it("leaves the summary untouched when nothing was omitted", () => {
    expect(discloseOmissionsInSummary("All good.", [])).toBe("All good.");
  });
});

describe("retry classification", () => {
  it("retries transient failures", () => {
    expect(isRetriableFailure(new Error("429 rate_limit_error"))).toBe(true);
    expect(isRetriableFailure(new Error("HTTP 529 overloaded"))).toBe(true);
    expect(isRetriableFailure(new Error("socket hang up"))).toBe(true);
    expect(isRetriableFailure(new Error("ETIMEDOUT"))).toBe(true);
  });

  it("does NOT retry deterministic failures", () => {
    expect(
      isRetriableFailure(new Error("Missing required environment variable: ANTHROPIC_API_KEY.")),
    ).toBe(false);
    expect(isRetriableFailure(new Error("Per-scan cost ceiling of $0.15 would be exceeded"))).toBe(
      false,
    );
    expect(isRetriableFailure(new Error("Failed to parse structured output: bad shape"))).toBe(
      false,
    );
  });
});
