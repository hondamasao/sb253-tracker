import type { ParsedPage } from "./types";

/**
 * Coarse, deterministic CMS/platform detection for benchmark metadata
 * (docs/19-m1c-security-and-evaluation.md §6). Purely signature matching
 * on markup we already extracted — never a model call, and never asserted
 * to the customer as a finding. It exists so percentile comparisons can
 * later be sliced by platform ("how does this Wix site compare to other
 * Wix sites?"), which is only possible if we record it from day one.
 */
export type DetectedCms =
  | "wordpress"
  | "shopify"
  | "wix"
  | "squarespace"
  | "webflow"
  | "duda"
  | "godaddy"
  | "unknown";

const GENERATOR_SIGNATURES: Array<[RegExp, DetectedCms]> = [
  [/wordpress/i, "wordpress"],
  [/shopify/i, "shopify"],
  [/wix\.com|wix website builder/i, "wix"],
  [/squarespace/i, "squarespace"],
  [/webflow/i, "webflow"],
  [/duda/i, "duda"],
  [/godaddy|website builder/i, "godaddy"],
];

const MARKUP_SIGNATURES: Array<[RegExp, DetectedCms]> = [
  [/wp-content|wp-includes|wp-json/i, "wordpress"],
  [/cdn\.shopify\.com|shopify-section|myshopify\.com/i, "shopify"],
  [/static\.wixstatic\.com|_wixCssImports|wix-warmup-data/i, "wix"],
  [/static1\.squarespace\.com|squarespace-cdn/i, "squarespace"],
  [/assets\.website-files\.com|webflow\.js/i, "webflow"],
  [/irp\.cdn-website\.com|d1csarkz8obe9u/i, "duda"],
  [/img1\.wsimg\.com/i, "godaddy"],
];

/**
 * `generatorMeta` is the `<meta name="generator">` value when present —
 * the most reliable signal. `rawMarkupSample` is any HTML available at
 * call time; asset-host fingerprints are the fallback because most
 * builders strip the generator tag but can't avoid their own CDN.
 */
export function detectCms(params: {
  generatorMeta?: string | null;
  rawMarkupSample?: string;
}): DetectedCms {
  const generator = params.generatorMeta ?? "";
  for (const [pattern, cms] of GENERATOR_SIGNATURES) {
    if (pattern.test(generator)) return cms;
  }

  const markup = params.rawMarkupSample ?? "";
  for (const [pattern, cms] of MARKUP_SIGNATURES) {
    if (pattern.test(markup)) return cms;
  }

  return "unknown";
}

/** Convenience wrapper for the common case of "whatever we parsed". */
export function detectCmsFromPages(pages: ParsedPage[]): DetectedCms {
  for (const page of pages) {
    const detected = detectCms({
      generatorMeta: page.generatorMeta,
      rawMarkupSample: page.assetHostSample,
    });
    if (detected !== "unknown") return detected;
  }
  return "unknown";
}
