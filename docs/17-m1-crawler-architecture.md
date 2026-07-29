# M1 — Crawler & Deterministic Data Pipeline Architecture

**Scope of this document:** M1, as scoped in this milestone's instructions, is narrower than the "M1" described in `docs/15-mvp-scope-and-m0-plan.md` §2 — that doc bundled all 5 analysis agents plus AI synthesis into one milestone. This pass builds **only the deterministic half**: crawl a site, collect facts, store them. No AI calls, no scores requiring judgment, no recommendations. The AI-driven agents (Content Quality, AI Visibility) and the Synthesis Agent that were also labeled "M1" in that doc move to the next milestone. This document supersedes that doc's M1 section for what's actually being built right now.

## 1. Why the pipeline is split into layers

Four concerns are kept in separate, independently-testable layers:

```
lib/crawler/     "How do I safely fetch a URL and discover which pages to visit?"
lib/parsing/      "Given raw HTML, what facts can I extract?"
agents/           "Given the crawled+parsed data, what does this specific analysis category conclude?"
inngest/functions  "How do these steps run reliably, in what order, with what retry/failure behavior?"
```

The reason for this split — and the answer to requirement #5 ("design the crawler so additional analyzers can be added later without changing its architecture") — is that **the crawler has no idea analyzers exist.** It produces one plain-data object, `CrawlResult`, containing everything any analyzer could plausibly need (parsed pages, robots.txt rules, sitemap URLs, SSL status). Every analyzer is a pure function `(crawlResult) => AgentResult` that reads whatever subset of that object it cares about. Adding a 3rd, 4th, 10th analyzer later (Content Quality, Trust Signals, whatever comes next) means writing one new file in `agents/` — zero changes to `lib/crawler/`, ever. This is the same "orchestrator + specialist agents" pattern already committed to in `docs/06-ai-agent-architecture.md`; M1 is where the crawler side of that contract actually gets built and proven.

## 2. Crawl scope — how we avoid crawling too much

Two different "too much" problems exist, and each has its own guard:

**Too much of the target site** (bad for them, slow for us):
- Hard cap of **5 total pages per scan** (homepage + up to 4 discovered), per `docs/15-mvp-scope-and-m0-plan.md` §1.2.
- Discovered pages are chosen by keyword-matching a small fixed list (`contact`, `about`, `service`/`services`, `pricing`, `location`) against sitemap URLs and homepage nav links — never a breadth-first crawl of the whole site.
- `sitemap.xml` (and any sitemap index it references) is capped at reading the first ~200 `<loc>` entries and following at most 2 child sitemaps from an index — never fully ingesting a site with tens of thousands of URLs.
- `robots.txt` `Disallow` rules are respected for our user-agent — a discovered page under a disallowed path is skipped, not crawled. This is both correctness (ethical/standard crawling practice) and directly serves requirement #3 (robots.txt is data we're asked to collect anyway).
- Fetch concurrency is capped at 2 simultaneous page requests with the crawler otherwise running sequentially — we are a guest on someone else's server, not a load test.
- Every fetched response has a byte-size ceiling (3 MB) — a response over that is truncated/rejected rather than fully buffered, so a pathological huge page can't blow up memory.

**Too much of our own resources** (abuse of the free-scan hook):
- The `POST /api/scans` endpoint checks `scans` for how many rows share the requester's IP address in the last hour and rejects with `429` past 3 — the simple Postgres-based limiter `docs/15-mvp-scope-and-m0-plan.md` §1.1 already committed to instead of standing up Upstash Redis this early.

## 3. Fetching a single page: timeouts, redirects, SSRF

This is the part of a "just fetch some HTML" feature that's easy to get subtly wrong, so it's worth being explicit about each piece:

