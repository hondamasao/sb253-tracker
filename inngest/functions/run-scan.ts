import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { crawlSite, CrawlFailedError } from "@/lib/crawler";
import { lighthouseAgent, siteSignalsAgent, runAgentSafely } from "@/agents";
import {
  markScanRunning,
  markScanCompleted,
  markScanFailed,
  saveAgentRun,
} from "@/lib/scans";

type ScanRequestedEventData = { scanId: string; websiteUrl: string };

/**
 * The durable job that does the actual work of a scan. Runs independently
 * of the HTTP request that triggered it — see docs/05-api-architecture.md
 * and docs/17-m1-crawler-architecture.md §6 for why this has to be a
 * background job rather than a normal API route (a full crawl + PageSpeed
 * call routinely takes 30-60s, far past what's safe to hold an HTTP
 * request open for).
 *
 * Failure handling (docs/17-m1-crawler-architecture.md §4):
 *  - A homepage-fetch failure is unrecoverable for this scan, so it's
 *    raised as `NonRetriableError` — no point retrying the whole function
 *    when the target site's homepage genuinely can't be reached.
 *  - Each agent runs in its own step via `runAgentSafely`, which never
 *    throws — one agent's internal failure can never fail the other
 *    agent's step or the scan overall.
 *  - Any other transient failure (network blip, etc.) gets Inngest's
 *    normal retry behavior before `onFailure` marks the scan `failed`.
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

    await step.run("persist-agent-runs", async () => {
      await saveAgentRun(scanId, lighthouseResult);
      await saveAgentRun(scanId, siteSignalsResult);
    });

    await step.run("mark-scan-completed", () => markScanCompleted(scanId));

    return {
      scanId,
      agentResults: [lighthouseResult.status, siteSignalsResult.status],
    };
  },
);
