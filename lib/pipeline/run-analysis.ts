// Imported from their own modules rather than the `@/agents` barrel on
// purpose: the barrel re-exports the capture-phase agents (lighthouse,
// site_signals), which would drag the crawler and PageSpeed client into
// the replay module graph. Importing directly keeps replay's closure free
// of anything that can touch the network, which
// tests/unit/replay-isolation.test.ts asserts statically.
import { technicalAnalysisAgent } from "@/agents/technical-analysis";
import { seoAnalysisAgent } from "@/agents/seo-analysis";
import { conversionOptimizationAgent } from "@/agents/conversion-optimization";
import { trustCredibilityAgent } from "@/agents/trust-credibility";
import {
  reportSynthesisAgent,
  buildFallbackExecutiveSummary,
  type SynthesisRawOutput,
} from "@/agents/report-synthesis";
import { copywritingAgent } from "@/agents/copywriting";
import type { Agent, AgentContext } from "@/agents/types";
import type { CategoryAgentRawOutput } from "@/agents/shared/call-category-agent";
import type { Finding } from "@/agents/shared/schemas";
import { assembleReport, type AssembledReport, type CategoryReportInput } from "@/lib/report/assemble-report";
import { ScanBudget, BudgetExceededError } from "@/lib/budget";
import { Deadline } from "@/lib/deadline";
import type { EvidenceBundle } from "./evidence-bundle";
import {
  assessShippability,
  discloseOmissionsInSummary,
  isRetriableFailure,
  MAX_AGENT_RETRIES,
  type CategoryFailure,
  type OmittedCategory,
} from "./failure-policy";

/** Wall-clock budget for the analysis phase, separate from the crawl's. */
export const MAX_ANALYSIS_WALL_CLOCK_MS = 120_000;

const CATEGORY_AGENTS: Agent[] = [
  technicalAnalysisAgent,
  seoAnalysisAgent,
  conversionOptimizationAgent,
  trustCredibilityAgent,
  copywritingAgent,
];

export type AgentRunRecord =
  | {
      status: "completed";
      agentType: string;
      score: number | null;
      raw: Record<string, unknown>;
      modelUsed?: string;
      costUsd?: number;
      findings?: Finding[];
    }
  | { status: "failed"; agentType: string; error: string };

export type AnalysisResult =
  | {
      shippable: true;
      assembled: AssembledReport;
      executiveSummary: string;
      omitted: OmittedCategory[];
      agentRuns: AgentRunRecord[];
      totalCostUsd: number;
    }
  | {
      shippable: false;
      internalReason: string;
      userMessage: string;
      agentRuns: AgentRunRecord[];
      totalCostUsd: number;
    };

/**
 * The entire AI analysis phase, as one pure-ish function over an evidence
 * bundle.
 *
 * This is the shared code path behind both modes
 * (docs/19-m1c-security-and-evaluation.md §2). The live Inngest job crawls
 * a site, builds a bundle, and calls this. The replay CLI reads a bundle
 * from disk and calls this. There is no mode flag and no branch on
 * provenance anywhere below — the function has no way to know where its
 * bundle came from, which is what makes "replay substitutes the data
 * source only" a structural property rather than a claim.
 *
 * Deliberately free of Inngest, the database, and the crawler: it takes
 * data in and returns data out, so replay costs nothing but an Anthropic
 * key and the harness can call it in a loop.
 */
