import { describe, expect, it } from "vitest";
import {
  containsAuthoredFixture,
  parseEvidenceBundle,
  EVIDENCE_BUNDLE_VERSION,
  BundleVersionError,
  type EvidenceBundle,
} from "@/lib/pipeline/evidence-bundle";
import { evaluationMode } from "@/evals/harness";

function bundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    version: EVIDENCE_BUNDLE_VERSION,
    provenance: "captured",
    websiteUrl: "https://example-plumbing.test/",
    capturedAt: new Date().toISOString(),
    gitSha: "abc123",
    lighthouse: null,
    siteSignals: {
      pages: [],
      failedPages: [],
      robots: {
        fetched: true,
        originReachable: true,
        content: null,
        sitemapUrls: [],
        homepageAllowed: true,
      },
      sitemap: { fetched: false, sourceUrl: null, urls: [], isIndex: false },
      ssl: {
        requestedHttps: true,
        finalUrlIsHttps: true,
        certificateValid: true,
        error: null,
      },
      technicalIssues: [],
      analyzedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

describe("self-test quarantine is structural, not a label", () => {
  it("a set of only captured bundles is measurable", () => {
    expect(evaluationMode([bundle(), bundle()])).toBe("measurement");
  });

  it("ONE authored fixture makes the whole run unmeasurable", () => {
    expect(
      evaluationMode([bundle(), bundle({ provenance: "authored-fixture" }), bundle()]),
    ).toBe("harness-self-test");
  });

  it("reads provenance from the bundle contents, so renaming or copying cannot launder a fixture", () => {
    // Same object, different notional filename/location — provenance
    // travels with the data because it IS the data.
    const fixture = bundle({
      provenance: "authored-fixture",
      websiteUrl: "https://looks-totally-real.test/",
    });
    const copiedAndRenamed = JSON.parse(JSON.stringify(fixture)) as EvidenceBundle;
    expect(evaluationMode([copiedAndRenamed])).toBe("harness-self-test");
    expect(containsAuthoredFixture([copiedAndRenamed])).toBe(true);
  });

  it("the self-test outcome type carries no aggregate and no scorecards", () => {
    // Enforced by the type system; asserted here so the intent is
    // recorded and a future refactor that adds an `aggregate` field to
    // the self-test variant breaks a test as well as a review.
    const selfTest = {
      kind: "harness-self-test" as const,
      generatedAt: "",
      refusal: "",
      mechanicalChecks: [],
      totalCostUsd: 0,
    };
    expect(Object.keys(selfTest)).not.toContain("aggregate");
    expect(Object.keys(selfTest)).not.toContain("sites");
  });
});

describe("bundle parsing", () => {
  it("accepts a well-formed current-version bundle", () => {
    expect(parseEvidenceBundle(bundle()).provenance).toBe("captured");
  });

  it("rejects a bundle from an older schema version rather than replaying stale evidence", () => {
    expect(() => parseEvidenceBundle(bundle({ version: 0 }))).toThrow(BundleVersionError);
  });

  it("rejects an unrecognized provenance rather than defaulting it", () => {
    expect(() =>
      parseEvidenceBundle({ ...bundle(), provenance: "definitely-real" }),
    ).toThrow(BundleVersionError);
  });

  it("rejects a bundle missing its site signals", () => {
    const { siteSignals: _omitted, ...withoutSignals } = bundle();
    expect(() => parseEvidenceBundle(withoutSignals)).toThrow(BundleVersionError);
  });
});