- **Timeouts.** Every fetch uses an `AbortController` with a per-call limit: 10s for a normal page fetch, 45s for the PageSpeed Insights call specifically (Google's own Lighthouse run against the target routinely takes longer, and prematurely aborting a legitimately-slow-but-working analysis would be worse than waiting). A timeout is treated as a normal, expected failure mode — not a crash — and recorded as such.
- **Redirects — handled manually, not via `fetch`'s automatic follow.** This matters for a reason beyond correctness: if we let `fetch` auto-follow redirects, a malicious site could return `Location: http://169.254.169.254/` (a cloud metadata endpoint) or `http://localhost:5432` and our server would happily fetch it — bypassing any SSRF check we only ran on the *original* user-submitted URL. Instead, every hop is fetched with `redirect: "manual"`, the `Location` header is read, **the new hostname is validated by the same SSRF guard as the original URL**, and only then do we follow it — capped at 5 hops total, after which we stop and record what we had.
- **SSRF guard.** Since this feature's entire job is "take a URL a stranger typed in and have our server fetch it," it is a textbook SSRF surface. Before fetching any hostname (original URL or a redirect target), we: reject non-`http(s)` schemes outright; resolve the hostname via DNS (`node:dns`); reject the request if the resolved address is a loopback, link-local, or private-range IP (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, and their IPv6 equivalents). This is a correctness/security requirement inherent to the feature, not an addition to scope — a URL-fetching product without it is unsafe to deploy.
- **SSL status.** Kept deliberately shallow for M1: we record whether the final URL (after redirect-following) is `https:`, and whether the TLS handshake itself succeeded (a failed handshake — expired/invalid cert — surfaces as a specific fetch error we catch and record as `certificateValid: false` rather than a generic failure). We do not parse the certificate chain, issuer, or expiry date — that's a deeper check than "basic SSL status" calls for.

## 4. Failure handling — what happens when something goes wrong

Failure is handled differently depending on *where* it happens, matching the "graceful degradation" principle from `docs/01-srd.md`'s reliability requirements:

| What fails | What happens |
|---|---|
| The **homepage** can't be fetched at all (DNS failure, connection refused, timeout after retries) | The whole scan fails — there's nothing to analyze without it. The scan is marked `failed` with a clear `error_message`. |
| A **secondary discovered page** (e.g. the contact page) fails to fetch | That one page is skipped and recorded in `crawlResult.failedPages`; the crawl continues with whatever pages did succeed. A scan never fails just because one of 4 extra pages timed out. |
| The **PageSpeed Insights (Lighthouse) agent** fails (Google's API down, rate-limited, timeout) | That agent's `agent_runs` row is stored with `status: "failed"` and the error message. The scan itself still completes if other agents succeeded — a report can ship with one category marked "temporarily unavailable" rather than the whole thing failing, per `docs/06-ai-agent-architecture.md`'s explicit reliability requirement. |
| The **Site Signals agent** fails | Same treatment — isolated to its own `agent_runs` row, doesn't block the other agent or the scan. |
| A **transient network blip** during any step | Inngest retries the failed step automatically (2 retries, configured on the function) before it's treated as a real failure — already-completed steps aren't redone, since Inngest checkpoints each `step.run()`. |

The mechanism that makes per-agent isolation actually work: each agent runs inside its own Inngest step, wrapped in a helper that **catches internally and returns a `{status:"failed", error}` value instead of throwing.** Because it never throws, one agent's failure can never cascade into retrying (or failing) the other agent's already-successful step. This is a small implementation detail with an outsized effect on reliability, so it's worth naming explicitly.

## 5. What gets stored, and why

Two `agent_runs` rows are written per scan in M1 (per `docs/03-database-schema.md` / `docs/15-mvp-scope-and-m0-plan.md`'s schema — no schema changes needed, this was designed for exactly this):

**`agent_type: "lighthouse"`** — `raw_output` holds the categories PageSpeed Insights returns in one call (performance, accessibility, best-practices, SEO scores; Core Web Vitals — LCP, CLS, TBT/INP; the top Lighthouse "opportunities"/"diagnostics" audit list). `score` is populated now (not left null) because these are Google's own deterministic 0-100 numbers, not a judgment call we or an LLM are making.

**`agent_type: "site_signals"`** — `raw_output` holds everything derived from the crawl+parse: per-page data (title, meta description, headings with level+text, internal links, images with alt text, canonical tag, JSON-LD structured data types found) for every page crawled, plus site-level facts (robots.txt rules + discovered sitemap URL, parsed sitemap entries, SSL status, and a `technicalIssues` array of deterministically-detected facts like "missing meta description on /contact" or "2 H1 tags found on homepage"). `score` is left `null` — no weighting formula has been decided yet (that's `docs/06-ai-agent-architecture.md`'s job in a later milestone), and inventing one now would be exactly the kind of premature, undocumented decision this project avoids.

**What is deliberately *not* stored:** the raw HTML of each page. Storing full page markup in a `jsonb` column is pure bloat — expensive to store, slow to query, and useless once we've already extracted the structured facts (title, headings, links, etc.) that are the actual signal. We keep a byte-length and a fetch timestamp per page for diagnostics, not the markup itself. If a future milestone genuinely needs to re-inspect raw HTML (e.g. for a new analyzer that wasn't anticipated), re-crawling is cheap and always gets current data anyway — caching stale HTML would be the wrong tradeoff.

**A `technicalIssues` array, not prose.** Per `docs/16-report-quality-standard.md`, recommendations must eventually be specific and evidence-based — but this milestone is explicitly forbidden from writing any of that prose. So `technicalIssues` entries are machine-readable facts (`{ type: "missing_meta_description", page: "/contact" }`), never a written sentence. Turning a fact into a customer-facing "Problem / Why it matters / Evidence / Recommended action / Expected impact" write-up is the Synthesis Agent's job, next milestone, using exactly this stored data as its input.

## 6. Entry point in M1 (no UI yet)

`POST /api/scans` accepts `{ websiteUrl }`, runs basic validation + the per-IP rate limit, creates a `scans` row, and sends an `scan/requested` event to Inngest — this is "the user enters a URL" from a backend-contract perspective; the actual form UI is M2's job per the milestone sequence. `inngest/functions/run-scan.ts` is the durable job that does the crawl, runs both agents, and persists everything. There is no `GET /api/scans/[id]` yet — polling for status is only needed once M2's UI exists to poll it, and adding it now would be building ahead of the milestone that needs it.
