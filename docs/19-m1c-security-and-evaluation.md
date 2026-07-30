# M1c — Security Hardening and Report-Quality Measurement

**Scope.** M1a built the crawler, M1b built the AI report layer. M1c does two things before anything is publicly reachable: closes the abuse surface, and makes report quality something we can *measure* rather than assert. It also makes prompt iteration cheap, because a quality bar you can't re-measure in a minute is a quality bar nobody re-measures.

---

## 1. URL safety and abuse protection

### Already correct before this milestone

Verified by reading the code rather than assumed: scheme allowlist; IPv4 private/reserved ranges including `169.254.0.0/16`, `127/8`, `10/8`, `172.16/12`, `192.168/16`, `100.64/10`; IPv6 loopback/link-local/ULA; multi-address DNS checking; a 5-hop redirect cap; a 3 MB response ceiling enforced while streaming; an identifying User-Agent with a contact URL; robots-aware page discovery; a per-IP rate limit.

**Redirect re-validation was already correct.** `safeFetch` has always followed redirects manually and re-run the guard on every hop. This was listed as a gap in the milestone brief; it wasn't one.

### What M1c fixed

**DNS rebinding — closed by pinning, not by checking harder.** M1a's `ssrf-guard.ts` documented this as a knowingly-accepted limitation: it resolved a hostname, approved the IPs, and then `fetch()` resolved the same hostname *again* independently. An attacker serving a 1-second TTL returns a public IP to the guard and `127.0.0.1` to the connection. No amount of extra validation closes this, because the guard never sees the second answer.

The fix removes the second resolution. `assertSafeUrl` now returns the addresses it validated, and `safeFetch` builds an undici `Agent` whose `connect.lookup` can only return those addresses (`lib/crawler/pinned-dispatcher.ts`). The address we approved and the address we connect to are the same value by construction. Re-pinned per redirect hop.

**A live IPv6 bypass, found by the new tests.** `new URL()` re-serializes `[::ffff:127.0.0.1]` to its hex form `::ffff:7f00:1`. The old dotted-decimal regex never matched, so an IPv4-mapped loopback address passed the guard. This existed in M1a and was caught by writing the test. `isPrivateIPv6` now expands IPv6 numerically (`expandIPv6Groups`) instead of pattern-matching a spelling.

**Internal hostnames.** `.local`, `.localhost`, `.internal`, `.home.arpa`, `.lan`, `.intranet`, `.corp`, `.private`, bare `localhost`, and single-label hostnames are rejected **before** any DNS lookup — mDNS resolution shouldn't even be attempted, and a single-label name resolves onto the local network via search domains. No public website can carry these names, so failing closed costs nothing.

**Whole-crawl wall clock.** Per-request timeouts never bounded total time: homepage + scheme fallback + robots + sitemap + four pages could exceed a minute. One `Deadline` (`lib/deadline.ts`) is created at `crawlSite` entry and threaded through every fetch, each getting `min(perRequestTimeout, remaining)`. Extra pages degrade; the homepage is the only mandatory fetch.

**robots.txt is now honoured before the homepage is fetched.** M1a fetched the homepage first and *reported* a disallow afterwards — it took the thing it had been asked not to take. robots.txt is now fetched first and doubles as the scheme probe (it is the one URL never subject to robots rules). A disallow raises `RobotsDisallowedError` and no content request is made.

### Three independent spend ceilings

Each guards a different failure mode, and none substitutes for the others:

| Ceiling | Env var | Default | Guards against |
|---|---|---|---|
| Per-scan | `SCAN_COST_CEILING_USD` | **$0.15 (provisional)** | One runaway scan |
| Global daily | `DAILY_SPEND_CAP_USD` | $25 | Many individually-compliant scans |
| Eval runs | `EVAL_SPEND_CAP_USD` | $10 | An unbounded prompt-tuning loop |

The per-scan ceiling uses **reserve-then-settle**: worst-case cost is reserved *before* dispatch and reconciled to the real figure after. Reserving up front is load-bearing — the five category agents run concurrently, so a design that only debited actual cost would let all five start and discover the breach after the money was spent.

The daily cap is enforced at the **queue boundary** (`POST /api/scans`, before the scan row exists and before anything is enqueued). A per-IP request limit does not bound spend: 2,000 individually compliant scans from 2,000 addresses are each within their limit and collectively expensive. Aborting mid-pipeline would be worse than useless — the money is already gone and the user has a failed scan.

### The $0.15 ceiling is provisional and unverified

