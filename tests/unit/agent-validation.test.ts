import { describe, expect, it } from "vitest";
import {
  passesBannedContentRules,
  validateCategorySummary,
  validateFinding,
} from "@/agents/shared/validation";
import type { EvidenceItem } from "@/agents/shared/evidence";
import type { Finding } from "@/agents/shared/schemas";

const evidenceList: EvidenceItem[] = [
  { id: "EV1", fact: 'Homepage title tag: "Home — Welcome to Our Website."' },
  { id: "EV2", fact: "PageSpeed mobile performance score: 41/100." },
];

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    problem: 'Your homepage title tag is "Home — Welcome to Our Website."',
    whyItMatters: "It doesn't mention your service or area, hurting local search visibility.",
    evidence: 'Homepage title tag reads "Home — Welcome to Our Website" (EV1).',
    evidenceIds: ["EV1"],
    recommendedAction: 'Change the title tag to include your service and city, e.g. "Emergency Plumber in Dayton, OH."',
    expectedImpact: "A descriptive title makes it far more likely search engines show this page for local searches.",
    severity: "high",
    effortLevel: "low",
    beforeExample: null,
    afterExample: null,
    ...overrides,
  };
}

describe("validateFinding", () => {
  it("passes a well-formed, evidence-grounded finding", () => {
    expect(validateFinding(finding(), evidenceList)).toEqual({ ok: true });
  });

  it("rejects a finding citing an evidence ID that doesn't exist in this scan's list", () => {
    const result = validateFinding(finding({ evidenceIds: ["EV99"] }), evidenceList);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("EV99");
  });

  it("rejects a finding using a banned generic filler phrase", () => {
    const result = validateFinding(
      finding({ recommendedAction: "You could benefit from improved SEO practices." }),
      evidenceList,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("banned generic phrase");
  });

  it("rejects a finding stating a dollar figure", () => {
    const result = validateFinding(
      finding({ expectedImpact: "Fixing this could be worth an extra $500 per month." }),
      evidenceList,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a finding claiming lost leads/calls", () => {
    const result = validateFinding(
      finding({ whyItMatters: "You are likely losing 12 leads per month because of this." }),
      evidenceList,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a finding whose evidence field lacks a concrete number or quoted detail", () => {
    const result = validateFinding(
      finding({ evidence: "The homepage title is not descriptive enough for search engines." }),
      evidenceList,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("specificity");
  });

  it("accepts evidence with only a digit (no quote) as sufficiently concrete", () => {
    const result = validateFinding(
      finding({ evidence: "PageSpeed mobile performance score is 41 out of 100 (EV2)." }),
      evidenceList,
    );
    expect(result.ok).toBe(true);
  });
});

describe("passesBannedContentRules", () => {
  it("passes clean prose", () => {
    expect(passesBannedContentRules("This site scored 82/100 overall.")).toBe(true);
  });

  it("fails prose containing a banned filler phrase", () => {
    expect(passesBannedContentRules("Your site could benefit from a redesign.")).toBe(false);
  });

  it("fails prose containing a revenue/lost-lead claim", () => {
    expect(passesBannedContentRules("This is costing you an estimated $1,200 in revenue.")).toBe(false);
  });
});

describe("validateCategorySummary", () => {
  it("returns the summary unchanged when it passes the banned-content rules", () => {
    expect(validateCategorySummary("No significant issues were found in this category.")).toBe(
      "No significant issues were found in this category.",
    );
  });

  it("replaces a summary that violates the banned-content rules with a safe fallback", () => {
    const result = validateCategorySummary("Your site could benefit from more calls to action.");
    expect(result).toBe("No further summary is available for this category on this scan.");
  });
});
