# M1b — AI Analysis Layer Architecture

**Scope of this document:** M1a built the crawler and two deterministic agents (Lighthouse, Site Signals) that collect facts and store them — no AI, no prose. M1b builds the layer that turns those facts into the actual product a customer pays for: a written, evidence-grounded report. This document explains that layer before any code exists, per the milestone's instructions.

**A note on the agent set.** `docs/06-ai-agent-architecture.md` and `docs/15-mvp-scope-and-m0-plan.md` originally planned a different 5th/6th agent (Content Quality, AI Visibility, Site Completeness). This milestone's instructions specify a different, final set instead: **Technical Analysis, SEO Analysis, Conversion Optimization, Trust & Credibility, Copywriting, and Report Synthesis.** This document and the code that follows build exactly that set. AI Search Optimization (testing against multiple AI models) and Site Completeness (missing pages/lead-gen/social) are not part of M1b — they remain candidates for a later milestone, not cut permanently.

**A note on the model provider.** The original architecture planned mixed OpenAI + Anthropic usage (partly because AI Search Optimization inherently needs to test multiple real AI models — that agent still isn't built). For M1b specifically, this session confirmed `api.openai.com` is unreachable under this sandbox's network policy, and the user has directed **Anthropic only** for this milestone, with real API calls (no mocked AI output) gated behind an actual `ANTHROPIC_API_KEY`. Cost-tiering is preserved within the Anthropic model family instead of across vendors (see §4).

## 1. Architecture for the AI analysis layer

Six agents, two tiers:

```
Tier 1 — Category agents (parallel, independent)         Tier 2 — Synthesis
┌────────────────────┐
│ Technical Analysis  │──┐
├────────────────────┤  │
│ SEO Analysis        │──┤
├────────────────────┤  │        ┌─────────────────────┐      ┌──────────────────┐
│ Conversion           │──┼───────▶ validated findings   │──────▶ Report Synthesis  │
│ Optimization         │  │        │ (post-validation)   │      │ Agent (executive  │
├────────────────────┤  │        └─────────────────────┘      │ summary only)    │
│ Trust & Credibility  │──┤                                     └──────────────────┘
├────────────────────┤  │                                                │
│ Copywriting          │──┘                                                ▼
└────────────────────┘                                        deterministic assembly
                                                                (score, grade, ranking,
                                                                 monthly plan — CODE,
                                                                 never the LLM)
```

Every category agent shares one calling convention, implemented once in `agents/shared/` and reused by all five — not duplicated per agent:

1. **Build an evidence list.** A short, numbered list of plain-fact strings (`EV1: "Homepage title: ..."`, `EV2: "PageSpeed mobile performance score: 41/100"`) assembled from M1a's stored data (see §2). This is the *only* factual material the model is allowed to reference.
2. **Call Claude with a forced output schema** (Anthropic tool-use, not free-form JSON-in-prose) — the model can't return anything except the fields we define: a category summary and 0-5 findings, each with the five required fields plus `evidenceIds`.
3. **Validate the response deterministically** — code, not another model call — against `docs/16-report-quality-standard.md`'s rules (see §5). Findings that fail are dropped, not shipped and not silently "fixed."
4. **Compute a category score in code**, never by asking the model for a number (see §4/§5 for the exact formula) — matching the principle already established in `docs/06-ai-agent-architecture.md`.

The Report Synthesis Agent is architecturally different and deliberately narrower: it receives only the *validated* findings' short problem statements, categories, and severities (not the full evidence lists — those already did their job producing the findings) and writes exactly one thing: the executive summary. Overall score, letter grade, the prioritized checklist, and the monthly action plan are **deterministic code**, not an LLM decision — this is the same "the model writes prose, code does arithmetic" separation from M1a, extended into M1b.

Each of the six agents still runs inside its own Inngest step via the same `runAgentSafely` wrapper from M1a — one agent's failure (bad API response, rate limit, missing key) can't take down the others or the scan, exactly as designed in `docs/17-m1-crawler-architecture.md` §4. If the Synthesis Agent itself fails, a plain non-AI fallback summary ships instead of failing the whole report — a paying customer gets a still-useful report rather than nothing (see §implementation notes in the code).

## 2. How M1a's data flows into each agent

Nothing here re-crawls or re-parses HTML. Every category agent consumes the **already-computed output** of M1a's `lighthouse` and `site_signals` agents — the same objects that would be persisted to `agent_runs.raw_output` — passed through in-memory within the same scan run. This is the exact division of labor M1a's own docs promised: M1a produces facts, M1b writes prose from those facts.

| Agent | Reads from `lighthouse` output | Reads from `site_signals` output |
|---|---|---|
| **Technical Analysis** | `categoryScores` (performance/accessibility/bestPractices), `coreWebVitals`, `topOpportunities` | `ssl`, `robots` (fetched/homepageAllowed), `sitemap` (fetched/count) — i.e. "can this site technically be reached, rendered, and crawled" |
| **SEO Analysis** | *(not used)* | Per-page `title`, `metaDescription`, `headings`, `canonicalUrl`, `structuredData`; the `technicalIssues` entries about titles/meta/headings/canonical/duplicate-titles — i.e. "is each page structured to be found" |
| **Conversion Optimization** | *(not used)* | Per-page `phoneNumbers`, `hasContactForm`, `ctaPhrases` *(new fields, see below)* |
| **Trust & Credibility** | *(not used)* | Per-page `trustSignalMentions` *(new field)*, `structuredData` (LocalBusiness / AggregateRating types) |
| **Copywriting** | *(not used)* | Per-page `visibleText` excerpt *(new field)*, `title`, `metaDescription`, homepage `headings` |
| **Report Synthesis** | *(not used directly)* | Reads the five category agents' validated findings + summaries + scores — nothing from the crawl directly |

**Three new fields on `ParsedPage`, extracted in `lib/parsing/parse-page.ts`.** M1a's parser didn't need visible text, phone numbers, form presence, CTA language, or trust-keyword mentions — nothing in M1a used them. M1b's Conversion/Trust/Copywriting agents do, so the parsing layer (not the crawler — the crawler's contract is unchanged) gains:
- `visibleText`: cleaned, whitespace-normalized body text, capped (~4,000 chars/page) — for Copywriting to quote *real* sentences, never invent example copy.
- `phoneNumbers`: regex-extracted, deduplicated phone-number-shaped strings.
- `hasContactForm`: boolean, `<form>` presence.
- `ctaPhrases`: matches against a small fixed phrase list (`"call now"`, `"book online"`, `"free estimate"`, `"24/7"`, etc.) found in link/button text.
- `trustSignalMentions`: matches against a small fixed keyword list (`"licensed"`, `"insured"`, `"bonded"`, `"guarantee"`, `"family owned"`, `"BBB"`, etc.) found in visible text.

