# Software Requirements Document (SRD) — GrowthOS

## 1. Purpose

GrowthOS is an AI-powered growth auditing platform for home service businesses (plumbers, HVAC, roofers, electricians, landscapers, pest control, etc.). A user submits a business website URL; a set of AI agents analyzes the business across performance, SEO, local SEO, mobile, accessibility, conversion, trust, reviews, competitors, AI-search visibility, and social presence; the system produces a professional PDF + web report that tells the business exactly what's costing them customers and what to fix first.

This document defines what the product must do (functional requirements), how well it must do it (non-functional requirements), and the boundaries of what's in and out of scope for the initial build.

## 2. Problem statement

Home service business owners are not marketers. They know they're "supposed to" have a good website and good SEO, but:
- They can't read a Lighthouse report or GSC data.
- Generic SEO tools (Ahrefs, SEMrush) are built for marketers, not plumbers — too much noise, no clear next action.
- Agencies pitch them vague retainers ("we'll do SEO for $1,500/mo") with no proof of what's actually wrong.
- AI search (ChatGPT, Gemini, AI Overviews) is a new, fast-growing discovery channel that almost no local business has ever been audited for.

GrowthOS turns a URL into a plain-English, prioritized, ROI-ranked action plan in minutes, with zero expertise required from the user.

## 3. Target users

- **Primary**: Owner/operator of a home service business (1–50 employees), not technical, price-sensitive, time-poor.
- **Secondary**: Marketing agencies / freelance consultants who serve home service clients and want a fast, white-label-able audit tool to open sales conversations or justify their retainer (this is the natural expansion path — see `14-future-expansion.md`).

## 4. Goals

1. Generate a credible, accurate, genuinely useful audit from just a URL, in under 3 minutes.
2. Make the output so clear and specific that a non-technical owner immediately understands what's wrong and what it's costing them.
3. Convert free/teaser reports into paying subscribers via a dashboard that keeps monitoring their site over time.
4. Be reliable and cheap enough per-scan that the unit economics work at thousands of users (AI + third-party API costs are the main cost driver — see cost notes in `06-ai-agent-architecture.md`).

## 5. Non-goals (out of scope for v1)

