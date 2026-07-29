import "server-only";
import { getDb } from "@/db";
import { findings, reports } from "@/db/schema";
import type { AssembledReport } from "@/lib/report/assemble-report";

/**
 * Persists an assembled report (docs/18-m1b-ai-agent-architecture.md's
 * deterministic assembly output) plus every validated finding, in a single
 * transaction — a report with only some of its findings saved would be a
 * silently-broken report, so this either fully succeeds or fully rolls
 * back. `is_unlocked` is left at its default `false`: unlocking a report
 * is M3's (payment) job, not this one's.
 *
 * The `monthly_action_plan` jsonb column stores only priority-rank numbers
 * per month (not full finding text) — the findings themselves are the
 * single source of truth, already saved as rows in `findings` with their
 * own `priority_rank`; the app joins the two at render time.
 */
export async function saveReport(params: {
  scanId: string;
  assembled: AssembledReport;
  executiveSummary: string;
}): Promise<{ reportId: string }> {
  const { scanId, assembled, executiveSummary } = params;

  const monthlyActionPlan = {
    month1: assembled.monthlyActionPlan.month1.map((finding) => finding.priorityRank),
    month2: assembled.monthlyActionPlan.month2.map((finding) => finding.priorityRank),
    month3: assembled.monthlyActionPlan.month3.map((finding) => finding.priorityRank),
  };

  return getDb().transaction(async (tx) => {
    const [reportRow] = await tx
      .insert(reports)
      .values({
        scanId,
        overallScore: assembled.overallScore,
        letterGrade: assembled.letterGrade,
        executiveSummary,
        monthlyActionPlan,
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

    return { reportId: reportRow.id };
  });
}
