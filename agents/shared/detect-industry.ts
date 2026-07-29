/**
 * Best-effort, deterministic trade guess from crawled page text.
 *
 * The MVP's scan input is a bare URL — there is no account, intake form, or
 * `industry` field to read (see docs/15-mvp-scope-and-m0-plan.md §1.1/§1.4).
 * docs/16-report-quality-standard.md §5.7 still asks for trade-aware
 * framing, so this is a lightweight, keyword-count heuristic that gives
 * agents an optional hint — never a fact asserted to the customer, and
 * never itself cited as evidence for a finding. When no trade keyword
 * clears the bar, agents fall back to trade-neutral framing (licensing,
 * insurance, and response-time claims apply broadly across home-service
 * trades) rather than guessing wrong.
 */
const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  plumbing: ["plumber", "plumbing", "drain cleaning", "water heater", "leak detection"],
  hvac: ["hvac", "air conditioning", "furnace", "heat pump", "ductwork", "ac repair"],
  roofing: ["roofing", "roofer", "shingle", "roof repair", "roof replacement", "storm damage"],
  electrical: ["electrician", "electrical", "wiring", "circuit breaker", "panel upgrade"],
};

export function detectIndustry(pageTexts: string[]): string | null {
  const combined = pageTexts.join(" ").toLowerCase();

  let best: { industry: string; count: number } | null = null;
  for (const [industry, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    const count = keywords.reduce(
      (total, keyword) => total + (combined.includes(keyword) ? 1 : 0),
      0,
    );
    if (count > 0 && (!best || count > best.count)) {
      best = { industry, count };
    }
  }
  return best?.industry ?? null;
}
