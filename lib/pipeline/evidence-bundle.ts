import type { LighthouseOutput } from "@/agents/lighthouse";
import type { SiteSignalsOutput } from "@/agents/site-signals";

export const EVIDENCE_BUNDLE_VERSION = 1;

/**
 * Where a bundle's data came from. This is the **structural** basis of the
 * golden-set/self-test separation (docs/19-m1c-security-and-evaluation.md §3)
 * — not a naming convention, not a directory, and deliberately not the
 * filename, so it survives copying, renaming, and moving.
 *
 *  - `captured`     — crawled from a real website by `npm run capture`.
 *  - `authored-fixture` — hand-written by us to exercise the harness.
 *
 * The evaluation harness refuses to emit an aggregate score, a baseline,
 * or anything shaped like a quality measurement for any run that contains
 * an `authored-fixture` bundle. A number derived from sites we wrote
 * ourselves must not be able to reach a summary that looks like evidence,
 * because grading our own prompts against our own fixtures flatters the
 * result in a way no disclaimer reliably corrects for.
 */
export type BundleProvenance = "captured" | "authored-fixture";

/**
 * Everything the AI analysis layer consumes, and nothing else.
 *
 * This shape isn't invented for replay — it's the input surface M1b
 * already had. The category agents read only `lighthouse` and
 * `siteSignals`; they never touch the network or the raw crawl. Freezing
 * exactly those two objects to disk is therefore sufficient to reproduce
 * an entire analysis run, which is what makes replay a genuine
 * data-source substitution rather than a parallel code path.
 */
export type EvidenceBundle = {
  version: number;
  provenance: BundleProvenance;
  websiteUrl: string;
  capturedAt: string;
  /** Git commit the capture ran at, so a scorecard ties to a known crawler. */
  gitSha: string | null;
  /** Null when the Lighthouse agent failed or was skipped during capture. */
  lighthouse: LighthouseOutput | null;
  siteSignals: SiteSignalsOutput;
};

export class BundleVersionError extends Error {}

/**
 * Parses and version-checks a bundle read from disk. A bundle written by
 * an older crawler may be missing fields the agents now expect, which
 * would silently degrade evidence quality rather than fail — so the
 * version is checked rather than trusted.
 */
export function parseEvidenceBundle(raw: unknown): EvidenceBundle {
  if (typeof raw !== "object" || raw === null) {
    throw new BundleVersionError("Evidence bundle is not an object.");
  }
  const bundle = raw as Partial<EvidenceBundle>;

  if (bundle.version !== EVIDENCE_BUNDLE_VERSION) {
    throw new BundleVersionError(
      `Evidence bundle version ${String(bundle.version)} does not match the current version ` +
        `${EVIDENCE_BUNDLE_VERSION}. Re-capture it with \`npm run capture\` rather than replaying stale evidence.`,
    );
  }
  if (bundle.provenance !== "captured" && bundle.provenance !== "authored-fixture") {
    throw new BundleVersionError(
      `Evidence bundle has an unrecognized provenance: ${String(bundle.provenance)}.`,
    );
  }
  if (!bundle.siteSignals || !bundle.websiteUrl) {
    throw new BundleVersionError("Evidence bundle is missing siteSignals or websiteUrl.");
  }

  return bundle as EvidenceBundle;
}

/** True if any bundle in the set was authored by us rather than crawled. */
export function containsAuthoredFixture(bundles: EvidenceBundle[]): boolean {
  return bundles.some((bundle) => bundle.provenance === "authored-fixture");
}
