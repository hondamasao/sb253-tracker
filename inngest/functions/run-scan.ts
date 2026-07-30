import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { crawlSite, CrawlFailedError } from "@/lib/crawler";
import { lighthouseAgent, siteSignalsAgent, runAgentSafely } from "@/agents";
import type { LighthouseOutput, SiteSignalsOutput } from "@/agents";
import { markScanRunning, markScanCompleted, markScanFailed, saveAgentRun } from "@/lib/scans";
import { saveReport } from "@/lib/reports";
import { runAnalysis } from "@/lib/pipeline/run-analysis";
import { EVIDENCE_BUNDLE_VERSION, type EvidenceBundle } from "@/lib/pipeline/evidence-bundle";
import { ScanBudget } from "@/lib/budget";
import { detectCmsFromPages } from "@/lib/parsing/detect-cms";
import { detectIndustry } from "@/agents/shared";

type ScanRequestedEventData = { scanId: string; websiteUrl: string };

/**
 * The durable job behind a scan. Two phases with a hard seam between
 * them:
 *
 *  1. CAPTURE — crawl the site, run the two deterministic agents, and
 *     assemble an EvidenceBundle. Everything that touches the network
 *     lives here.
 *  2. ANALYSE — hand that bundle to `runAnalysis`, which is the identical
 *     function the replay CLI calls (docs/19-m1c-security-and-evaluation.md
 *     §2). No branch below distinguishes live from replay, because the
 *     analysis layer cannot tell the difference.
 *
 * Failure handling follows the named-category policy in
 * lib/pipeline/failure-policy.ts: a report is produced only when both
 * mandatory categories succeeded and at most one degradable category
 * failed, and never when the budget or the analysis deadline was
 * exhausted. When no report is produced the scan is marked failed with a
 * customer-facing message — completeness is always known before a report
 * exists, which is what lets a later payment step charge only on success.
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

    // ---- Phase 1: capture -------------------------------------------------
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

    await step.run("persist-capture-agent-runs", async () => {
      await saveAgentRun(scanId, lighthouseResult);
      await saveAgentRun(scanId, siteSignalsResult);
    });

    if (siteSignalsResult.status !== "completed") {
      // Every category agent reads site signals; without them there is no
      // evidence to analyse at all.
      const message =
        "We couldn't read enough of your site to analyse it. You have not been charged. Please check the address and try again.";
      await step.run("mark-scan-failed-no-signals", () =>
        markScanFailed(scanId, message),
      );
      throw new NonRetriableError(`site_signals failed: ${siteSignalsResult.error}`);
    }

    const bundle: EvidenceBundle = {
      version: EVIDENCE_BUNDLE_VERSION,
      provenance: "captured",
      websiteUrl,
      capturedAt: new Date().toISOString(),
      gitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      lighthouse:
        lighthouseResult.status === "completed"
          ? (lighthouseResult.raw as LighthouseOutput)
          : null,
      siteSignals: siteSignalsResult.raw as SiteSignalsOutput,
    };

    // ---- Phase 2: analyse (identical code path as replay) -----------------
    const budget = new ScanBudget();
    const analysis = await runAnalysis(bundle, { budget, scanId });

    await step.run("persist-analysis-agent-runs", async () => {
      for (const run of analysis.agentRuns) {
        await saveAgentRun(scanId, run);
      }
    });

    if (!analysis.shippable) {
      await step.run("mark-scan-failed-unshippable", () =>
        markScanFailed(scanId, analysis.userMessage),
      );
      throw new NonRetriableError(analysis.internalReason);
    }

    await step.run("save-report", () =>
      saveReport({
        scanId,
        assembled: analysis.assembled,
        executiveSummary: analysis.executiveSummary,
        omitted: analysis.omitted,
        benchmark: {
          industry: detectIndustry(bundle.siteSignals.pages.map((p) => p.visibleText)),
          cms: detectCmsFromPages(bundle.siteSignals.pages),
          pageCount: bundle.siteSignals.pages.length,
          totalCostUsd: analysis.totalCostUsd,
        },
      }),
    );

    await step.run("mark-scan-completed", () => markScanCompleted(scanId));

    return {
      scanId,
      overallScore: analysis.assembled.overallScore,
      omittedCategories: analysis.omitted.map((o) => o.category),
      totalCostUsd: analysis.totalCostUsd,
    };
  },
);
