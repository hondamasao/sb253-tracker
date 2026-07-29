# Testing Strategy

## Why testing looks different for this product

Most SaaS testing advice assumes deterministic code: given input X, output is always Y. GrowthOS has a large *non-deterministic* surface (AI-generated findings and summaries), so our testing strategy is split into two halves that need different techniques:

1. **Deterministic code** (auth, billing, database, scoring math, plan limits, API routes) → tested the traditional way: exact expected outputs.
2. **AI-generated content** (agent findings, executive summaries) → tested for *structure and safety*, not exact wording, plus ongoing human review — you can't unit-test "is this a good sentence," but you absolutely can test "did it return valid, complete JSON in under 20 seconds without hallucinating a nonexistent phone number."

## Test types & tools

| Type | Tool | What it covers |
|---|---|---|
| Unit tests | Vitest | Pure functions: scoring formula, plan-limit logic, Zod validation schemas, PDF data formatting |
| Integration tests | Vitest + a real test Supabase database | API routes end-to-end (request in → correct DB state + response out), RLS policies (a user from Org A truly cannot read Org B's data) |
| End-to-end (E2E) tests | Playwright | Full browser flows: Flow A (anonymous scan → signup → unlock report), Flow B (login → dashboard → billing), critical enough to run on every deploy |
| Agent output validation | Zod schema + custom "eval" script | Every agent's output is schema-validated at runtime (catches malformed AI JSON before it reaches a user) *and* we maintain a fixed set of ~15 real reference websites that get re-scanned whenever agent prompts change, with score deltas reviewed by a human before shipping the prompt change |
| Visual/manual QA | Human review checklist | Every milestone's UI is manually checked against the wireframes and against real usage on mobile + desktop before marking the milestone done |
| Load/cost testing | Manual, ahead of major launches | Simulate concurrent scans to confirm Inngest concurrency limits and AI provider rate limits are configured correctly *before* any marketing push, not discovered during one |

## What must always be tested (non-negotiable, before every milestone is marked done)

- **RLS / multi-tenancy isolation**: an automated integration test that proves a member of Org A gets a 403/empty-result, never another org's data, for every table. This is the single most damaging class of bug this product could ship (a data leak between paying customers), so it's tested explicitly, not just implied by "we wrote a policy."
- **Stripe webhook handling**: simulated webhook events (using Stripe's CLI/test fixtures) for subscription created/updated/canceled/payment_failed, confirming our `subscriptions` table and plan enforcement stay correct.
- **Idempotency of background jobs**: a test that runs a scan step twice and confirms no duplicate charges/rows are created (directly testing the guarantee described in `05-api-architecture.md`).
- **Agent failure isolation**: a test that force-fails one agent (mocked) and confirms the scan still completes with the other 15 categories intact, per the reliability requirement in the SRD.

## CI gates

Every pull request runs, and must pass, before merge (see `11-deployment-strategy.md` for exact pipeline):
1. `tsc --noEmit` (typecheck)
2. ESLint
3. Vitest (unit + integration)
4. Playwright E2E — smoke subset on every PR (fast), full suite nightly against staging
5. Build succeeds (`next build`)

## What we intentionally do NOT over-test

- We don't write exact-string assertions on AI-generated prose (brittle, breaks on every prompt tweak, and isn't actually testing quality). Instead we test *shape* (valid JSON, required fields present, score in range 0-100, no empty findings array) automatically, and *quality* via the human-reviewed reference-site eval set above.
- We don't aim for 100% code coverage as a metric — we aim for 100% coverage of the "non-negotiable" list above, plus good coverage of anything handling money or cross-tenant data, and lighter coverage of UI presentation code where a visual bug is low-stakes and easy to spot by eye.
