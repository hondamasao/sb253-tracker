/**
 * Diffs two stored eval runs into a side-by-side delta table.
 *
 *   npm run evals:compare -- evals/results/<baseline>.json evals/results/<after>.json
 *
 * This is what makes "show me the score delta for each change" mechanical
 * rather than a matter of remembering last week's numbers. The prompt
 * fingerprint is printed for both runs: if it is unchanged, any movement
 * is model nondeterminism rather than an effect of an edit.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EvaluationOutcome } from "./harness";

function load(path: string): EvaluationOutcome {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as EvaluationOutcome;
}

function row(label: string, before: number, after: number, decimals = 2): string {
  const delta = after - before;
  const sign = delta > 0 ? "+" : "";
  const arrow = delta === 0 ? "  " : delta > 0 ? "up" : "dn";
  return (
    `  ${label.padEnd(20)} ${before.toFixed(decimals).padStart(7)} -> ${after.toFixed(decimals).padStart(7)}` +
    `   ${sign}${delta.toFixed(decimals).padStart(6)} ${arrow}`
  );
}

function main(): void {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) {
    console.error("Usage: npm run evals:compare -- <before.json> <after.json>");
    process.exit(1);
  }

  const before = load(beforePath);
  const after = load(afterPath);

  if (before.kind !== "measurement" || after.kind !== "measurement") {
    console.error(
      "Both runs must be measurements. A run containing authored fixtures has no scores to compare — " +
        "that is the structural quarantine working as intended, not an error to work around.",
    );
    process.exit(1);
  }

  console.log(`\nBEFORE  ${before.generatedAt}  prompts ${before.promptFingerprint}  git ${before.gitSha ?? "?"}`);
  console.log(`AFTER   ${after.generatedAt}  prompts ${after.promptFingerprint}  git ${after.gitSha ?? "?"}`);
  if (before.promptFingerprint === after.promptFingerprint) {
    console.log(
      "\nNOTE: prompt fingerprints are identical — any movement below is model nondeterminism, not the effect of a prompt change.",
    );
  }
  console.log("");

  console.log(row("Evidence fidelity", before.aggregate.meanEvidenceFidelity, after.aggregate.meanEvidenceFidelity));
  console.log(row("Specificity", before.aggregate.meanSpecificity, after.aggregate.meanSpecificity));
  console.log(row("Actionability", before.aggregate.meanActionability, after.aggregate.meanActionability));
  console.log(row("Prioritization", before.aggregate.meanPrioritization, after.aggregate.meanPrioritization));
  console.log(row("Would-pay rate", before.aggregate.wouldPayRate, after.aggregate.wouldPayRate));
  console.log(
    row("Hallucinations", before.aggregate.totalHallucinations, after.aggregate.totalHallucinations, 0),
  );
  console.log(row("Median scan cost", before.aggregate.scanCostUsd.median, after.aggregate.scanCostUsd.median, 5));

  console.log("");
  if (after.aggregate.totalHallucinations > 0) {
    console.log(
      `Hallucination gate: FAILING (${after.aggregate.totalHallucinations}). No score improvement offsets this.`,
    );
    process.exit(1);
  }
  console.log("Hallucination gate: PASSING (0 unsupported findings).");
}

main();
