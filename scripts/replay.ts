/**
 * Runs the full AI analysis layer against a stored evidence bundle — no
 * crawling, no PageSpeed call, no database.
 *
 *   npm run replay -- fixtures/golden/some-site.json [--json]
 *
 * The only difference from a live scan is where the bundle came from:
 * both call `runAnalysis` (lib/pipeline/run-analysis.ts), which has no
 * knowledge of its data's origin. This file deliberately imports neither
 * the crawler nor the Lighthouse agent — a test enforces that
 * (tests/unit/replay-isolation.test.ts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEvidenceBundle } from "@/lib/pipeline/evidence-bundle";
import { runAnalysis } from "@/lib/pipeline/run-analysis";
import { ScanBudget } from "@/lib/budget";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const bundlePath = args.find((arg) => !arg.startsWith("--"));
  if (!bundlePath) {
    console.error("Usage: npm run replay -- <bundle.json> [--json]");
    process.exit(1);
  }

  const bundle = parseEvidenceBundle(
    JSON.parse(readFileSync(resolve(bundlePath), "utf8")),
  );

  const budget = new ScanBudget();
  const result = await runAnalysis(bundle, { budget });

  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.shippable ? 0 : 1);
  }

  if (!result.shippable) {
    console.error(`NOT SHIPPABLE — ${result.internalReason}`);
    console.error(`User would see: ${result.userMessage}`);
    console.error(`Spent: $${result.totalCostUsd.toFixed(5)}`);
    process.exit(1);
  }

  const { assembled } = result;
  console.log(`\n${bundle.websiteUrl}  (provenance: ${bundle.provenance})`);
  console.log(`Overall: ${assembled.overallScore}/100  grade ${assembled.letterGrade}`);
  console.log(`Cost: $${result.totalCostUsd.toFixed(5)}\n`);
  console.log(`Executive summary:\n${result.executiveSummary}\n`);

  for (const finding of assembled.prioritizedFindings) {
    console.log(
      `#${finding.priorityRank} [${finding.category}/${finding.severity}/${finding.effortLevel}] ${finding.problem}`,
    );
    console.log(`   Why it matters: ${finding.whyItMatters}`);
    console.log(`   Evidence: ${finding.evidence}  (cites ${finding.evidenceIds.join(", ")})`);
    console.log(`   Recommended action: ${finding.recommendedAction}`);
    console.log(`   Expected impact: ${finding.expectedImpact}\n`);
  }

  if (result.omitted.length > 0) {
    console.log(`Omitted categories: ${result.omitted.map((o) => o.category).join(", ")}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
