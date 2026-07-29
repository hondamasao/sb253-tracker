import { describe, expect, it } from "vitest";
import { assembleReport } from "@/lib/report/assemble-report";
import type { CategoryReportInput } from "@/lib/report/assemble-report";
import type { Finding } from "@/agents/shared/schemas";

function finding(overrides: Partial<Finding>): Finding {
  return {
    problem: "p",
    whyItMatters: "w",
    evidence: "e (1)",
    evidenceIds: ["EV1"],
    recommendedAction: "r",
    expectedImpact: "i",
    severity: "medium",
    effortLevel: "medium",
    beforeExample: null,
    afterExample: null,
    ...overrides,
  };
}

function category(overrides: Partial<CategoryReportInput>): CategoryReportInput {
  return {
    category: "technical_analysis",
    score: 80,
    categorySummary: "Summary.",
    findings: [],
    ...overrides,
  };
}

describe("assembleReport", () => {
  it("throws when every category has a null score", () => {
    expect(() =>
      assembleReport([category({ score: null }), category({ score: null, category: "seo_analysis" })]),
    ).toThrow(/zero scored categories/);
  });

  it("averages scores across only the scored categories, rounded", () => {
    const result = assembleReport([
      category({ category: "technical_analysis", score: 90 }),
      category({ category: "seo_analysis", score: 81 }),
      category({ category: "conversion_optimization", score: null }),
    ]);
    // (90 + 81) / 2 = 85.5 -> rounds to 86
    expect(result.overallScore).toBe(86);
  });

  it.each([
    [95, "A"],
    [90, "A"],
    [89, "B"],
    [80, "B"],
    [79, "C"],
    [70, "C"],
    [69, "D"],
    [60, "D"],
    [59, "F"],
    [0, "F"],
  ])("maps overall score %d to letter grade %s", (score, expectedGrade) => {
    const result = assembleReport([category({ score })]);
    expect(result.letterGrade).toBe(expectedGrade);
  });

  it("ranks findings by severity first, then effort level, assigning sequential priorityRank", () => {
    const result = assembleReport([
      category({
        category: "technical_analysis",
        findings: [
          finding({ problem: "low/high-effort", severity: "low", effortLevel: "high" }),
          finding({ problem: "critical/medium-effort", severity: "critical", effortLevel: "medium" }),
        ],
      }),
      category({
        category: "seo_analysis",
        findings: [
          finding({ problem: "high/low-effort", severity: "high", effortLevel: "low" }),
          finding({ problem: "critical/low-effort", severity: "critical", effortLevel: "low" }),
        ],
      }),
    ]);

    expect(result.prioritizedFindings.map((f) => f.problem)).toEqual([
      "critical/low-effort",
      "critical/medium-effort",
      "high/low-effort",
      "low/high-effort",
    ]);
    expect(result.prioritizedFindings.map((f) => f.priorityRank)).toEqual([1, 2, 3, 4]);
  });

  it("chunks the monthly action plan into groups of at most 4, in priority order", () => {
    const manyFindings = Array.from({ length: 10 }, (_, i) =>
      finding({ problem: `finding-${i}`, severity: "medium", effortLevel: "medium" }),
    );
    const result = assembleReport([category({ findings: manyFindings })]);

    expect(result.monthlyActionPlan.month1).toHaveLength(4);
    expect(result.monthlyActionPlan.month2).toHaveLength(4);
    expect(result.monthlyActionPlan.month3).toHaveLength(2);
    expect(result.monthlyActionPlan.month1[0]?.problem).toBe("finding-0");
    expect(result.monthlyActionPlan.month3[0]?.problem).toBe("finding-8");
  });

  it("builds synthesisInput from category summaries and prioritized findings", () => {
    const result = assembleReport([
      category({
        category: "technical_analysis",
        categorySummary: "Technical summary.",
        findings: [finding({ problem: "Slow homepage.", severity: "high" })],
      }),
    ]);

    expect(result.synthesisInput.categorySummaries).toEqual([
      { category: "technical_analysis", categorySummary: "Technical summary." },
    ]);
    expect(result.synthesisInput.findings).toEqual([
      { category: "technical_analysis", problem: "Slow homepage.", severity: "high" },
    ]);
  });

  it("returns an empty prioritized list and empty monthly plan when no findings exist", () => {
    const result = assembleReport([category({ findings: [] })]);
    expect(result.prioritizedFindings).toEqual([]);
    expect(result.monthlyActionPlan).toEqual({ month1: [], month2: [], month3: [] });
  });
});
