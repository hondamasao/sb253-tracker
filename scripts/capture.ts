/**
 * Crawls a real site and writes its complete evidence bundle to disk.
 *
 *   npm run capture -- https://example-plumbing.com [--out fixtures/golden/slug.json]
 *
 * This is the only way to produce a `captured` bundle. Bundles written by
 * hand carry `provenance: "authored-fixture"` and are structurally barred
 * from producing a quality score (see lib/pipeline/evidence-bundle.ts and
 * evals/harness.ts).
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { crawlSite } from "@/lib/crawler";
import { lighthouseAgent, siteSignalsAgent, runAgentSafely } from "@/agents";
import type { LighthouseOutput, SiteSignalsOutput } from "@/agents";
import { EVIDENCE_BUNDLE_VERSION, type EvidenceBundle } from "@/lib/pipeline/evidence-bundle";

function slugify(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function currentGitSha(): string | null {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const websiteUrl = args.find((arg) => !arg.startsWith("--"));
  if (!websiteUrl) {
    console.error("Usage: npm run capture -- <url> [--out <path>]");
    process.exit(1);
  }

  const outFlagIndex = args.indexOf("--out");
  const outPath = resolve(
    outFlagIndex >= 0 && args[outFlagIndex + 1]
      ? (args[outFlagIndex + 1] as string)
      : `fixtures/golden/${slugify(websiteUrl)}.json`,
  );

  console.error(`Crawling ${websiteUrl} ...`);
  const crawlResult = await crawlSite(websiteUrl);

  console.error("Running capture-phase agents (Lighthouse + site signals) ...");
  const [lighthouseResult, siteSignalsResult] = await Promise.all([
    runAgentSafely(lighthouseAgent, { scanId: "capture", websiteUrl, crawlResult }),
    runAgentSafely(siteSignalsAgent, { scanId: "capture", websiteUrl, crawlResult }),
  ]);

  if (siteSignalsResult.status !== "completed") {
    console.error(`Site signals agent failed: ${siteSignalsResult.error}`);
    process.exit(1);
  }
  if (lighthouseResult.status !== "completed") {
    // Not fatal — a bundle without Lighthouse still exercises four of the
    // five categories, and recording that honestly beats silently
    // pretending the data exists.
    console.error(
      `WARNING: Lighthouse failed (${lighthouseResult.error}). Capturing without it; Technical Analysis will fail on replay.`,
    );
  }

  const bundle: EvidenceBundle = {
    version: EVIDENCE_BUNDLE_VERSION,
    provenance: "captured",
    websiteUrl,
    capturedAt: new Date().toISOString(),
    gitSha: currentGitSha(),
    lighthouse:
      lighthouseResult.status === "completed"
        ? (lighthouseResult.raw as LighthouseOutput)
        : null,
    siteSignals: siteSignalsResult.raw as SiteSignalsOutput,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  console.error(
    `Wrote ${outPath} (${bundle.siteSignals.pages.length} pages, lighthouse: ${bundle.lighthouse ? "yes" : "no"})`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
