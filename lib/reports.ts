import "server-only";
import { getDb } from "@/db";
import { findings, reports, scanBenchmarks } from "@/db/schema";
import type { AssembledReport } from "@/lib/report/assemble-report";
import type { OmittedCategory } from "@/lib/pipeline/failure-policy";
import type { DetectedCms } from "@/lib/parsing/detect-cms";

export type BenchmarkMetadata = {
  industry: string | null;
  cms: DetectedCms;
  pageCount: number;
  totalCostUsd: number;
};

/**
 * Persists an assembled report, every validated finding, and the
 * benchmark row — in a single transaction.
 *
 * All three together or none: a report with only some of its findings is
 * silently wrong, and a benchmark row that can drift from the report it
 * describes is worse than no benchmark row. Writing the benchmark here
 * rather than in a later job is what guarantees we can never be unable to
 * backfill it (docs/19-m1c-security-and-evaluation.md §6).
 *
 * `is_unlocked` stays false: unlocking is the payment milestone's job.
 */
export async function saveReport(params: {
  scanId: string;
  assembled: AssembledReport;
  executiveSummary: string;
  omitted: OmittedCategory[];
  benchmark: BenchmarkMetadata;
}): Promise<{ reportId: string }> {
  const { scanId, assembled, executiveSummary, omitted, benchmark } = params;

  const monthlyActionPlan = {
    month1: assembled.monthlyActionPlan.month1.map((f) => f.priorityRank),
    month2: assembled.monthlyActionPlan.month2.map((f) => f.priorityRank),
    month3: assembled.monthlyActionPlan.month3.map((f) => f.priorityRank),
  };

  const scoreFor = (category: string): number | null =>
    assembled.categoryScores[category] ?? null;

  return getDb().transaction(async (tx) => {
    const [reportRow] = await tx
      .insert(reports)
      .values({
        scanId,
        overallScore: assembled.overallScore,
        letterGrade: assembled.letterGrade,
        executiveSummary,
        monthlyActionPlan,
        omittedCategories: omitted,
      })
      .returning({ id: reports.id });

    if (!reportRow) {
      throw new Error("Failed to create report row.");
    }

    if (assembled.prioritizedFindings.length > 0) {
      await tx.insert(findings).values(
        assembled.prioritizedFindings.map((finding) => ({
          reportId: reportRow.id,
          category: finding.category,
          severity: finding.severity,
          title: finding.problem,
          whyItMatters: finding.whyItMatters,
          evidence: finding.evidence,
          recommendation: finding.recommendedAction,
          expectedImpact: finding.expectedImpact,
          evidenceRefs: finding.evidenceIds,
          effortLevel: finding.effortLevel,
          beforeExample: finding.beforeExample,
          afterExample: finding.afterExample,
          priorityRank: finding.priorityRank,
        })),
      );
    }

    await tx.insert(scanBenchmarks).values({
      scanId,
      industry: benchmark.industry,
      cms: benchmark.cms,
      pageCount: benchmark.pageCount,
      overallScore: assembled.overallScore,
      technicalScore: scoreFor("technical_analysis"),
      seoScore: scoreFor("seo_analysis"),
      conversionScore: scoreFor("conversion_optimization"),
      trustScore: scoreFor("trust_credibility"),
      copywritingScore: scoreFor("copywriting"),
      findingCount: assembled.prioritizedFindings.length,
      criticalFindingCount: assembled.prioritizedFindings.filter(
        (f) => f.severity === "critical",
      ).length,
      totalCostUsd: benchmark.totalCostUsd.toFixed(5),
    });

    return { reportId: reportRow.id };
  });
}
