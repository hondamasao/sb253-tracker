/**
 * When is a partially-failed scan still worth delivering?
 *
 * The policy names categories rather than counting them
 * (docs/19-m1c-security-and-evaluation.md §5). A count hides which
 * categories are missing, and the categories are not interchangeable: a
 * report missing its speed and search-visibility analysis is not 60% of a
 * report, it's a different and much weaker product.
 */

export const MANDATORY_CATEGORIES = ["technical_analysis", "seo_analysis"] as const;

export const DEGRADABLE_CATEGORIES = [
  "conversion_optimization",
  "trust_credibility",
  "copywriting",
] as const;

/** At most one degradable category may be missing from a shipped report. */
export const MAX_DEGRADABLE_FAILURES = 1;

/** Retries per category agent before its failure is treated as final. */
export const MAX_AGENT_RETRIES = 2;

export type CategoryFailure = { category: string; reason: string };

export type OmittedCategory = {
  category: string;
  reason: string;
  /** Shown to the customer in the report body — never only in the database. */
  disclosure: string;
};

export type ShippabilityVerdict =
  | { shippable: true; omitted: OmittedCategory[] }
  | { shippable: false; internalReason: string; userMessage: string };

const CATEGORY_LABELS: Record<string, string> = {
  technical_analysis: "Technical health",
  seo_analysis: "Search visibility (SEO)",
  conversion_optimization: "Getting visitors to contact you",
  trust_credibility: "Trust and credibility",
  copywriting: "Website copy and messaging",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/**
 * Decides whether a scan may produce a report at all.
 *
 * Ordering is deliberate: the two "the analysis was cut short" conditions
 * are checked first and are unconditional. A budget breach or an
 * analysis-phase timeout stops the work at an arbitrary point, which is
 * categorically different from a category that ran to completion and
 * legitimately found nothing. Shipping the first as though it were the
 * second would present a truncated report as a complete one — so no
 * number of completed categories can rescue it.
 */
export function assessShippability(input: {
  succeeded: string[];
  failed: CategoryFailure[];
  budgetBreached: boolean;
  analysisDeadlineExceeded: boolean;
}): ShippabilityVerdict {
  if (input.budgetBreached) {
    return {
      shippable: false,
      internalReason:
        "Per-scan cost ceiling reached; analysis was truncated at an arbitrary point.",
      userMessage:
        "We couldn't finish analysing your site, so we haven't produced a report. You have not been charged. Please try again — if it keeps happening, the site may be unusually large.",
    };
  }

  if (input.analysisDeadlineExceeded) {
    return {
      shippable: false,
      internalReason:
        "Analysis-phase wall-clock budget exhausted; analysis was truncated at an arbitrary point.",
      userMessage:
        "Analysing your site took longer than expected, so we stopped rather than send you a partial report. You have not been charged. Please try again.",
    };
  }

  const failedMandatory = input.failed.filter((failure) =>
    (MANDATORY_CATEGORIES as readonly string[]).includes(failure.category),
  );
  if (failedMandatory.length > 0) {
    const names = failedMandatory.map((f) => categoryLabel(f.category)).join(" and ");
    return {
      shippable: false,
      internalReason: `Mandatory categories failed: ${failedMandatory
        .map((f) => `${f.category} (${f.reason})`)
        .join("; ")}`,
      userMessage: `We couldn't complete the ${names} part of your report, and that's too central to leave out. We haven't produced a report and you have not been charged. Please try again.`,
    };
  }

  const failedDegradable = input.failed.filter((failure) =>
    (DEGRADABLE_CATEGORIES as readonly string[]).includes(failure.category),
  );
  if (failedDegradable.length > MAX_DEGRADABLE_FAILURES) {
    return {
      shippable: false,
      internalReason: `${failedDegradable.length} degradable categories failed (limit ${MAX_DEGRADABLE_FAILURES}): ${failedDegradable
        .map((f) => f.category)
        .join(", ")}`,
      userMessage:
        "Too much of the analysis failed to complete for the report to be worth sending. You have not been charged. Please try again.",
    };
  }

  return {
    shippable: true,
    omitted: failedDegradable.map((failure) => ({
      category: failure.category,
      reason: failure.reason,
      disclosure: `${categoryLabel(failure.category)}: this section could not be completed for this scan, so it has been left out of your report rather than filled with guesswork.`,
    })),
  };
}

/**
 * Appends omission disclosures to the executive summary so the gap is
 * visible in the report's own prose. The structured `omitted` list is
 * stored separately for rendering, but this guarantees the disclosure is
 * in the body text itself and cannot be lost by a renderer that forgets
 * to display a field.
 */
export function discloseOmissionsInSummary(
  executiveSummary: string,
  omitted: OmittedCategory[],
): string {
  if (omitted.length === 0) return executiveSummary;
  const notes = omitted.map((o) => o.disclosure).join(" ");
  return `${executiveSummary}\n\nOne note on what's missing: ${notes}`;
}

/**
 * Transient failures are worth retrying; deterministic ones are not.
 * Retrying a missing API key or a schema violation just spends the same
 * money to get the same answer, and retrying a budget breach would
 * defeat the ceiling that raised it.
 */
export function isRetriableFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  if (/Missing required environment variable/i.test(message)) return false;
  if (/cost ceiling/i.test(message)) return false;
  if (/Failed to parse structured output/i.test(message)) return false;

  return (
    /\b429\b|rate.?limit/i.test(message) ||
    /\b5\d{2}\b/.test(message) ||
    /timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|overloaded/i.test(message)
  );
}
