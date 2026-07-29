import { describe, expect, it } from "vitest";
import { buildFallbackExecutiveSummary } from "@/agents/report-synthesis";

describe("buildFallbackExecutiveSummary", () => {
  it("states no significant issues when there are no findings", () => {
    const summary = buildFallbackExecutiveSummary({ overallScore: 95, letterGrade: "A", findings: [] });
    expect(summary).toContain("95/100");
    expect(summary).toContain("grade A");
    expect(summary).toContain("No significant issues");
  });

  it("names the single most severe finding when findings exist", () => {
    const summary = buildFallbackExecutiveSummary({
      overallScore: 62,
      letterGrade: "D",
      findings: [
        { category: "seo_analysis", problem: "Missing meta description on 3 pages.", severity: "medium" },
        { category: "technical_analysis", problem: "Homepage takes 6.1s to load on mobile.", severity: "critical" },
        { category: "trust_credibility", problem: "No licensing info anywhere on the site.", severity: "high" },
      ],
    });
    expect(summary).toContain("62/100");
    expect(summary).toContain("grade D");
    expect(summary).toContain("Homepage takes 6.1s to load on mobile.");
    expect(summary).not.toContain("Missing meta description");
  });

  it("never contains a dollar figure or lost-lead claim", () => {
    const summary = buildFallbackExecutiveSummary({
      overallScore: 70,
      letterGrade: "C",
      findings: [{ category: "copywriting", problem: "Generic homepage copy.", severity: "low" }],
    });
    expect(summary).not.toMatch(/\$\d/);
    expect(summary).not.toMatch(/lost leads?/i);
  });
});
