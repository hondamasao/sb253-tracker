import { describe, expect, it } from "vitest";
import { scoreFromFindings } from "@/agents/shared/scoring";
import type { Finding } from "@/agents/shared/schemas";

function findingWithSeverity(severity: Finding["severity"]): Finding {
  return {
    problem: "p",
    whyItMatters: "w",
    evidence: "e (1)",
    evidenceIds: ["EV1"],
    recommendedAction: "r",
    expectedImpact: "i",
    severity,
    effortLevel: "low",
    beforeExample: null,
    afterExample: null,
  };
}

describe("scoreFromFindings", () => {
  it("returns 100 for an empty findings list", () => {
    expect(scoreFromFindings([])).toBe(100);
  });

  it("deducts the correct weight per severity", () => {
    expect(scoreFromFindings([findingWithSeverity("critical")])).toBe(75);
    expect(scoreFromFindings([findingWithSeverity("high")])).toBe(85);
    expect(scoreFromFindings([findingWithSeverity("medium")])).toBe(92);
    expect(scoreFromFindings([findingWithSeverity("low")])).toBe(97);
  });

  it("sums deductions across multiple findings", () => {
    expect(
      scoreFromFindings([findingWithSeverity("critical"), findingWithSeverity("high")]),
    ).toBe(60);
  });

  it("clamps at 0 rather than going negative", () => {
    const manyCritical = Array.from({ length: 10 }, () => findingWithSeverity("critical"));
    expect(scoreFromFindings(manyCritical)).toBe(0);
  });
});