- We do not perform the fixes ourselves (no auto-editing the client's website, no managed SEO service) — v1 is diagnostic + advisory, not execution. (A "marketplace of vetted fixers" is a future expansion idea, not v1.)
- We do not support arbitrary industries in v1 — home services only, so agent prompts and scoring rubrics can be tuned and trustworthy, rather than generic and mediocre.
- No native mobile app in v1 (responsive web is sufficient).
- No multi-language support in v1 (English only).
- No white-labeling in v1 (flagged for Phase 5 in the roadmap).

## 6. Functional requirements

### 6.1 Core scanning engine
- FR-1: User can submit a website URL (with or without an account) to trigger a scan.
- FR-2: System validates the URL is reachable and is a real website before starting a scan (fail fast with a clear error).
- FR-3: System runs the following analysis categories, each producing a category score (0–100) and a list of findings:
  1. Website performance (Core Web Vitals, load time)
  2. Technical SEO (meta tags, headings, sitemap, robots.txt, canonical tags, indexability)
  3. Local SEO (NAP consistency, local schema markup, city/service-area pages)
  4. Mobile optimization (responsiveness, tap targets, viewport config)
  5. Google Business Profile recommendations (completeness, categories, photos, posts — based on publicly available profile data)
  6. Accessibility (WCAG-based automated checks)
  7. Conversion optimization (forms, phone number visibility, booking flow friction)
  8. Copywriting quality (AI-evaluated clarity, benefit-focused language, tone)
  9. Calls to action (presence, placement, clarity, urgency)
  10. Trust signals (licenses, insurance mentions, certifications, guarantees, years-in-business)
  11. Reviews (aggregate rating, review count, recency, presence of review widgets — from public sources)
  12. Competitor comparison (2–3 auto-identified local competitors, side-by-side scoring)
  13. AI Search optimization (does the business get mentioned when AI models are asked relevant local-intent questions)
  14. Social presence (linked profiles, activity signals)
  15. Missing pages (service pages, service-area pages, about, contact, reviews/testimonials page)
  16. Lead generation opportunities (missing lead magnets, no online booking, no live chat, weak contact options)
- FR-4: System computes an overall score (0–100) and letter grade (A–F) from weighted category scores.
- FR-5: System estimates "lost leads" — an approximate monthly lead-volume impact of the most severe issues, computed from category severity × industry benchmark conversion assumptions (clearly labeled as an estimate, not a guarantee).
- FR-6: System produces a prioritized checklist ranked by estimated ROI (impact vs. effort).
- FR-7: System generates before/after examples for at least copywriting and CTAs (AI rewrites a real snippet from the site).
- FR-8: System generates a monthly action plan (what to do in month 1, 2, 3).

### 6.2 Reporting
- FR-9: System renders a web report (interactive, scrollable) immediately after scan completion.
- FR-10: System generates a downloadable, professionally designed PDF version of the report.
- FR-11: Unauthenticated users see a teaser report (overall score + grade + top 2–3 issues, blurred/locked detail) and are prompted to create an account to unlock the full report — this is the primary signup conversion mechanism.
- FR-12: Authenticated users can view all their past reports and re-download PDFs at any time.

### 6.3 Accounts & organizations
- FR-13: Users can sign up / log in via email+password and Google OAuth.
- FR-14: Each user belongs to at least one "organization" (supports solo users and future team accounts).
- FR-15: Organization owners can invite teammates by email with a role (owner, admin, member).
- FR-16: Users can add multiple businesses to their account (each a separate website/entity being tracked).

### 6.4 Billing
- FR-17: Organizations subscribe to a paid plan via Stripe Checkout.
- FR-18: Plan limits (number of businesses, scan frequency, PDF branding, team seats) are enforced in the app.
- FR-19: Users can manage billing (upgrade/downgrade/cancel, update card, view invoices) via Stripe Customer Portal.
- FR-20: Failed payments trigger dunning emails and eventually downgrade the account (not silent data loss).

### 6.5 Monitoring & alerts
- FR-21: Paying users can enable scheduled scans (weekly or monthly, depending on plan) per business.
- FR-22: System tracks score history over time per business and displays a trend chart.
- FR-23: System sends email alerts when: a scheduled scan completes, the overall score drops significantly, or a new critical issue is detected.

### 6.6 Dashboard
- FR-24: Dashboard shows all businesses in the organization with current score, grade, trend, and last-scan date.
- FR-25: Dashboard shows an activity feed (scans run, alerts sent).

### 6.7 Admin
- FR-26: Internal admin dashboard (staff-only) shows: total users, active subscriptions, MRR, scan volume, AI cost per scan, failed scans, and allows manual account actions (refund flag, plan override, ban).

### 6.8 API (Phase 4+)
- FR-27: Agency/top-tier plans can generate API keys and trigger scans / retrieve reports programmatically.

## 7. Non-functional requirements

| Category | Requirement |
|---|---|
| Performance | A scan completes end-to-end in under 3 minutes for 95% of sites (p95). Web app pages (dashboard, report view) load in under 1.5s server-rendered. |
| Scalability | Architecture must support thousands of paying orgs and tens of thousands of scans/month without a rewrite — achieved via serverless hosting (Vercel), a managed Postgres database (Supabase, vertically scalable), and a durable background job queue (Inngest) that absorbs bursts instead of dropping work. |
| Reliability | Scans that fail (site down, timeout, malformed HTML) fail gracefully with a clear user-facing message and are retried automatically up to 2 times before being marked failed. Background jobs are retry-safe (idempotent) by design. |
| Cost control | Every AI/API call in a scan is logged with its cost. We must always know our gross margin per scan and per plan tier. Rate limiting prevents runaway costs from abuse. |
| Security | All tenant data isolated via Postgres Row Level Security. All secrets in environment variables, never in code. Stripe webhooks signature-verified. See `12-security-plan.md` for full detail. |
| Accessibility | The GrowthOS app itself (not just the sites it scans) meets WCAG 2.1 AA on core flows — it would be embarrassing for an accessibility-auditing product to be inaccessible. |
| Data retention | Scan raw data retained 12 months; reports retained indefinitely while the account is active; data deleted within 30 days of account deletion request (see security plan). |
| Browser support | Latest 2 versions of Chrome, Safari, Firefox, Edge; iOS Safari and Android Chrome for mobile. |
| Uptime target | 99.5% for the web app (Vercel/Supabase SLAs support this without extra infra work at our stage). |

## 8. Assumptions & constraints

- We rely on third-party APIs (Google PageSpeed Insights API, Google Business Profile public data, OpenAI, Anthropic, a SERP/competitor data provider). Our reliability and cost are partly dependent on theirs — mitigated with caching, retries, and graceful degradation (a category that fails to load doesn't fail the whole report).
- Google Business Profile does not offer a public API for arbitrary businesses without the business owner authenticating; v1 will source GBP signals from public Google Maps/Search data (e.g., via a SERP data provider) rather than requiring the user to connect their GBP account. Connecting a real GBP account (OAuth) is a strong Phase 5+ candidate (see future expansion) because it unlocks first-party data and auto-posting.
- Competitor identification is automated (based on industry + location) with a manual override, since fully automated competitor discovery is imperfect.
- "AI Search optimization" scoring is inherently a snapshot (LLMs are non-deterministic and change over time); we label it clearly as "as of [date]" and re-check on each scheduled scan.

## 9. Success metrics

- Activation: % of visitors who submit a URL and see a teaser report.
- Conversion: % of teaser-report viewers who create an account; % of free accounts who become paying subscribers.
- Retention: monthly logo retention and net revenue retention for paying orgs.
- Report quality (proxy): % of findings a user marks "helpful" (thumbs up/down on findings, collected from day one to tune agent prompts).
- Unit economics: AI + API cost per scan vs. revenue per scan, tracked from Milestone 1 onward.
