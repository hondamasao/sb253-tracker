import type { JudgeReportInput } from "./types";

/**
 * Programmatically wrecks a report, for judge calibration
 * (docs/19-m1c-security-and-evaluation.md §3).
 *
 * The problem this solves: a judge that scores everything 3-4 provides no
 * signal at all, and you cannot tell that from looking at one run's
 * numbers — they'd look perfectly reasonable. The only way to know the
 * judge discriminates is to hand it something you have deliberately made
 * worse and check that the score moves. If a stripped, genericised report
 * scores about the same as the real one, the judge is broken and every
 * number it has produced is noise.
 *
 * The degradations mirror the two failure modes docs/16 exists to
 * prevent: findings with no real evidence behind them, and advice that
 * would read identically for any business.
 */

const GENERIC_REPLACEMENTS = {
  problem: "Your website has room for improvement in this area.",
  whyItMatters: "This can affect how customers perceive your business online.",
  evidence: "Our analysis of your website indicated this area needs attention.",
  recommendedAction: "Review this area of your site and make improvements.",
  expectedImpact: "Improving this should have a positive effect.",
} as const;

export type DegradationMode = "strip-evidence" | "genericise" | "both";

/**
 * Returns a copy of the report with the requested damage applied. Never
 * mutates the original — calibration compares the two side by side.
 */
export function degradeReport(
  report: JudgeReportInput,
  mode: DegradationMode = "both",
): JudgeReportInput {
  const stripEvidence = mode === "strip-evidence" || mode === "both";
  const genericise = mode === "genericise" || mode === "both";

  return {
    ...report,
    executiveSummary: genericise
      ? "Your website scored reasonably well overall, but there are several areas that could be strengthened to help your business grow online."
      : report.executiveSummary,
    findings: report.findings.map((finding) => ({
      ...finding,
      problem: genericise ? GENERIC_REPLACEMENTS.problem : finding.problem,
      whyItMatters: genericise ? GENERIC_REPLACEMENTS.whyItMatters : finding.whyItMatters,
      recommendedAction: genericise
        ? GENERIC_REPLACEMENTS.recommendedAction
        : finding.recommendedAction,
      expectedImpact: genericise
        ? GENERIC_REPLACEMENTS.expectedImpact
        : finding.expectedImpact,
      // Stripping evidence removes the specific, checkable fact — the
      // finding still *claims* something, it just no longer shows why it
      // is true. A working judge must notice.
      evidence: stripEvidence ? GENERIC_REPLACEMENTS.evidence : finding.evidence,
      evidenceIds: stripEvidence ? [] : finding.evidenceIds,
    })),
  };
}

export type CalibrationVerdict = {
  original: { evidenceFidelity: number; specificity: number; actionability: number };
  degraded: { evidenceFidelity: number; specificity: number; actionability: number };
  delta: { evidenceFidelity: number; specificity: number; actionability: number };
  /** The judge must score the degraded report materially lower to be trusted. */
  discriminates: boolean;
  notes: string;
};

/** Minimum total drop across the three dimensions for the judge to count as calibrated. */
export const MIN_CALIBRATION_DELTA = 3;

export function assessCalibration(
  original: CalibrationVerdict["original"],
  degraded: CalibrationVerdict["degraded"],
): CalibrationVerdict {
  const delta = {
    evidenceFidelity: original.evidenceFidelity - degraded.evidenceFidelity,
    specificity: original.specificity - degraded.specificity,
    actionability: original.actionability - degraded.actionability,
  };
  const total = delta.evidenceFidelity + delta.specificity + delta.actionability;
  const discriminates = total >= MIN_CALIBRATION_DELTA;

  return {
    original,
    degraded,
    delta,
    discriminates,
    notes: discriminates
      ? `Judge scored the degraded report ${total} points lower in total — it discriminates.`
      : `Judge scored the degraded report only ${total} points lower in total (threshold ${MIN_CALIBRATION_DELTA}). ` +
        `It is NOT discriminating between good and deliberately-broken reports, so its scores carry no signal and must not be used to accept or reject prompt changes.`,
  };
}
