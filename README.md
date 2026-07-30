# GrowthOS

AI-powered growth auditing platform for home service businesses (plumbers, HVAC, roofers, electricians, landscapers, pest control, etc.). Enter a website URL, get a professional executive report showing exactly how to get more customers.

## Planning documentation

Before any code is written, the full product/architecture plan lives in [`docs/`](./docs). Start at [`docs/00-overview.md`](./docs/00-overview.md).

Development proceeds one milestone at a time — see [`docs/15-mvp-scope-and-m0-plan.md`](./docs/15-mvp-scope-and-m0-plan.md) for the active build plan (the full long-term roadmap in [`docs/09-milestones.md`](./docs/09-milestones.md) resumes after the MVP has a paying customer).

## Local development

```bash
npm install
cp .env.example .env.local   # fill in real values as each milestone needs them
npm run dev
```

`next build`/`typecheck`/`lint` all succeed with no `.env.local` at all — see `lib/env.ts` for why. Running the app itself does need real values for whatever it's actually touching (e.g. `DATABASE_URL` once a route uses the database).

Background jobs run through [Inngest](https://www.inngest.com/). For local dev, set `INNGEST_DEV=1` (already in `.env.example`) so the app talks to the local Inngest Dev Server instead of assuming production/cloud mode:

```bash
npx inngest-cli dev   # in a separate terminal
```

Useful scripts: `npm run typecheck`, `npm run lint`, `npm run build`, `npm run db:generate` (Drizzle migrations), `npm run db:studio` (browse the database).

## Cost ceilings (read before changing them)

Three independent spend ceilings, all env-configurable without a redeploy —
see `docs/19-m1c-security-and-evaluation.md` §1 and `lib/budget.ts`:

| Ceiling | Env var | Default | Guards against |
|---|---|---|---|
| Per-scan | `SCAN_COST_CEILING_USD` | **$0.15 (provisional)** | One runaway scan |
| Global daily | `DAILY_SPEND_CAP_USD` | $25 | Many individually-compliant scans |
| Eval runs | `EVAL_SPEND_CAP_USD` | $10 | An unbounded prompt-tuning loop |

**The $0.15 per-scan ceiling is provisional and unverified.** Two estimates of
what a normal scan actually costs disagree by a factor of three to six
(~$0.01–0.03 from this codebase's own reasoning, $0.06–0.10 from the product
owner). That gap is deliberately *not* being resolved by estimating a third
time. Run the golden set — `npm run evals` prints the measured min / median /
p95 / max per-scan cost — and reset the default from that distribution. Until
then, treat $0.15 as a guardrail against runaway spend, not a forecast.

The per-IP rate limit (`SCANS_PER_IP_PER_HOUR`, default 3) is a conversion
question as much as a security one: the free scan is the top of the funnel and
shared NATs will trip it. It is env-configurable for exactly that reason.

## Evidence capture, replay, and evaluation

```bash
npm run capture -- <url> --out fixtures/golden/<slug>.json  # crawl once, freeze the evidence
npm run replay  -- fixtures/golden/<slug>.json              # re-run the AI layer, no crawling
npm run evals   -- --dir fixtures/golden --label baseline   # score the set (needs ANTHROPIC_API_KEY)
npm run evals:compare -- <before.json> <after.json>         # side-by-side delta
```

Live scans and replay run the **same** analysis code path
(`lib/pipeline/run-analysis.ts`); replay substitutes only the data source, and
`tests/unit/replay-isolation.test.ts` statically proves replay cannot reach the
crawler. Bundles carry a `provenance` field: any run containing an
`authored-fixture` bundle is structurally incapable of producing an aggregate
score or a scorecard, so numbers derived from sites we wrote ourselves can never
be presented as a quality measurement.
