/**
 * Runs the evaluation harness across every bundle in a directory.
 *
 *   npm run evals -- [--dir fixtures/golden] [--label baseline]
 *
 * Exits non-zero if the hallucination gate fails, so the gate is a build
 * condition rather than something a human has to remember to read.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEvidenceBundle, type EvidenceBundle } from "@/lib/pipeline/evidence-bundle";
import { runEvaluation } from "./harness";

function loadBundles(dir: string): EvidenceBundle[] {
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    console.error(`No bundle directory at ${dir}. Capture some first: npm run capture -- <url>`);
    process.exit(1);
  }
  if (entries.length === 0) {
    console.error(`No .json bundles in ${dir}.`);
    process.exit(1);
  }
  return entries.map((name) =>
    parseEvidenceBundle(JSON.parse(readFileSync(join(dir, name), "utf8"))),
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf("--dir");
  const labelIndex = args.indexOf("--label");
  const dir = resolve(dirIndex >= 0 ? (args[dirIndex + 1] as string) : "fixtures/golden");
  const label = labelIndex >= 0 ? (args[labelIndex + 1] as string) : "run";

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      "ANTHROPIC_API_KEY is not set. The judge cannot run without it — add it to .env.local.",
    );
    process.exit(1);
  }

  const bundles = loadBundles(dir);
  console.error(`Evaluating ${bundles.length} bundle(s) from ${dir} ...`);

  const outcome = await runEvaluation({ bundles, apiKey });

  const outDir = resolve("evals/results");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(
    outDir,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}.json`,
  );
  writeFileSync(outPath, `${JSON.stringify(outcome, null, 2)}\n`, "utf8");

  if (outcome.kind === "harness-self-test") {
    console.error(`\nREFUSED TO SCORE\n${outcome.refusal}\n`);
    console.error("Mechanical checks (does the harness work end to end?):");
    for (const check of outcome.mechanicalChecks) {
      console.error(
        `  ${check.websiteUrl}: analysis shippable=${check.analysisShippable}, ` +
          `judge verdict=${check.judgeReturnedStructuredVerdict}, findings=${check.findingCount}`,
      );
    }
    console.error(`\nCost: $${outcome.totalCostUsd.toFixed(5)}   Written to ${outPath}`);
    process.exit(0);
  }

  const { aggregate, hallucinationGate } = outcome;
  console.log(`\nGolden set: ${aggregate.siteCount} sites`);
  console.log(`Prompt fingerprint: ${outcome.promptFingerprint}   git: ${outcome.gitSha ?? "?"}`);
  console.log("");
  console.log(`  Evidence fidelity : ${aggregate.meanEvidenceFidelity.toFixed(2)} / 5`);
  console.log(`  Specificity       : ${aggregate.meanSpecificity.toFixed(2)} / 5`);
  console.log(`  Actionability     : ${aggregate.meanActionability.toFixed(2)} / 5`);
  console.log(`  Prioritization    : ${aggregate.meanPrioritization.toFixed(2)} / 5`);
  console.log(`  Would pay $29     : ${(aggregate.wouldPayRate * 100).toFixed(0)}%`);
  console.log("");
  console.log(
    `  Scan cost  min $${aggregate.scanCostUsd.min.toFixed(5)}  median $${aggregate.scanCostUsd.median.toFixed(5)}  ` +
      `p95 $${aggregate.scanCostUsd.p95.toFixed(5)}  max $${aggregate.scanCostUsd.max.toFixed(5)}`,
  );
  console.log(`  (use this to reset the provisional per-scan ceiling in lib/budget.ts)`);
  console.log("");
  console.log("Per site:");
  for (const site of outcome.sites) {
    console.log(
      `  ${site.hallucinationCount === 0 ? "OK  " : "HALL"} ${site.websiteUrl}  ` +
        `score ${site.overallScore}/100 ${site.letterGrade}  ` +
        `fid ${site.evidenceFidelity} spec ${site.specificity} act ${site.actionability} pri ${site.prioritization}  ` +
        `pay ${site.wouldPay ? "yes" : "no"}  hallucinations ${site.hallucinationCount}`,
    );
  }
  console.log(`\nWritten to ${outPath}`);

  if (!hallucinationGate.passed) {
    console.error(
      `\nHALLUCINATION GATE FAILED: ${hallucinationGate.totalHallucinations} finding(s) cite evidence that does not support them. ` +
        `This is a bug, not a tuning issue.`,
    );
    process.exit(1);
  }
  console.log("\nHallucination gate PASSED (0 unsupported findings).");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