Two estimates disagree by 3–6×: this codebase's reasoning suggested ~$0.01–0.03/scan, the product owner's estimate is $0.06–0.10. **This is deliberately not being resolved by estimating a third time.** The ceiling stays at $0.15 until the golden set has been captured and run; `npm run evals` prints the measured min/median/p95/max, and the default is reset from that data. Until then it is a guardrail against runaway spend, not a forecast. Recorded in `lib/budget.ts` and the README.

### Per-IP rate limit: a conversion question, not a security parameter

3/hour is unchanged but now `SCANS_PER_IP_PER_HOUR`. It is keyed on IP, and the free scan is the top of the funnel — an office, a coffee shop, or anyone behind carrier-grade NAT shares one address, so the fourth genuinely interested prospect in an hour gets a 429 and probably never returns. It is env-configurable specifically so it can be raised without a redeploy once real funnel data exists. Revisit alongside conversion numbers.

---

## 2. Evidence capture and replay

**The seam already existed.** M1b's category agents read only `lighthouse` and `siteSignals` — never the network, never the raw crawl. An evidence bundle is therefore exactly those two objects plus provenance metadata; freezing them reproduces an entire analysis run.

The one structural change: the analysis half of `run-scan.ts` was extracted to `lib/pipeline/run-analysis.ts` — free of Inngest, the database, and the crawler. The live job crawls, builds a bundle, and calls it; the replay CLI reads a bundle from disk and calls it.

**Replay is not a mode flag.** There is no `if (replay)` anywhere in the analysis path, because `runAnalysis` has no way to learn where its bundle came from. Three things enforce that:

- `crawlResult` is now **optional** on `AgentContext`. The analysis phase never sets it, so the type system proves replay isn't missing anything; the capture-phase agents throw if it's absent.
- `run-analysis.ts` imports the five category agents from their own modules rather than the `@/agents` barrel, keeping the crawler and PageSpeed client out of replay's import closure entirely.
- `tests/unit/replay-isolation.test.ts` statically walks that closure and fails if it can reach `lib/crawler`, `agents/lighthouse`, or `undici`. Runtime checking would only prove one execution didn't crawl; the import closure proves none can.

```bash
npm run capture -- https://example.com --out fixtures/golden/example.json
npm run replay  -- fixtures/golden/example.json
```

---

## 3. Golden set and evaluation harness

### Judge isolation, three layers

1. **Input** — only the finished report and the raw evidence bundle. Never the prompts, the category guidance, or which model wrote what.
2. **Module** — an ESLint `no-restricted-imports` rule forbids `evals/judge/**` from importing `agents/**` or pipeline internals. Wiring a generating prompt into the judge is a build failure, not a code-review miss. This is why the judge declares its own input types in `evals/types.ts`.
3. **Model** — Opus 5, stronger than and different from both generators (Haiku 4.5, Sonnet 5). This reduces self-preference bias. It does not eliminate same-family bias, and that limitation is recorded rather than papered over.

### Evidence fidelity is not what the validator already checks

M1b's deterministic gate proves cited evidence IDs *exist*. It structurally cannot know whether the cited fact *supports* the claim — that judgement is semantic. The judge returns a per-finding `supported | unsupported` verdict, and the count of `unsupported` drives the hard gate. **`npm run evals` exits non-zero on any hallucination**, so the gate is a build condition rather than something a human must remember to read. No aggregate improvement offsets it.

### The self-test quarantine is structural

A run containing any `authored-fixture` bundle returns the `harness-self-test` variant of a discriminated union — a type that **has no `aggregate` field and no per-site scorecards at all**. It isn't that we decline to print them; no caller can format a number derived from sites we wrote into something shaped like evidence. Provenance lives in the bundle (`lib/pipeline/evidence-bundle.ts`), never in a filename or directory, so copying or renaming a fixture cannot launder it into the golden set. `npm run evals:compare` refuses to diff a self-test run for the same reason.

### Judge calibration

A judge that scores everything 3–4 provides no signal, and you cannot tell that from one run's numbers — they look reasonable. `evals/degrade.ts` programmatically wrecks a passing report (strips evidence citations, replaces findings with generic advice) and asserts the judge scores it materially lower (`MIN_CALIBRATION_DELTA`). **Judge calibration is unverified until this runs against real output.** Until it does, no score from the judge should be used to accept or reject a prompt change.

### Persistence and comparison

