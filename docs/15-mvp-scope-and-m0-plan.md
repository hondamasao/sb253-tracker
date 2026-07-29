# MVP Scope & M0 Implementation Plan

**Status: this document supersedes `01-srd.md`, `03-database-schema.md`, `06-ai-agent-architecture.md`, and `09-milestones.md` for the MVP build only.** Those documents describe the full, eventual product (accounts, teams, monitoring, admin, API) — they are not wrong, they're just not what we build first. This doc defines the smallest real thing that can take a customer's money and give them something worth paying for. Once we have a paying customer, we come back to the original roadmap starting at what was M4/M5.

**MVP goal, stated precisely:** A stranger enters a website URL, sees a free teaser score, pays $29 once, and receives a full AI-generated growth audit as a web report + downloadable PDF. No login. No dashboard. No monitoring.

## 1. Revised MVP architecture

### 1.1 What we cut, and why

| Cut from full architecture | Why it's safe to cut for MVP |
|---|---|
| Supabase Auth, `organizations`, `organization_members`, RLS-by-tenant | There's nothing to log into yet — one purchase = one report. A paid, unguessable link (a UUID in the URL, emailed to the buyer) does the job "accounts" would do, at a fraction of the build cost. We add real accounts in the milestone right after MVP proves the core loop works. |
| Dashboard, saved report history, business list | Direct consequence of no accounts — nothing to list. |
| Stripe *subscriptions*, Customer Portal | MVP sells one report for one one-time payment. Subscriptions require recurring billing logic, dunning, and a portal — real work with zero payoff until we know the report itself converts. |
| Scheduled/recurring scans, score history, email alerts | These are the *retention* engine for a subscription product. We don't have subscribers yet. |
| Team accounts, admin dashboard, public API | All depend on accounts existing first. |
| Google Business Profile category, Reviews category, Competitor comparison category | Each of these needs a **paid third-party data provider** (a SERP/local-data API) — a new vendor to research, sign up for, and integrate, purely to add 3 of 16 categories. Cutting them removes the slowest, least-certain part of the build without removing what makes the report valuable (the other 13 categories are all derivable directly from the website itself). |
| A dedicated Accessibility agent built on a headless browser (Puppeteer/axe-core) | See 1.2 below — we get an accessibility score for free from an API call we're already making, no headless browser needed. |
| Gemini API integration | AI Search visibility still gets tested (see 1.2), just against the two models we're already integrating (OpenAI, Anthropic) instead of adding a third vendor for MVP. |
| Upstash Redis (rate limiting/caching) | A simple "max N scans per IP per hour" check against our own Postgres database is enough to stop abuse at MVP traffic levels. Real caching/rate-limiting infra gets added when volume actually demands it. |
| PostHog analytics | Vercel Analytics (already free, zero setup) is enough to see whether anyone's visiting. Funnel analytics matter once there's a funnel worth optimizing. |

**What we deliberately keep, even though it "future-proofs" rather than minimizes:**

| Kept | Why it's not actually optional |
|---|---|
| **Inngest** (background jobs) | A scan still takes ~30–60 seconds across several data sources. A plain API route will either time out or force an ugly hack. Inngest is a 30-minute setup, not a "feature" — removing it trades a small time save today for a real risk of scans silently failing on launch day. |
| **Sentry** | A 5-minute setup (via their wizard). Losing your first paying customer to a silent, unreported bug is a worse outcome than the 5 minutes this costs. |
| **Stripe (real account, real verification)** | Included in M0 specifically because Stripe's business/bank verification can take days and is entirely outside our control — it's the one dependency that can bottleneck "accept payment" if we don't start it immediately. |

### 1.2 The report: 5 category-producing agents instead of 16

Key insight that drives this simplification: **Google's PageSpeed Insights API is free and, in one call, already returns Lighthouse's Performance, Accessibility, Best Practices, and SEO category scores.** We don't need to build or run our own accessibility checker — we get a real, industry-standard accessibility score for free as a side effect of the performance check we were already going to do.

