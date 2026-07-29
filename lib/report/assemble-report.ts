import type { Finding } from "@/agents/shared/schemas";
import type { SynthesisInput } from "@/agents/report-synthesis";

/**
 * One category agent's validated output, as needed to assemble a report.
 * `category` matches the agent's `type` string (e.g. "technical_analysis").
 */
export type CategoryReportInput = {
  category: string;
  score: number | null;
  categorySummary: string;
  findings: Finding[];
};

export type PrioritizedFinding = Finding & {
  category: string;
  priorityRank: number;
};

export type MonthlyActionPlan = {
  month1: PrioritizedFinding[];
  month2: PrioritizedFinding[];
  month3: PrioritizedFinding[];
};

export type LetterGrade = "A" | "B" | "C" | "D" | "F";

export type AssembledReport = {
  overallScore: number;
  letterGrade: LetterGrade;
  prioritizedFindings: PrioritizedFinding[];
  monthlyActionPlan: MonthlyActionPlan;
  /** Feeds directly into the Report Synthesis agent's AgentContext.synthesisInput. */
  synthesisInput: Omit<SynthesisInput, "overallScore" | "letterGrade">;
};

const SEVERITY_ORDER: Record<Finding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};
const EFFORT_ORDER: Record<Finding["effortLevel"], number> = {
  low: 0,
  medium: 1,
  high: 2,
};
const MONTHLY_PLAN_CHUNK_SIZE = 4;

/**
 * Everything in this function is plain code — no LLM call, no LLM
 * arithmetic — per docs/18-m1b-ai-agent-architecture.md §1: "the model
 * writes prose, code does arithmetic." Overall score, letter grade, the
 * prioritized checklist, and the monthly action plan are all computed
 * here, deterministically, from the five category agents' already-
 * validated findings.
 */
export function assembleReport(categoryResults: CategoryReportInput[]): AssembledReport {
  const scoredCategories = categoryResults.filter(
    (category): category is CategoryReportInput & { score: number } => category.score !== null,
  );
  if (scoredCategories.length === 0) {
    throw new Error(
      "Cannot assemble a report with zero scored categories — every category agent must have failed.",
    );
  }

  const overallScore = Math.round(
    scoredCategories.reduce((sum, category) => sum + category.score, 0) / scoredCategories.length,
  );
  const letterGrade = letterGradeFor(overallScore);

  const prioritizedFindings: PrioritizedFinding[] = categoryResults
    .flatMap((category) =>
      category.findings.map((finding) => ({ ...finding, category: category.category })),
    )
    .sort((a, b) => {
      const severityDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (severityDiff !== 0) return severityDiff;
      return EFFORT_ORDER[a.effortLevel] - EFFORT_ORDER[b.effortLevel];
    })
    .map((finding, index) => ({ ...finding, priorityRank: index + 1 }));

  const monthlyActionPlan: MonthlyActionPlan = {
    month1: prioritizedFindings.slice(0, MONTHLY_PLAN_CHUNK_SIZE),
    month2: prioritizedFindings.slice(MONTHLY_PLAN_CHUNK_SIZE, MONTHLY_PLAN_CHUNK_SIZE * 2),
    month3: prioritizedFindings.slice(MONTHLY_PLAN_CHUNK_SIZE * 2, MONTHLY_PLAN_CHUNK_SIZE * 3),
  };

  return {
    overallScore,
    letterGrade,
    prioritizedFindings,
    monthlyActionPlan,
    synthesisInput: {
      categorySummaries: categoryResults.map((category) => ({
        category: category.category,
        categorySummary: category.categorySummary,
      })),
      findings: prioritizedFindings.map((finding) => ({
        category: finding.category,
        problem: finding.problem,
        severity: finding.severity,
      })),
    },
  };
}

function letterGradeFor(score: number): LetterGrade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}
