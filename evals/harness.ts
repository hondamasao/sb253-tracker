import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { buildCategorySystemPrompt, buildSynthesisSystemPrompt } from "@/agents/shared/prompt";
import { runAnalysis } from "@/lib/pipeline/run-analysis";
import { ScanBudget } from "@/lib/budget";
import { evalSpendCapUsd } from "@/lib/budget";
import {
  containsAuthoredFixture,
  type EvidenceBundle,
} from "@/lib/pipeline/evidence-bundle";
import { judgeReport, JUDGE_MODEL, type JudgeVerdict } from "./judge";
import type { JudgeReportInput } from "./types";

export type SiteScorecard = {
  websiteUrl: string;
  overallScore: number;
  letterGrade: string;
  findingCount: number;
  hallucinationCount: number;
  evidenceFidelity: number;
  specificity: number;
  actionability: number;
  prioritization: number;
  wouldPay: boolean;
  verdict: JudgeVerdict;
  analysisCostUsd: number;
  judgeCostUsd: number;
};

export type Aggregate = {
  siteCount: number;
  meanEvidenceFidelity: number;
  meanSpecificity: number;
  meanActionability: number;
  meanPrioritization: number;
  wouldPayRate: number;
  totalHallucinations: number;
  /** Real measured cost — the data that resets the provisional ceiling. */
  scanCostUsd: { min: number; median: number; p95: number; max: number };
};

/**
 * The harness's output is a discriminated union, and that is the
 * structural quarantine (docs/19-m1c-security-and-evaluation.md §3).
 *
 * A run containing any `authored-fixture` bundle returns the
 * `harness-self-test` variant, which has **no `aggregate` field and no
 * `sites` scorecards at all**. It is not that we decline to print them —
 * the type does not carry them, so no caller can format a number we
 * wrote ourselves into something that looks like a quality measurement.
 * Provenance is read from the bundle, never the filename, so copying or
 * renaming a fixture cannot launder it into the golden set.
 */
export type EvaluationOutcome =
  | {
      kind: "measurement";
      generatedAt: string;
      gitSha: string | null;
      promptFingerprint: string;
      judgeModel: string;
      sites: SiteScorecard[];
      aggregate: Aggregate;
      hallucinationGate: { passed: boolean; totalHallucinations: number };
      totalCostUsd: number;
    }
  | {
      kind: "harness-self-test";
      generatedAt: string;
      refusal: string;
      /** Mechanical pass/fail only — never quality scores. */
      mechanicalChecks: Array<{
        websiteUrl: string;
        analysisShippable: boolean;
        judgeReturnedStructuredVerdict: boolean;
        findingCount: number;
      }>;
      totalCostUsd: number;
    };

/**
 * The quarantine decision, extracted so it is directly testable and so
 * there is exactly one place that makes it. Reads provenance from the
 * bundle contents — never a filename, never a directory — so copying or
 * renaming a fixture cannot launder it into a measurable run.
 */
export function evaluationMode(
  bundles: EvidenceBundle[],
): "measurement" | "harness-self-test" {
  return containsAuthoredFixture(bundles) ? "harness-self-test" : "measurement";
}

const REFUSAL =
  "This run contains at least one authored-fixture bundle, so it cannot produce an aggregate score, a baseline, or a per-site scorecard. " +
  "Those numbers would be derived from sites we wrote ourselves and would flatter our own prompts — the fixtures exist to prove the harness works mechanically, nothing more. " +
  "Capture real sites with `npm run capture` to produce a measurable run.";

/**
 * A hash of the exact system prompts used to generate reports. Stored on
 * every run so a score delta can be attributed: same fingerprint means
 * any movement is model nondeterminism, a changed fingerprint means a
 * prompt edit is in play.
 */
export function promptFingerprint(): string {
  const material = [buildCategorySystemPrompt("<category guidance placeholder>"), buildSynthesisSystemPrompt()].join(
    "\n---\n",
  );
  return createHash("sha256").update(material).digest("hex").slice(0, 12);
}