| # | Agent | Type | Categories it produces | Data source |
|---|---|---|---|---|
| 1 | **Lighthouse Agent** | Deterministic | Performance, Mobile, Accessibility | One PageSpeed Insights API call (`strategy=mobile`) |
| 2 | **Site Signals Agent** | Deterministic | Technical & Local SEO | Parsed HTML/sitemap.xml/robots.txt via Cheerio: title/meta tags, heading structure, schema.org markup, NAP (name/address/phone) consistency, canonical tags |
| 3 | **Content Quality Agent** | AI (GPT-4o-mini) | Copywriting, CTAs, Trust Signals (combined into one "Content & Trust" category) | Extracted page text from the crawl |
| 4 | **AI Visibility Agent** | AI (GPT-4o + Claude Sonnet) | AI Search Optimization | Live prompts to both models asking real local-intent questions ("best plumber in [city]") — checks if/how the business is mentioned |
| 5 | **Site Completeness Agent** | Deterministic + light AI phrasing | Missing Pages, Lead Generation Opportunities, Social Presence (combined into "Site Completeness") | Sitemap/nav crawl vs. an expected-page checklist for the industry; presence of phone/booking/chat CTAs; presence of linked social profiles |
| — | **Synthesis Agent** | AI (Claude Sonnet) | Not a category — combines all 5 agents' output into: overall score, letter grade, executive summary, estimated lost leads, prioritized checklist, before/after example, monthly action plan | All agent outputs (small, structured JSON — not raw HTML) |

Result: **7 category scores** (Performance, Mobile, Accessibility, Technical & Local SEO, Content & Trust, AI Search Optimization, Site Completeness) rolled into one overall score/grade — down from 16, but every category is still genuinely computed from real data about the specific business, not generic filler. Nothing here is placeholder content.

Crawl scope for MVP: homepage + up to 4 additional pages discovered via `sitemap.xml` or main navigation (capped at 5 total pages) — enough to assess the categories above without the time/cost of a full-site crawl.

**Estimated cost & time per scan** (rough, for planning — track real numbers from day one in `agent_runs.cost_usd`):

| Step | Time | Cost |
|---|---|---|
| Crawl (5 pages) | ~5–10s | $0 |
| PageSpeed API call | ~10–15s | $0 (free API) |
| Content Quality (GPT-4o-mini) | ~3–8s | ~$0.01–0.03 |
| AI Visibility (GPT-4o + Claude) | ~5–10s | ~$0.02–0.05 |
| Site Completeness (light LLM call) | ~2–5s | ~$0.005 |
| Synthesis (Claude Sonnet) | ~5–10s | ~$0.03–0.08 |
| **Total (parallelized where possible)** | **~30–50s** | **~$0.07–0.20** |

Against a $29 price point, that's roughly 99%+ gross margin on AI/API cost alone — plenty of room even after Vercel/Supabase/Inngest platform costs, which stay near-zero at MVP volume on free/starter tiers.

### 1.3 Revised user flow

```
1. Landing page → enter website URL → "Get My Free Growth Score"
2. Scan runs immediately (Inngest job, no payment required yet — this is the free hook)
   → simple rate limit: max 3 scans per IP per hour, checked against our own `scans` table
3. Teaser report: overall score + letter grade + top 1-2 findings visible;
   rest blurred behind "Unlock full report + PDF — $29"
4. Click unlock → Stripe Checkout (one-time payment, Stripe collects email natively)
5. Stripe webhook (`checkout.session.completed`) → mark order paid →
   generate PDF → upload to Supabase Storage → mark report unlocked → email the report link (Resend)
6. Stripe redirects back to /report/[token] → full report now renders unlocked, PDF downloadable
```

No account is ever created. The `report_token` (a UUID, unguessable) *is* the access credential — the same pattern used by tools like Loom or shared Google Docs links. This is a legitimate, secure MVP pattern as long as tokens are long, random, and never logged anywhere client-visible.

### 1.4 Simplified database schema

5 tables instead of 15. All created via Drizzle migrations, RLS enabled with **zero policies** (default-deny) on every table as defense-in-depth — since there's no browser-side Supabase client at all in the MVP (every DB read/write happens in server code using the service-role key), this mainly protects against a future mistake, not a current gap.

