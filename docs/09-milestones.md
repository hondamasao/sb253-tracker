# Development Milestones

> **⚠️ Superseded for now by `15-mvp-scope-and-m0-plan.md`.** We reduced scope to the smallest version that can accept payment and deliver a report (no accounts, no dashboard, no monitoring — see that doc for what changed and why). This file describes the full long-term product and becomes active again once the MVP has a paying customer, picking up around where M4/M5 below start (accounts, dashboard). Until then, follow the M0→M4 sequence in `15-mvp-scope-and-m0-plan.md`.

This is the actual build order we will execute against, one at a time. **We do not start a milestone until the previous one's "Definition of Done" is fully checked off.** Each milestone produces something real you can look at or click, never just invisible internal plumbing on its own.

Status legend: ⬜ not started · 🟨 in progress · ✅ done. (Update this file as we go — it's our shared source of truth for progress.)

## M0 — Project foundation ⬜
**Goal:** An empty-but-real, deployable Next.js app with all core infrastructure wired up, before any product features.
- Initialize Next.js (App Router) + TypeScript + Tailwind + shadcn/ui
- Set up Supabase project (dev + prod), connect Drizzle ORM, run first migration (just `profiles`/`organizations` tables)
- Set up Vercel project, connect to GitHub, confirm auto-deploy on push works
- Set up Sentry, basic CI (lint + typecheck + build on every PR)
- `.env.example` documented; secrets in Vercel env vars
**Definition of done:** Visiting the deployed Vercel URL shows a working "Hello GrowthOS" page. CI passes on a PR. No product features yet — this milestone is purely about a trustworthy foundation.

## M1 — Core scan engine (no AI polish, no accounts) ⬜
**Goal:** Prove the hardest technical risk first: can we reliably crawl a site and produce structured findings.
- Set up Inngest, wire the `/api/scans` → `run-scan` background job pipeline (per `05-api-architecture.md`)
- Build the site crawler (fetch + parse HTML for key pages)
- Build 3 deterministic agents end-to-end: Performance (PageSpeed API), Technical SEO, Accessibility
- Store results in `scans` / `agent_runs`
- Bare-bones scan status page (no design polish) showing raw JSON output
**Definition of done:** Submitting a real URL via a simple form produces real, accurate findings from 3 agents, visible on screen, within ~30 seconds, for at least 10 different real home service websites.

## M2 — All 16 agents + synthesis ⬜
**Goal:** The full analysis engine, since this is the product's core value.
- Build remaining 13 agents (per `06-ai-agent-architecture.md`)
- Build the Synthesis Agent (overall score, executive summary, prioritized checklist, monthly plan)
- Implement the deterministic overall-score weighting formula
- Cost logging on every AI/API call
**Definition of done:** A full scan of a real business site produces all 16 category scores + a coherent, accurate, non-generic executive summary and prioritized checklist that you personally judge as "genuinely useful," tested against 15-20 real sites across different trades.

## M3 — Report UI + PDF ⬜
**Goal:** Turn the raw JSON into the polished product experience.
- Build the full web report UI (per wireframe #4 in `08-wireframes.md`)
- Build the teaser (locked) report UI (wireframe #3)
- Build PDF generation with `@react-pdf/renderer`
- Build the landing page + scan-in-progress screen (wireframes #1, #2)
**Definition of done:** The entire Flow A from `07-user-flow.md`, steps 1-4, works for an anonymous visitor: land on homepage → enter URL → watch progress → see teaser report → download nothing yet (PDF gated), matching the visual quality bar (Linear/Stripe/Notion-level polish).

## M4 — Accounts & auth ⬜
**Goal:** Turn anonymous visitors into registered users.
- Supabase Auth: email/password + Google OAuth
- Auto-create `organizations` + `organization_members` on signup
- Attach anonymous scan's business to the new org on signup (per Flow A step 5)
- Route protection middleware for the `(app)` route group
- Full report unlock + PDF download for authenticated users
**Definition of done:** A brand-new visitor can complete the entire Flow A end-to-end, including signup, and land on a real (if minimal) dashboard with their unlocked report.

## M5 — Dashboard & business management ⬜
**Goal:** Give logged-in users a home base.
- Dashboard (business list, wireframe #5)
- Business detail page + report history (wireframe #6, minus the trend chart — no history exists yet)
- Add/remove businesses (respecting a temporary "unlimited" limit until billing exists)
**Definition of done:** Flow B steps 1-3 work fully for a logged-in user with multiple businesses and multiple past reports.

## M6 — Stripe billing ⬜
**Goal:** Start making money.
- Define plans in `lib/stripe/plans.ts` (Starter/Growth/Agency, limits per `13-pricing.md`)
- Stripe Checkout integration + webhook handler (keep `subscriptions` table in sync)
- Stripe Customer Portal integration
- Plan-limit enforcement (business count, scan frequency) at the API layer
- Pricing page (wireframe #7)
**Definition of done:** A real (test-mode) card can subscribe to a plan via Stripe Checkout, the org's plan updates automatically via webhook, limits are enforced, and canceling/downgrading via the Customer Portal correctly reflects in the app.

## M7 — Monitoring, history & alerts ⬜
**Goal:** Make the product worth paying for monthly, not just once.
- Scheduled scans via Inngest cron (`scheduled-scans.ts`) respecting `monitoring_schedules`
- Score history tracking + trend chart (completes wireframe #6)
- Email alerts (report ready, score drop, new critical issue) via Resend + React Email
**Definition of done:** A test business on a Growth-plan schedule automatically gets re-scanned on schedule with zero manual action, its trend chart updates, and an email alert fires on a simulated score drop.

## M8 — Team accounts ⬜
**Goal:** Support agencies/multi-person orgs.
- Invite teammate flow (email invite, accept flow — Flow C)
- Role-based permission checks (owner/admin/member) across all relevant routes
- Settings → Organization team management UI (wireframe #8)
**Definition of done:** An org owner can invite a teammate, the teammate can accept and log in, and role-based restrictions are verifiably enforced (a "member" cannot access billing, for example).

## M9 — Admin dashboard & public API ⬜
**Goal:** Support the business itself and top-tier customers.
- Internal admin dashboard (MRR, scan volume, AI cost per scan, failed scans, manual account actions) — staff-only
- API keys UI + public `/api/v1/` endpoints
- API rate limiting via Upstash
**Definition of done:** You personally can log into `/admin` and see real operating metrics; an Agency-plan test account can generate an API key and successfully trigger a scan via `curl`.

---

## Beyond M9

Everything past this point is Phase 5 material — see `14-future-expansion.md`. We do not plan those in milestone-level detail until M0–M9 are live with real paying users, because by then we'll have real usage data to prioritize with instead of guessing.
