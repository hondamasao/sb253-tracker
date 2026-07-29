# Product Roadmap

This is the high-level "phases" view. The detailed, buildable step-by-step version (what we actually execute against) is `09-milestones.md` — this document explains the *shape* of the journey; the milestones document is the *checklist*.

## Phase 1 — Prove the core idea (MVP)
**Goal:** A stranger can enter a URL and get a genuinely useful, good-looking report, with no login required. No billing, no accounts yet.
- Landing page with URL input
- Scan orchestrator + all 16 analysis agents (v1 quality)
- Teaser web report (public)
- Full web report (unlocked, still no auth wall yet — used to validate quality before we add friction)
- PDF export
- Manual QA on ~20 real home service business sites across trades

**Why start here:** Everything else (accounts, billing, monitoring) is worthless if the report itself isn't good. We deliberately delay auth/billing so we spend the first real effort proving the AI output is accurate and valuable, not building plumbing around a product that might not work yet.

## Phase 2 — Turn it into a product
**Goal:** Users can create accounts, save reports, and pay.
- Auth (Supabase Auth: email/password + Google)
- Organizations (1 org per new signup, auto-created)
- Teaser-report gate (must sign up to unlock full report/PDF)
- Dashboard (list of businesses + reports)
- Stripe subscriptions (Starter / Growth / Agency tiers)
- Plan-limit enforcement

## Phase 3 — Make it sticky
**Goal:** Give paying users a reason to stay subscribed month after month (not just buy one report and cancel).
- Scheduled/recurring scans (weekly or monthly per plan)
- Score history + trend charts
- Email alerts (score drops, scan complete, new critical issue)
- Competitor tracking over time

## Phase 4 — Scale the business
**Goal:** Support power users, agencies, and internal operations.
- Team accounts (invite teammates, roles)
- Public API + API keys (Agency tier)
- Admin dashboard (internal ops: MRR, churn, scan costs, support tools)
- Usage-based cost monitoring and alerting (so AI costs never silently eat margin)

## Phase 5 — Expand the moat
**Goal:** Features that are hard for competitors to copy and that increase price per customer.
- White-label reports for agencies (their logo/branding/domain)
- GBP OAuth connection (first-party data + auto-posting)
- Review-response AI drafting
- Industry benchmark database ("you're in the bottom 20% of plumbers in your state for mobile speed")
- Integrations (Zapier, GoHighLevel, HubSpot)

See `14-future-expansion.md` for the full brainstorm behind Phase 5+.

## Sequencing principle

Within every phase, and across the whole roadmap, we follow one rule: **ship the smallest slice that's actually usable, validate it, then extend.** We do not build the database schema for Phase 4 features in Phase 1 "just in case" — that's premature complexity that slows down the parts we need to get right first. The schema in `03-database-schema.md` does account for future phases structurally (e.g., organizations exist from day one even though team invites ship in Phase 4), but no unused UI or business logic is built ahead of need.