```sql
create table scans (
  id uuid primary key default gen_random_uuid(),
  website_url text not null,
  report_token uuid not null unique default gen_random_uuid(),
  status text not null default 'queued', -- queued | running | completed | failed
  ip_address text,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans(id) on delete cascade,
  agent_type text not null, -- 'lighthouse' | 'site_signals' | 'content_quality' | 'ai_visibility' | 'site_completeness'
  status text not null default 'queued',
  score integer,
  raw_output jsonb,
  model_used text,
  cost_usd numeric(10,5),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null unique references scans(id) on delete cascade,
  overall_score integer not null,
  letter_grade text not null,
  executive_summary text not null,
  estimated_lost_leads_min integer,
  estimated_lost_leads_max integer,
  monthly_action_plan jsonb not null,
  is_unlocked boolean not null default false,
  pdf_url text,
  generated_at timestamptz not null default now()
);

create table findings (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  category text not null,
  severity text not null, -- critical | high | medium | low
  title text not null,
  description text not null,
  recommendation text not null,
  effort_level text not null, -- low | medium | high
  before_example text,
  after_example text,
  priority_rank integer not null,
  created_at timestamptz not null default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans(id),
  email text,
  stripe_checkout_session_id text not null unique,
  stripe_payment_intent_id text,
  amount_cents integer not null default 2900,
  status text not null default 'pending', -- pending | paid | refunded
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
```

**Forward-compatibility note:** when we build real accounts later (post-MVP), we add a nullable `organization_id` to `scans` and `orders` and backfill it — we do not redesign these tables. This is the same reasoning `03-database-schema.md` used to justify organizations from day one; here we're making the equivalent call in the other direction (defer, don't build speculatively) because accounts genuinely aren't needed to take a payment.

## 2. Development sequence (M0 → first paying customer)

| Milestone | Deliverable | Depends on |
|---|---|---|
| **M0 — Foundation** | Empty-but-real app deployed, connected to a real database, CI green, error tracking working | Nothing |
| **M1 — Core scan engine** | The 5 agents + synthesis, running end-to-end via Inngest, producing accurate raw JSON for real sites (no UI polish yet) | M0 |
| **M2 — Report UI + PDF** | Landing page, scan-progress screen, teaser report, full report, PDF generation | M1 |
| **M3 — Payment** | Stripe Checkout, webhook, unlock logic, email delivery, basic abuse rate-limiting | M2 |
| **M4 — Launch polish** | Error states, mobile pass, terms/privacy pages, real-domain deploy, QA against 15-20 real sites, first customer | M3 |

This document covers **M0 only** in task-list detail (below). We write M1's task list once M0 is actually done, per the "never move to the next milestone until the previous one is complete" rule — but the table above exists so you can see the whole path to revenue at a glance.

## 3. M0 — exact task list

### 3.1 External accounts (start these first — some have lead time you don't control)

- [ ] **Stripe**: create account, submit business verification **today** — this can take several business days and is the one thing on this list outside our control. Get test-mode API keys in the meantime.
- [ ] **Supabase**: create project, note the Postgres connection string, `anon` key, and `service_role` key.
- [ ] **Vercel**: create account/project, connect this GitHub repo.
- [ ] **Inngest**: create account, get event key + signing key.
- [ ] **Resend**: create account, get API key (domain verification for sending can wait until M4).
- [ ] **OpenAI**: get an API key.
- [ ] **Anthropic**: get an API key.
- [ ] **Google Cloud Console**: enable the PageSpeed Insights API, get an API key (free).
- [ ] **Sentry**: create account/project.

### 3.2 Project scaffolding

- [ ] `npx create-next-app@latest` — TypeScript, Tailwind, App Router, ESLint, `src/` off (matches `04-folder-structure.md`).
- [ ] `npx shadcn@latest init`, add base components: `button`, `input`, `card`.
- [ ] Install and configure Drizzle ORM; write `db/schema.ts` for the 5 MVP tables above.
- [ ] Generate and run the first migration against the real Supabase project (`drizzle-kit generate`, `drizzle-kit migrate`).
- [ ] Enable RLS with no policies on all 5 tables (default-deny).
- [ ] Write `lib/env.ts` — a Zod schema validating every required environment variable at startup, so a missing key fails loudly at boot instead of mysteriously at runtime.
- [ ] Write `.env.example` documenting every variable used.
- [ ] Write `lib/supabase/admin.ts` (service-role client) and `lib/supabase/storage.ts` (helper for uploading PDFs) — no browser-side Supabase client needed yet, since MVP has no client-side DB access.
- [ ] Install Inngest, write `inngest/client.ts`, add the `app/api/inngest/route.ts` serve handler, confirm `npx inngest-cli dev` connects locally.
- [ ] Run the Sentry setup wizard (`npx @sentry/wizard@latest -i nextjs`), trigger a test error, confirm it appears in the Sentry dashboard.
- [ ] Add `app/api/health/route.ts` — a trivial endpoint returning `{ ok: true }`, used to confirm deploys are actually live.
- [ ] Push to GitHub, confirm Vercel auto-deploys the branch.
- [ ] Add `.github/workflows/ci.yml`: install, typecheck, lint, build on every PR.
- [ ] Set every environment variable in Vercel (Production and Preview separately; Preview uses Stripe/Inngest *test* keys).
- [ ] Confirm the deployed `/api/health` endpoint responds on the real Vercel URL.