All five are **deterministic extraction** (regex/keyword/DOM-query), computed *before* any model call — this is the load-bearing decision behind §3 and §4 below.

## 3. Minimizing hallucination

Four independent layers, not one:

1. **Extract deterministically, ask the model to interpret — never to "find."** Every fact a finding could possibly need (phone numbers, CTA language, trust keywords, PageSpeed numbers, page titles) is extracted by code *before* the model is ever called (§2). The model is never handed raw HTML or an unstructured page dump and asked to "look for" something — it receives a closed, numbered list of facts. This removes the single biggest hallucination surface (a model inventing a fact that was never actually checked) by construction, not by instruction.
2. **A closed evidence world, stated explicitly in the prompt.** The shared system prompt (verbatim, not paraphrased per-agent) instructs: *"You may only reference facts from the EVIDENCE list below. Do not invent, assume, or infer any fact, number, or detail not explicitly listed. If there isn't enough evidence to support a finding in some area, do not produce one."* Every finding must cite which evidence IDs it's based on.
3. **Forced structured output (tool-use), not free-form JSON-in-prose.** Anthropic's tool-use forces the response into our exact schema — the model cannot "helpfully" add extra unstructured commentary, and a malformed response is a parse failure we catch, not silently-accepted noise.
4. **Deterministic post-validation, not another model call.** After the response comes back, code — not a second LLM pass — checks: does every cited `evidenceId` actually exist in the list we gave this agent (§5's hard technical gate), does the finding avoid the banned-phrase list (`docs/16` Rule 5.3), does it avoid dollar/lost-lead language (this milestone's explicit constraint), does it show a concrete number or quoted detail (a proxy for the "any business" test). A finding that fails is dropped — never "fixed up," since editing a possibly-hallucinated finding to sound better would hide the problem, not solve it.

The prompt also embeds, verbatim, `docs/16-report-quality-standard.md`'s weak-vs-strong examples (§4 of that doc) and the relevant trade-specific reference set (§8 of that doc) for the detected industry — calibration examples measurably reduce generic output, and this is the exact mechanism `docs/16` was written to seed.

## 4. Keeping token usage and cost low

- **Two-tier model selection, within one vendor.** The five category agents use **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) — fast, cheap, and the task (bounded evidence in, bounded structured findings out) doesn't need a frontier model. The Report Synthesis Agent — the one call that reads across all categories and writes the customer's first impression — uses **Claude Sonnet 5** (`claude-sonnet-5`), and only runs *once* per scan, so the higher per-token cost has a small absolute impact. This mirrors the split already committed to in `docs/06-ai-agent-architecture.md`, just entirely within Anthropic instead of across vendors.
- **Small, curated inputs, never raw HTML.** Each agent receives only its own evidence list (a few hundred tokens, not whole pages) — this is the same design decision that minimizes hallucination (§3) also being the one that minimizes cost. Full page HTML is never sent to a model at any point in this pipeline.
- **Bounded output.** Each category agent is instructed (and schema-limited) to return at most 5 findings — enough to be genuinely useful without an unbounded, runaway response. `max_tokens` is capped per call (≈1,500 for category agents, ≈700 for Synthesis, which only writes a few sentences).
- **Deterministic work stays deterministic.** Scoring, ranking, and monthly-plan bucketing are plain code (§1) — not run through the model at all. Every token spent on arithmetic a computer can already do reliably is a wasted token.
- **Cost is logged per call, not estimated.** Anthropic's response includes `usage.input_tokens`/`usage.output_tokens`; real per-model published pricing converts that into a `costUsd` figure stored on the agent's `agent_runs` row — exactly the same "always know the real number, never guess" discipline from M1a's Lighthouse agent.