export async function runAnalysis(
  bundle: EvidenceBundle,
  options: { budget?: ScanBudget; deadline?: Deadline; scanId?: string } = {},
): Promise<AnalysisResult> {
  const budget = options.budget ?? new ScanBudget();
  const deadline = options.deadline ?? new Deadline(MAX_ANALYSIS_WALL_CLOCK_MS);

  const baseContext: AgentContext = {
    scanId: options.scanId ?? "replay",
    websiteUrl: bundle.websiteUrl,
    lighthouse: bundle.lighthouse,
    siteSignals: bundle.siteSignals,
    budget,
  };

  const settled = await Promise.all(
    CATEGORY_AGENTS.map((agent) => runWithRetries(agent, baseContext, deadline)),
  );

  const agentRuns: AgentRunRecord[] = [...settled];
  const succeeded = settled.filter(
    (run): run is Extract<AgentRunRecord, { status: "completed" }> =>
      run.status === "completed",
  );
  const failed: CategoryFailure[] = settled
    .filter((run): run is Extract<AgentRunRecord, { status: "failed" }> => run.status === "failed")
    .map((run) => ({ category: run.agentType, reason: run.error }));

  const verdict = assessShippability({
    succeeded: succeeded.map((run) => run.agentType),
    failed,
    budgetBreached: budget.hasBreached,
    analysisDeadlineExceeded: deadline.hasExpired(),
  });

  if (!verdict.shippable) {
    return {
      shippable: false,
      internalReason: verdict.internalReason,
      userMessage: verdict.userMessage,
      agentRuns,
      totalCostUsd: budget.spentUsd,
    };
  }

  const categoryInputs: CategoryReportInput[] = succeeded.map((run) => ({
    category: run.agentType,
    score: run.score,
    categorySummary: (run.raw as CategoryAgentRawOutput).categorySummary,
    findings: run.findings ?? [],
  }));

  const assembled = assembleReport(categoryInputs);

  // Synthesis is deliberately outside the shippability gate: it writes
  // only the executive summary, and a deterministic fallback exists, so
  // its failure degrades prose rather than invalidating the analysis.
  const synthesis = await runWithRetries(
    reportSynthesisAgent,
    {
      ...baseContext,
      synthesisInput: {
        ...assembled.synthesisInput,
        overallScore: assembled.overallScore,
        letterGrade: assembled.letterGrade,
      },
    },
    deadline,
  );
  agentRuns.push(synthesis);

  const rawSummary =
    synthesis.status === "completed"
      ? (synthesis.raw as SynthesisRawOutput).executiveSummary
      : buildFallbackExecutiveSummary({
          overallScore: assembled.overallScore,
          letterGrade: assembled.letterGrade,
          findings: assembled.synthesisInput.findings,
        });

  // A budget breach during synthesis still invalidates the run: the
  // ceiling exists to stop spend, and a report whose summary was cut off
  // mid-analysis is exactly what §5 forbids shipping.
  if (budget.hasBreached) {
    return {
      shippable: false,
      internalReason: "Per-scan cost ceiling reached during report synthesis.",
      userMessage:
        "We couldn't finish analysing your site, so we haven't produced a report. You have not been charged. Please try again.",
      agentRuns,
      totalCostUsd: budget.spentUsd,
    };
  }

  return {
    shippable: true,
    assembled,
    executiveSummary: discloseOmissionsInSummary(rawSummary, verdict.omitted),
    omitted: verdict.omitted,
    agentRuns,
    totalCostUsd: budget.spentUsd,
  };
}

/**
 * Runs one agent, retrying only failures that could plausibly succeed on
 * a second attempt (see `isRetriableFailure`). Never throws — a failure
 * becomes a record, preserving M1a's per-agent isolation so one agent
 * cannot take down the others.
 */
async function runWithRetries(
  agent: Agent,
  ctx: AgentContext,
  deadline: Deadline,
): Promise<AgentRunRecord> {
  let lastError = "";

  for (let attempt = 0; attempt <= MAX_AGENT_RETRIES; attempt++) {
    if (deadline.hasExpired()) {
      return {
        status: "failed",
        agentType: agent.type,
        error: `Analysis wall-clock budget exhausted before ${agent.type} could run.`,
      };
    }

    try {
      const output = await agent.run(ctx);
      return { status: "completed", agentType: agent.type, ...output };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);

      // A budget breach must never be retried — the ceiling that raised
      // it would be defeated by trying again.
      if (error instanceof BudgetExceededError) break;
      if (!isRetriableFailure(error)) break;
      if (attempt === MAX_AGENT_RETRIES) break;

      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }

  return { status: "failed", agentType: agent.type, error: lastError };
}