### 3.3 Definition of done for M0

A real, mostly-empty GrowthOS app is live on a public Vercel URL. It's connected to a real Supabase Postgres database with the 5 MVP tables created. `/api/health` returns 200 in production. A deliberately-thrown test error shows up in Sentry. The Inngest dev/cloud connection is verified. CI is green on a PR. **No scan logic, no report UI, and no payment code exists yet** — M0 is infrastructure only, so M1 can be built on a foundation that's already proven to deploy correctly.

## 4. Files to create in M0

```
growthos/
├─ app/
│  ├─ layout.tsx                    # root layout (fonts, Sentry provider if needed)
│  ├─ page.tsx                      # placeholder homepage ("GrowthOS — coming soon")
│  ├─ globals.css
│  └─ api/
│     ├─ health/route.ts            # GET → { ok: true }
│     └─ inngest/route.ts           # Inngest serve handler
├─ components/
│  └─ ui/                           # shadcn/ui output: button.tsx, input.tsx, card.tsx
├─ db/
│  ├─ schema.ts                     # Drizzle table definitions (5 MVP tables)
│  └─ index.ts                      # Drizzle client instance
├─ drizzle/                         # auto-generated migration SQL (do not hand-edit)
├─ lib/
│  ├─ env.ts                        # Zod-validated environment config
│  ├─ supabase/
│  │  ├─ admin.ts                   # service-role client
│  │  └─ storage.ts                 # PDF upload helper (used starting M2)
│  └─ utils.ts
├─ inngest/
│  └─ client.ts                     # Inngest client instance
├─ .env.example
├─ drizzle.config.ts
├─ next.config.ts
├─ tailwind.config.ts
├─ tsconfig.json
├─ package.json
├─ .github/workflows/ci.yml
└─ README.md                        # already updated; no change needed in M0
```

Not created yet (arrive in later milestones, listed here only so nothing looks "missing" — see `04-folder-structure.md` for the full long-term picture, trimmed for MVP): `agents/*` (M1), `app/(marketing)/report/[token]/page.tsx` and the scan-progress UI (M2), `lib/pdf/render-report-pdf.tsx` (M2), `app/api/scans/route.ts` and `inngest/functions/run-scan.ts` (M1), `app/api/webhooks/stripe/route.ts` and `lib/stripe/*` (M3), `emails/*` (M3). We are **not** creating `middleware.ts`, any `(app)`/`(auth)` route groups, `organizations`/`profiles` anything, or `app/admin` — those all depend on accounts, which the MVP doesn't have.

## 5. Dependencies to install in M0

```bash
# Framework (from create-next-app)
next react react-dom typescript @types/react @types/react-dom @types/node

# Styling / UI
tailwindcss postcss autoprefixer
# + whatever shadcn/ui's init pulls in automatically:
# class-variance-authority clsx tailwind-merge lucide-react @radix-ui/react-slot (etc., per component added)

# Database
drizzle-orm drizzle-kit postgres          # postgres.js driver, works well with Supabase's pooler
@supabase/supabase-js                      # used for Storage (PDF uploads), not for Auth in MVP

# Validation
zod

# Background jobs
inngest

# Error tracking
@sentry/nextjs

# Dev tooling
eslint eslint-config-next
```

Installed in later milestones, listed here for visibility only — **do not install these in M0**, they have nothing to do yet:

```bash
# M1 (scan engine)
cheerio openai @anthropic-ai/sdk

# M2 (report + PDF)
@react-pdf/renderer

# M3 (payment + email)
stripe resend @react-email/components
```

Keeping unused packages out of M0 is a small thing, but it keeps the dependency tree honest — every install should map to code that exists that same milestone.

## 6. What "done" looks like for the whole MVP (not just M0)

Worth stating plainly so M0's scope stays honest: M0 is complete when the *foundation* works, not when the product works. Don't be tempted to start building the crawler or the Stripe flow inside M0 "since you're already in the file" — M1 and M3 need M0's env validation, database, and job runner to already be solid, and mixing concerns across milestones is exactly the kind of half-finished-in-three-places state this staged approach is designed to avoid.