function currentGitSha(): string | null {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/** Renders the raw crawl facts as the ground truth the judge checks against. */
export function renderBundleForJudge(bundle: EvidenceBundle): string {
  const lines: string[] = [];

  if (bundle.lighthouse) {
    const { categoryScores, coreWebVitals } = bundle.lighthouse;
    lines.push("## PageSpeed Insights (mobile)");
    lines.push(`Performance: ${categoryScores.performance ?? "n/a"}/100`);
    lines.push(`Accessibility: ${categoryScores.accessibility ?? "n/a"}/100`);
    lines.push(`Best practices: ${categoryScores.bestPractices ?? "n/a"}/100`);
    lines.push(`SEO: ${categoryScores.seo ?? "n/a"}/100`);
    lines.push(
      `Largest Contentful Paint: ${coreWebVitals.largestContentfulPaintMs ?? "n/a"}ms; ` +
        `Cumulative Layout Shift: ${coreWebVitals.cumulativeLayoutShift ?? "n/a"}; ` +
        `Total Blocking Time: ${coreWebVitals.totalBlockingTimeMs ?? "n/a"}ms`,
    );
    lines.push("");
  } else {
    lines.push("## PageSpeed Insights\n(not available for this scan)\n");
  }

  const { ssl, robots, sitemap, pages, technicalIssues } = bundle.siteSignals;
  lines.push("## Site-level");
  lines.push(`HTTPS on final URL: ${ssl.finalUrlIsHttps}; certificate valid: ${ssl.certificateValid}`);
  lines.push(`robots.txt fetched: ${robots.fetched}; homepage allowed: ${robots.homepageAllowed}`);
  lines.push(`sitemap.xml fetched: ${sitemap.fetched} (${sitemap.urls.length} URLs)`);
  lines.push("");

  for (const page of pages) {
    lines.push(`## Page: ${page.url}`);
    lines.push(`Title: ${page.title === null ? "(none)" : `"${page.title}"`}`);
    lines.push(
      `Meta description: ${page.metaDescription === null ? "(none)" : `"${page.metaDescription}"`}`,
    );
    lines.push(`Canonical: ${page.canonicalUrl ?? "(none)"}; noindex: ${page.isNoIndex}`);
    lines.push(
      `Headings: ${page.headings.map((h) => `H${h.level} "${h.text}"`).join("; ") || "(none)"}`,
    );
    lines.push(
      `Images: ${page.images.length} total, ${page.images.filter((i) => i.alt === null).length} missing alt`,
    );
    lines.push(
      `Structured data types: ${page.structuredData.jsonLdTypes.join(", ") || "(none)"}`,
    );
    lines.push(`Phone numbers found: ${page.phoneNumbers.join(", ") || "(none)"}`);
    lines.push(`Contact form present: ${page.hasContactForm}`);
    lines.push(`CTA phrases found: ${page.ctaPhrases.join(", ") || "(none)"}`);
    lines.push(`Trust terms found: ${page.trustSignalMentions.join(", ") || "(none)"}`);
    lines.push(`Visible text: "${page.visibleText}"`);
    lines.push("");
  }

  lines.push("## Deterministic technical issues detected");
  lines.push(
    technicalIssues
      .map((issue) => `- ${issue.type} (${issue.severity})${issue.detail ? `: ${issue.detail}` : ""}`)
      .join("\n") || "(none)",
  );

  return lines.join("\n");
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)));
  return sorted[index] as number;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

/**
 * Runs the full pipeline plus the judge across a set of bundles.
 *
 * Honours the eval spend cap: judging on Opus 5 is materially more
 * expensive per site than a scan, and a long tuning loop must not be able
 * to run unbounded.
 */