## 5. Guaranteeing every recommendation is traceable to real evidence

This is the mechanism, not just the intention — a technical gate, not a promise:

1. **Every evidence item has a stable ID** (`EV1`, `EV2`, …), built from M1a's data before the model is called.
2. **Every finding the model returns must include `evidenceIds: string[]`** — which specific evidence items it's grounded in. This is part of the forced tool-use schema, not an optional field the model might skip.
3. **Validation checks existence, not plausibility.** After the call, code checks that every ID in every finding's `evidenceIds` actually exists in the list *given to that specific agent for that specific scan*. An ID that doesn't exist (fabricated, or copied from a different scan) fails the finding outright — dropped before it ever reaches a customer. This is a hard, deterministic check, not a fuzzy-matching heuristic.
4. **The evidence IDs are stored, not discarded.** The `findings` table gains an `evidence_refs` column (jsonb array of the cited IDs) — so months from now, anyone (a support engineer investigating a refund request, a future automated eval) can look at any finding and see exactly which raw fact from that scan it was based on, without re-deriving anything.
5. **The `evidence` free-text field is still required and still checked for specificity** (contains a number or a quoted detail — §3, point 4) — the ID mechanism guarantees *traceability*; this heuristic is a second, independent check that the evidence text itself reads as concrete rather than generic.

Together, (1)-(3) mean a hallucinated fact cannot survive into a finding without also fabricating a matching evidence ID *and* that ID happening to already exist in the list — which, since the list is built entirely from real M1a data, is not something a model can do by accident.

## Schema changes needed for M1b

`findings` (currently `title`/`description`/`recommendation` — three slots for a five-part structure) gains explicit columns matching `docs/16-report-quality-standard.md` §6 one-to-one: `title` (kept, = Problem, one sentence), `why_it_matters`, `evidence`, `recommendation` (kept, = Recommended action), `expected_impact`, and `evidence_refs` (jsonb, the cited evidence IDs from point 4 above). No other tables change. Since no real database has been provisioned yet (still an open M0 item), this is a clean schema redesign, not an incremental migration on top of live data.

## Explicit deviation from `docs/16-report-quality-standard.md`

Per this milestone's explicit instruction, **no lost-lead or revenue estimate is produced.** `docs/16` §3.4 ("Estimated lost leads") required this; it is intentionally omitted from M1b's report, the same way that document already treats "Competitor snapshot" — omitted entirely, not shown as a stub, because a number without real industry-benchmark research behind it would itself violate Rule 5.3/5.4's spirit (no unearned, ungrounded claims). `reports.estimated_lost_leads_min/max` stay `NULL`. A short amendment note is added to `docs/16` itself so the two documents don't silently disagree.

## A note on trade-specific context (docs/16 §5.7)

The MVP's scan input is a bare URL (see `docs/15-mvp-scope-and-m0-plan.md` §1.1/§1.4) — there is no account or intake form, so no `industry` field exists to read. Rather than adding a required input the MVP deliberately cut, `agents/shared/detect-industry.ts` makes a lightweight, deterministic, keyword-count guess from the crawled page text (plumbing/HVAC/roofing/electrical). It's passed to agents as a labeled best-effort hint, never as asserted fact and never itself citable as evidence — when no keyword clears the bar, agents fall back to trade-neutral framing. Real per-business industry input remains a candidate for a later milestone.

## Implementation status

As of this milestone's implementation: `agents/shared/` (evidence builder, lazy Anthropic client, Zod schemas, shared prompts, the 5-stage validation pipeline, deterministic scoring), all five category agents, the Report Synthesis agent, deterministic report assembly (`lib/report/assemble-report.ts`), persistence (`lib/reports.ts`), and the full `inngest/functions/run-scan.ts` orchestration are all built and wired together exactly as described above — the same application code that will run against a real `ANTHROPIC_API_KEY` with zero changes. Unit tests cover every deterministic piece (evidence building, validation rules, scoring, report assembly, industry detection) without calling the real API. Real-API integration tests exist at `tests/integration/agents-real-api.test.ts`, gated by `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`.

**What remains blocked on a real API key:** this sandbox has no usable `ANTHROPIC_API_KEY` (confirmed reachable at the network level, unlike `api.openai.com`, but no key was available to place in `.env.local`). Per the explicit instruction that produced this milestone's approach, no AI output has been fabricated or simulated anywhere in this codebase. Running the pipeline end-to-end against real websites, reading the actual generated report, and critiquing/iterating on prompt quality all require a real key and are deferred until one is supplied — at which point `tests/integration/agents-real-api.test.ts` runs for real with no code changes.