Each run writes `evals/results/<timestamp>-<label>.json` with per-site scorecards, the aggregate, the git SHA, the judge model, and a **hash of the system prompts**. That fingerprint is what makes runs comparable: identical fingerprint means any movement is model nondeterminism, not the effect of an edit — and `evals:compare` says so explicitly.

---

## 5. Failure policy

Named categories, not a count. A count hides *which* categories are missing, and they are not interchangeable — a report without speed and search-visibility analysis is not 60% of a report, it's a weaker product.

| Category | Class | On failure |
|---|---|---|
| Technical Analysis | **Mandatory** | Scan fails, no report, not charged |
| SEO Analysis | **Mandatory** | Scan fails, no report, not charged |
| Conversion Optimization | Degradable | At most one may be omitted |
| Trust & Credibility | Degradable | At most one may be omitted |
| Copywriting | Degradable | At most one may be omitted |

Two or more degradable failures fails the scan. Omissions are disclosed **in the report body** — appended to the executive summary itself, not only stored in `reports.omitted_categories`, so a renderer that forgets the field still shows the customer what's missing.

**Budget breach and analysis-phase timeout are always unshippable**, regardless of how many categories completed. Truncating at an arbitrary point is categorically different from a category running to completion and legitimately finding nothing; shipping the first as though it were the second presents a partial report as a complete one.

**Retries:** transient failures only (429, 5xx, timeouts, connection resets), max 2 with backoff. Missing API key, budget breach, and schema violations are not retried — the same money buys the same answer, and retrying a breach defeats the ceiling that raised it.

**Pre-charge ordering.** Completeness is always known before a report row exists: the scan fails and is marked failed *before* `saveReport`. A future payment step can therefore charge on report creation and never needs to refund for incompleteness.

### Two things worth flagging about this split

**Technical Analysis depends on a third party.** It requires the Lighthouse agent's output, which comes from Google PageSpeed Insights — rate-limited, and the API key is optional. Making it mandatory means a PSI outage fails scans that have complete crawl data and four working categories. That is the right call for correctness (an overall score missing its only externally-anchored component is not the same product), and the pre-charge ordering means an outage costs the customer nothing. But it makes third-party availability a scan-killer and should be monitored as such.

**Copywriting being degradable conflicts with `docs/16` §3.7**, which requires every report to contain at least one before/after rewrite of real copy — and Copywriting is the only agent that produces one. So a report shipped without it is missing a section `docs/16` calls mandatory. Flagged rather than silently resolved; either §3.7 softens to "when available", or Copywriting moves to mandatory. Not decided here.

---

## 6. Benchmark data

`scan_benchmarks` is written in the **same transaction** as the report and its findings. The numbers are derivable from `reports` + `agent_runs` today — but only while those rows survive and only while the derivation rules stay unchanged. Recording the answer at write time means we can never be unable to backfill.

Per-category scores are individual columns rather than jsonb so percentile queries work directly:

```sql
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY seo_score)
FROM scan_benchmarks WHERE industry = 'plumbing' AND cms = 'wordpress';
```

Metadata: detected industry keyword, page count, CMS (`lib/parsing/detect-cms.ts` — generator meta tag, falling back to asset-host fingerprints, since most builders strip the tag but can't avoid their own CDN), plus real measured `total_cost_usd`. No UI consumes this yet, by design.

---

## What remains unverified until a real capture run

Stated plainly, because the milestone's whole point is measurement and these are the parts that aren't measured yet:

1. **No golden set exists.** `evals/golden-set.md` specifies the required composition and selection rules; the ten URLs are not chosen. This sandbox cannot reach arbitrary external hosts (`example.com`, `google.com`, and real trade sites all fail to connect), and inventing plausible-looking domains would be a fabricated golden set — worse than an empty one, because it looks finished.
2. **No baseline score, and no post-iteration score.** Both require the judge, which requires a real `ANTHROPIC_API_KEY`. None exists here. No numbers have been invented in their place.
3. **The hallucination gate has never fired.** Its logic is unit-tested; it has never run against real model output.
4. **Judge calibration is unverified** (§3). Until the degradation check runs against real output, the judge's discrimination is an assumption.
5. **The $0.15 ceiling is unmeasured** (§1) and must be reset from the first real run's cost distribution.
6. **Live-API behaviour generally.** Every AI path is exercised by unit tests over contrived inputs and by integration tests gated on `ANTHROPIC_API_KEY`, which skip cleanly here.

Everything in §1, §2, §5, and §6 is fully implemented and tested against real HTTP servers and real fixtures — those do not depend on a key or on external network access.
