import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { crawlSite, CrawlFailedError } from "@/lib/crawler";
import {
  lighthouseAgent,
  siteSignalsAgent,
  technicalAnalysisAgent,
  seoAnalysisAgent,
  conversionOptimizationAgent,
  trustCredibilityAgent,
  copywritingAgent,
  reportSynthesisAgent,
  buildFallbackExecutiveSummary,
  runAgentSafely,
} from "@/agents";
import type {
  AgentContext,
  AgentRunResult,
  CategoryAgentRawOutput,
  LighthouseOutput,
  SiteSignalsOutput,
  SynthesisRawOutput,
} from "@/agents";
import {
  markScanRunning,
  markScanCompleted,
  markScanFailed,
  saveAgentRun,
} from "@/lib/scans";
import { assembleReport } from "@/lib/report/assemble-report";
import type { CategoryReportInput } from "@/lib/report/assemble-report";
import { saveReport } from "@/lib/reports";

type ScanRequestedEventData = { scanId: string; websiteUrl: string };
type CompletedAgentRunResult = Extract<AgentRunResult, { status: "completed" }>;

/**
 * The durable job that does the actual work of a scan. Runs independently
 * of the HTTP request that triggered it — see docs/05-api-architecture.md
 * and docs/17-m1-crawler-architecture.md §6 for why this has to be a
 * background job rather than a normal API route.
 *
 * M1b extends the M1a pipeline (crawl → lighthouse/site_signals) with the
 * AI analysis layer from docs/18-m1b-ai-agent-architecture.md: the five
 * category agents run in parallel off M1a's already-computed data, their
 * validated findings feed a deterministic report assembly (no LLM
 * arithmetic — lib/report/assemble-report.ts), and the Report Synthesis
 * agent writes only the executive summary on top of that fixed score/grade.
 *
 * Failure handling:
 *  - A homepage-fetch failure is unrecoverable, raised as `NonRetriableError`.
 *  - Every agent (all 7 in M1b) runs via `runAgentSafely`, which never
 *    throws — one agent's failure can never fail another agent's step.
 *  - If every category agent fails, there's no data to build a report
 *    from, so the scan fails outright (`NonRetriableError`) rather than
 *    saving an empty report.
 *  - If only the Report Synthesis agent fails (or its output fails the
 *    banned-content check), a plain non-AI fallback executive summary
 *    ships instead — the customer still gets a genuinely useful report.
 */
export const runScan = inngest.createFunction(
  {
    id: "run-scan",
    retries: 2,
    triggers: { event: "scan/requested" },
    onFailure: async ({ event, error }) => {
      const { scanId } = event.data.event.data as ScanRequestedEventData;
      await markScanFailed(scanId, error.message);
    },
  },
  async ({ event, step }) => {
    const { scanId, websiteUrl } = event.data as ScanRequestedEventData;

    await step.run("mark-scan-running", () => markScanRunning(scanId));

    const crawlResult = await step.run("crawl-site", async () => {
      try {
        return await crawlSite(websiteUrl);
      } catch (error) {
        if (error instanceof CrawlFailedError) {
          throw new NonRetriableError(error.message, { cause: error });
        }
        throw error;
      }
    });

    const [lighthouseResult, siteSignalsResult] = await Promise.all([
      step.run("run-lighthouse-agent", () =>
        runAgentSafely(lighthouseAgent, { scanId, websiteUrl, crawlResult }),
      ),
      step.run("run-site-signals-agent", () =>
        runAgentSafely(siteSignalsAgent, { scanId, websiteUrl, crawlResult }),
      ),
    ]);

    await step.run("persist-m1a-agent-runs", async () => {
      await saveAgentRun(scanId, lighthouseResult);
      await saveAgentRun(scanId, siteSignalsResult);
    });

    const categoryAgentContext: AgentContext = {
      scanId,
      websiteUrl,
      crawlResult,
      lighthouse:
        lighthouseResult.status === "completed"
          ? (lighthouseResult.raw as LighthouseOutput)
          : null,
      siteSignals:
        siteSignalsResult.status === "completed"
          ? (siteSignalsResult.raw as SiteSignalsOutput)
          : null,
    };

    const [technicalResult, seoResult, conversionResult, trustResult, copywritingResult] =
      await Promise.all([
        step.run("run-technical-analysis-agent", () =>
          runAgentSafely(technicalAnalysisAgent, categoryAgentContext),
        ),
        step.run("run-seo-analysis-agent", () =>
          runAgentSafely(seoAnalysisAgent, categoryAgentContext),
        ),
        step.run("run-conversion-optimization-agent", () =>
          runAgentSafely(conversionOptimizationAgent, categoryAgentContext),
        ),
        step.run("run-trust-credibility-agent", () =>
          runAgentSafely(trustCredibilityAgent, categoryAgentContext),
        ),
        step.run("run-copywriting-agent", () =>
          runAgentSafely(copywritingAgent, categoryAgentContext),
        ),
      ]);

    const categoryResults = [
      technicalResult,
      seoResult,
      conversionResult,
      trustResult,
      copywritingResult,
    ];

    await step.run("persist-category-agent-runs", async () => {
      for (const result of categoryResults) {
        await saveAgentRun(scanId, result);
      }
    });

    const successfulCategories = categoryResults.filter(
      (result): result is CompletedAgentRunResult => result.status === "completed",
    );

    if (successfulCategories.length === 0) {
      throw new NonRetriableError(
        "Every category agent (Technical, SEO, Conversion, Trust, Copywriting) failed — cannot assemble a report for this scan.",
      );
    }

    const assembled = await step.run("assemble-report", () => {
      const categoryInputs: CategoryReportInput[] = successfulCategories.map((result) => ({
        category: result.agentType,
        score: result.score,
        categorySummary: (result.raw as CategoryAgentRawOutput).categorySummary,
        findings: result.findings ?? [],
      }));
      return assembleReport(categoryInputs);
    });

    const synthesisResult = await step.run("run-report-synthesis-agent", () =>
      runAgentSafely(reportSynthesisAgent, {
        scanId,
        websiteUrl,
        crawlResult,
        synthesisInput: {
          ...assembled.synthesisInput,
          overallScore: assembled.overallScore,
          letterGrade: assembled.letterGrade,
        },
      }),
    );

    await step.run("persist-synthesis-agent-run", () => saveAgentRun(scanId, synthesisResult));

    const executiveSummary =
      synthesisResult.status === "completed"
        ? (synthesisResult.raw as SynthesisRawOutput).executiveSummary
        : buildFallbackExecutiveSummary({
            overallScore: assembled.overallScore,
            letterGrade: assembled.letterGrade,
            findings: assembled.synthesisInput.findings,
          });

    await step.run("save-report", () => saveReport({ scanId, assembled, executiveSummary }));

    await step.run("mark-scan-completed", () => markScanCompleted(scanId));

    return {
      scanId,
      agentResults: [
        lighthouseResult.status,
        siteSignalsResult.status,
        ...categoryResults.map((result) => result.status),
        synthesisResult.status,
      ],
    };
  },
);