export async function runEvaluation(params: {
  bundles: EvidenceBundle[];
  apiKey: string;
  spendCapUsd?: number;
}): Promise<EvaluationOutcome> {
  const spendCap = params.spendCapUsd ?? evalSpendCapUsd();
  const isSelfTest = containsAuthoredFixture(params.bundles);
  const generatedAt = new Date().toISOString();

  type MechanicalCheck = Extract<
    EvaluationOutcome,
    { kind: "harness-self-test" }
  >["mechanicalChecks"][number];

  let spent = 0;
  const scorecards: SiteScorecard[] = [];
  const mechanicalChecks: MechanicalCheck[] = [];

  for (const bundle of params.bundles) {
    if (spent >= spendCap) {
      throw new Error(
        `Evaluation spend cap of $${spendCap.toFixed(2)} reached after ${scorecards.length + mechanicalChecks.length} sites. ` +
          `Raise EVAL_SPEND_CAP_USD to continue.`,
      );
    }

    const budget = new ScanBudget();
    const analysis = await runAnalysis(bundle, { budget });
    spent += analysis.totalCostUsd;

    if (!analysis.shippable) {
      if (isSelfTest) {
        mechanicalChecks.push({
          websiteUrl: bundle.websiteUrl,
          analysisShippable: false,
          judgeReturnedStructuredVerdict: false,
          findingCount: 0,
        });
        continue;
      }
      throw new Error(
        `Analysis was not shippable for ${bundle.websiteUrl}: ${analysis.internalReason}`,
      );
    }

    const report: JudgeReportInput = {
      websiteUrl: bundle.websiteUrl,
      overallScore: analysis.assembled.overallScore,
      letterGrade: analysis.assembled.letterGrade,
      executiveSummary: analysis.executiveSummary,
      findings: analysis.assembled.prioritizedFindings.map((finding) => ({
        priorityRank: finding.priorityRank,
        category: finding.category,
        severity: finding.severity,
        effortLevel: finding.effortLevel,
        problem: finding.problem,
        whyItMatters: finding.whyItMatters,
        evidence: finding.evidence,
        evidenceIds: finding.evidenceIds,
        recommendedAction: finding.recommendedAction,
        expectedImpact: finding.expectedImpact,
      })),
    };

    const judged = await judgeReport({
      report,
      evidence: renderBundleForJudge(bundle),
      apiKey: params.apiKey,
    });
    spent += judged.costUsd;

    if (isSelfTest) {
      mechanicalChecks.push({
        websiteUrl: bundle.websiteUrl,
        analysisShippable: true,
        judgeReturnedStructuredVerdict: true,
        findingCount: report.findings.length,
      });
      continue;
    }

    scorecards.push({
      websiteUrl: bundle.websiteUrl,
      overallScore: analysis.assembled.overallScore,
      letterGrade: analysis.assembled.letterGrade,
      findingCount: report.findings.length,
      hallucinationCount: judged.hallucinationCount,
      evidenceFidelity: judged.verdict.evidenceFidelity.score,
      specificity: judged.verdict.specificity.score,
      actionability: judged.verdict.actionability.score,
      prioritization: judged.verdict.prioritization.score,
      wouldPay: judged.verdict.wouldPay.yes,
      verdict: judged.verdict,
      analysisCostUsd: analysis.totalCostUsd,
      judgeCostUsd: judged.costUsd,
    });
  }

  if (isSelfTest) {
    return {
      kind: "harness-self-test",
      generatedAt,
      refusal: REFUSAL,
      mechanicalChecks,
      totalCostUsd: Math.round(spent * 100_000) / 100_000,
    };
  }

  const scanCosts = scorecards.map((s) => s.analysisCostUsd).sort((a, b) => a - b);
  const totalHallucinations = scorecards.reduce((sum, s) => sum + s.hallucinationCount, 0);

  return {
    kind: "measurement",
    generatedAt,
    gitSha: currentGitSha(),
    promptFingerprint: promptFingerprint(),
    judgeModel: JUDGE_MODEL,
    sites: scorecards,
    aggregate: {
      siteCount: scorecards.length,
      meanEvidenceFidelity: mean(scorecards.map((s) => s.evidenceFidelity)),
      meanSpecificity: mean(scorecards.map((s) => s.specificity)),
      meanActionability: mean(scorecards.map((s) => s.actionability)),
      meanPrioritization: mean(scorecards.map((s) => s.prioritization)),
      wouldPayRate:
        scorecards.length === 0
          ? 0
          : Math.round((scorecards.filter((s) => s.wouldPay).length / scorecards.length) * 100) / 100,
      totalHallucinations,
      scanCostUsd: {
        min: scanCosts[0] ?? 0,
        median: percentile(scanCosts, 0.5),
        p95: percentile(scanCosts, 0.95),
        max: scanCosts[scanCosts.length - 1] ?? 0,
      },
    },
    hallucinationGate: { passed: totalHallucinations === 0, totalHallucinations },
    totalCostUsd: Math.round(spent * 100_000) / 100_000,
  };
}
