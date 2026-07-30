import { describe, expect, it } from "vitest";
import { degradeReport, assessCalibration, MIN_CALIBRATION_DELTA } from "@/evals/degrade";
import type { JudgeReportInput } from "@/evals/types";

const report: JudgeReportInput = {
  websiteUrl: "https://acme-plumbing.test/",
  overallScore: 68,
  letterGrade: "D",
  executiveSummary:
    'Your homepage title is "Home — Welcome" and your mobile PageSpeed score is 38/100.',
  findings: [
    {
      priorityRank: 1,
      category: "seo_analysis",
      severity: "high",
      effortLevel: "low",
      problem: 'Your homepage title tag is "Home — Welcome".',
      whyItMatters: "Search engines have no reason to show you for local plumbing searches.",
      evidence: 'Homepage title tag reads "Home — Welcome" (14 characters).',
      evidenceIds: ["EV1"],
      recommendedAction: 'Change the title to "Emergency Plumber in Dayton, OH — Acme Plumbing".',
      expectedImpact: "A descriptive title makes local search listings far more likely.",
    },
  ],
};

describe("degradeReport", () => {
  it("strips the specific evidence and its citations", () => {
    const degraded = degradeReport(report, "strip-evidence");
    expect(degraded.findings[0]?.evidence).not.toContain("Home — Welcome");
    expect(degraded.findings[0]?.evidenceIds).toEqual([]);
    // The claim itself survives — it just no longer shows why it's true.
    expect(degraded.findings[0]?.problem).toBe(report.findings[0]?.problem);
  });

  it("replaces specific findings with generic advice", () => {
    const degraded = degradeReport(report, "genericise");
    expect(degraded.findings[0]?.problem).not.toContain("Home — Welcome");
    expect(degraded.findings[0]?.recommendedAction).toMatch(/review this area/i);
  });

  it("never mutates the original report", () => {
    const before = JSON.stringify(report);
    degradeReport(report, "both");
    expect(JSON.stringify(report)).toBe(before);
  });
});

describe("assessCalibration", () => {
  it("passes when the judge scores the degraded report materially lower", () => {
    const verdict = assessCalibration(
      { evidenceFidelity: 5, specificity: 5, actionability: 4 },
      { evidenceFidelity: 2, specificity: 1, actionability: 2 },
    );
    expect(verdict.discriminates).toBe(true);
    expect(verdict.delta.specificity).toBe(4);
  });

  it("FAILS when the judge scores everything in a narrow band — no signal is worse than a bad score", () => {
    const verdict = assessCalibration(
      { evidenceFidelity: 4, specificity: 4, actionability: 4 },
      { evidenceFidelity: 4, specificity: 3, actionability: 4 },
    );
    expect(verdict.discriminates).toBe(false);
    expect(verdict.notes).toMatch(/carry no signal/i);
  });

  it("uses the documented threshold", () => {
    const justUnder = assessCalibration(
      { evidenceFidelity: 5, specificity: 5, actionability: 5 },
      { evidenceFidelity: 5, specificity: 5, actionability: 5 - (MIN_CALIBRATION_DELTA - 1) },
    );
    expect(justUnder.discriminates).toBe(false);
  });
});
