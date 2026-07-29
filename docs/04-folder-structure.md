# Folder Structure

## Why one Next.js app (not a monorepo, yet)

With a small team, a single Next.js application is faster to build, deploy, and reason about than a multi-package monorepo (Turborepo, etc.). Everything below is organized so that splitting things out later (e.g., a separate `packages/ai-agents` package, or a dedicated worker service) is a mechanical move, not a rewrite — but we don't pay that complexity tax until we actually need it (i.e., when a second application, like a marketing-only site or a mobile app, needs to share code).

## Top-level layout

```
growthos/
├─ app/                        # Next.js App Router — pages, layouts, API routes
├─ components/                 # Reusable React UI components
├─ lib/                        # Core business logic, not tied to a specific route
├─ agents/                     # AI analysis agents (the heart of the product)
├─ inngest/                    # Background job definitions (scan orchestration, scheduling, emails)
├─ db/                         # Drizzle schema + migrations
├─ emails/                     # React Email templates
├─ styles/                     # Global Tailwind config/theme
├─ public/                     # Static assets (logo, favicon, og-image)
├─ tests/                      # Vitest (unit/integration) + Playwright (e2e)
├─ docs/                       # This planning documentation
├─ scripts/                    # One-off maintenance/dev scripts
├─ .github/workflows/          # CI pipelines
├─ middleware.ts                # Auth/session middleware (route protection)
├─ next.config.ts
├─ tailwind.config.ts
├─ drizzle.config.ts
├─ package.json
└─ .env.example
```

## `app/` — routes

Next.js App Router: every folder is a URL segment, `page.tsx` is the screen, `route.ts` is an API endpoint. `(marketing)` and `(app)` are "route groups" — they organize files without adding to the URL, and let us give the public marketing pages and the logged-in app completely different layouts (nav, fonts, etc.).

```
app/
├─ (marketing)/
│  ├─ layout.tsx               # Public site layout (nav, footer)
│  ├─ page.tsx                 # Landing page — URL input, hero, how it works
│  ├─ pricing/page.tsx
│  └─ report/[scanId]/page.tsx # Public teaser report (pre-signup)
│
├─ (app)/
│  ├─ layout.tsx               # Logged-in app shell (sidebar, topbar)
│  ├─ dashboard/page.tsx       # List of businesses + scores
│  ├─ businesses/
│  │  ├─ [businessId]/page.tsx        # Business detail + report history
│  │  └─ [businessId]/report/[reportId]/page.tsx  # Full report view
│  ├─ settings/
│  │  ├─ organization/page.tsx        # Org name, team members
│  │  ├─ billing/page.tsx             # Plan + Stripe portal link
│  │  └─ api-keys/page.tsx            # Phase 4
│  └─ admin/                          # Staff-only, gated by role check in layout
│     └─ page.tsx
│
├─ (auth)/
│  ├─ login/page.tsx
│  ├─ signup/page.tsx
│  └─ callback/route.ts        # OAuth/magic-link callback
│
├─ api/
│  ├─ scans/route.ts           # POST — start a scan
│  ├─ scans/[scanId]/route.ts  # GET — scan status/result
│  ├─ reports/[reportId]/pdf/route.ts  # GET — generate/stream PDF
│  ├─ webhooks/
│  │  ├─ stripe/route.ts       # Stripe billing events
│  │  └─ inngest/route.ts      # Inngest job endpoint (see 05-api-architecture.md)
│  └─ v1/                      # Phase 4 public API, versioned
│     └─ scans/route.ts
│
├─ layout.tsx                  # Root layout (fonts, providers)
└─ globals.css
```

## `components/`

```
components/
├─ ui/                # shadcn/ui primitives (button, card, dialog, table...) — generated, lightly customized
├─ marketing/          # Landing page sections (Hero, HowItWorks, PricingTable...)
├─ report/             # ScoreGauge, FindingCard, CategoryBreakdown, CompetitorTable...
├─ dashboard/          # BusinessCard, ScoreTrendChart, ActivityFeed...
└─ layout/             # Navbar, Sidebar, Footer
```

## `lib/`

Business logic that isn't a UI component and isn't an agent — the "glue."

```
lib/
├─ supabase/
│  ├─ client.ts        # Browser Supabase client
│  ├─ server.ts        # Server-side Supabase client (uses cookies/session)
│  └─ admin.ts         # Service-role client, server-only, used sparingly
├─ auth/
│  └─ session.ts        # getCurrentUser(), requireOrg() helpers
├─ stripe/
│  ├─ client.ts
│  └─ plans.ts          # Plan definitions + limits (single source of truth)
├─ scoring/
│  └─ calculate-overall-score.ts  # Weighted scoring formula
├─ pdf/
│  └─ render-report-pdf.tsx        # react-pdf document definition
├─ validations/         # Zod schemas for all API input
└─ utils.ts
```

## `agents/`

Each analysis agent is a self-contained module with a consistent interface (`run(input): Promise<AgentResult>`). See `06-ai-agent-architecture.md` for the full pattern and why it's shaped this way.

```
agents/
├─ types.ts                    # Shared AgentResult, Finding, AgentContext types
├─ orchestrator.ts             # Fans out to all agents, aggregates results
├─ performance/index.ts
├─ technical-seo/index.ts
├─ local-seo/index.ts
├─ mobile/index.ts
├─ google-business-profile/index.ts
├─ accessibility/index.ts
├─ conversion/index.ts
├─ copywriting/index.ts
├─ cta/index.ts
├─ trust-signals/index.ts
├─ reviews/index.ts
├─ competitor/index.ts
├─ ai-search/index.ts
├─ social/index.ts
├─ missing-pages/index.ts
├─ lead-gen/index.ts
└─ synthesis/index.ts          # Combines all agent outputs into the executive report
```

## `inngest/`

```
inngest/
├─ client.ts                    # Inngest client instance
└─ functions/
   ├─ run-scan.ts                # The main orchestration job (Milestone 2)
   ├─ scheduled-scans.ts         # Cron: finds due monitoring_schedules, triggers run-scan
   ├─ send-report-email.ts
   └─ send-alert-email.ts
```

## `db/`

```
db/
├─ schema.ts            # Drizzle table definitions (source of truth, mirrors 03-database-schema.md)
├─ migrations/           # Auto-generated SQL migration files, one per schema change
└─ seed.ts               # Local dev seed data
```

## `emails/`

```
emails/
├─ report-ready.tsx
├─ score-alert.tsx
├─ welcome.tsx
└─ team-invite.tsx
```

## `tests/`

```
tests/
├─ unit/          # Vitest — pure functions (scoring, plan limits, validations)
├─ integration/   # Vitest — API routes against a test database
└─ e2e/           # Playwright — full user flows in a real browser
```

## Naming conventions (kept boringly consistent on purpose)

- Files: `kebab-case.ts` / `kebab-case.tsx`.
- React components: `PascalCase` export name, matching a `kebab-case.tsx` filename (e.g. `score-gauge.tsx` exports `ScoreGauge`).
- One agent = one folder under `agents/`, always exporting a function named `run`.
- Database tables: `snake_case`, plural (matches `03-database-schema.md` exactly — the Drizzle schema is a direct mirror, not a reinterpretation).
