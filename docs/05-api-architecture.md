# API Architecture

## Two different "APIs," on purpose

GrowthOS has two distinct API surfaces that are easy to conflate but serve different purposes:

1. **Internal API** (`app/api/...`) — used only by our own frontend. Not versioned, can change anytime, not documented externally.
2. **Public API** (`app/api/v1/...`, Phase 4) — used by paying Agency-tier customers to integrate GrowthOS into their own tools. Versioned, documented, stable, authenticated with API keys instead of user sessions.

We build the internal API first and design it cleanly enough that carving out the public API later is straightforward (same underlying logic in `lib/`, just a different auth layer and response contract on top).

## Why background jobs are a separate system from the API

A core constraint: **a website scan takes 30–90 seconds**, involving a dozen sequential/parallel steps (crawl the site, call Google PageSpeed, call multiple AI models, look up competitors). A normal Next.js API route on Vercel has a hard execution timeout (10s–60s depending on plan) — nowhere near enough, and even if it were, holding an HTTP connection open that long is bad practice (any network hiccup loses all progress).

So we split the work:

- **API routes** are fast and synchronous: they validate input, kick off a background job, and return immediately ("scan started, here's an ID").
- **Inngest functions** do the actual slow work, running as independent, durable, multi-step jobs that can take minutes, retry individual failed steps without redoing everything, and update the database as they go.
- The **frontend polls or subscribes** to scan status (simplest: poll `GET /api/scans/[id]` every 2s; can upgrade to Supabase Realtime later for push-based updates with no extra backend work, since Supabase already broadcasts database changes).

This pattern — thin API, fat background job — is the single most important architectural decision in the product, because it's what makes "16 AI agents analyzing a website" reliable instead of a request that randomly times out.

## Request flow: starting a scan

```
Browser                Next.js API route          Inngest                 Database
   │  POST /api/scans        │                        │                        │
   ├─────────────────────────▶                        │                        │
   │                         │ validate URL (Zod)      │                        │
   │                         │ create `scans` row       │                        │
   │                         │ (status: queued)         │                        │
   │                         ├──────────────────────────────────────────────────▶
   │                         │ send event               │                        │
   │                         │ "scan/started"            ▶                       │
   │                         │                        ├─ run-scan function      │
   │  ◀──────────────────────┤ 202 { scanId }            │  starts               │
   │  { scanId: "..." }      │                        │                        │
   │                         │                        │  step 1: crawl site     │
   │  GET /api/scans/:id      │                        │  step 2: run 16 agents │
   │  (poll every 2s)         │                        │   (parallel, see        │
   ├─────────────────────────▶                        │    06-ai-agent-arch)    │
   │  ◀──────────────────────┤ reads `scans`/`reports`  │  step 3: synthesis     │
   │  { status: "running" }  │  from DB, returns status │  step 4: save report   │
   │                         │                        │  step 5: render PDF     │
   │                         │                        │  step 6: send email      │
   │  GET /api/scans/:id      │                        │  (status: completed)   ◀┤
   │  ◀──────────────────────┤ { status: "completed",  │                        │
   │  { status: "completed", │   reportId: "..." }     │                        │
   │    reportId }           │                        │                        │
```

## Internal API surface (Phase 1–3)

| Route | Method | Purpose | Auth |
|---|---|---|---|
| `/api/scans` | POST | Start a scan for a URL | Optional (anonymous allowed, rate-limited by IP) |
| `/api/scans/[scanId]` | GET | Poll scan status/result | Optional (owner or anonymous session token) |
| `/api/reports/[reportId]/pdf` | GET | Stream/download the PDF | Required once report is "unlocked" |
| `/api/businesses` | GET, POST | List/add businesses | Required |
| `/api/businesses/[id]` | GET, PATCH, DELETE | Manage a business | Required |
| `/api/businesses/[id]/schedule` | PUT | Set monitoring frequency | Required, plan-gated |
| `/api/organizations/[id]/members` | GET, POST, DELETE | Team management | Required, role-gated |
| `/api/billing/checkout` | POST | Create Stripe Checkout session | Required |
| `/api/billing/portal` | POST | Create Stripe Customer Portal session | Required |
| `/api/webhooks/stripe` | POST | Stripe billing events | Stripe signature |
| `/api/webhooks/inngest` | POST/PUT | Inngest's function invocation endpoint | Inngest signing key |

Every route's input is validated with a Zod schema in `lib/validations/` before touching the database — no route trusts its own request body.

## Public API surface (Phase 4)

Versioned under `/api/v1/`, authenticated via `Authorization: Bearer gos_live_...` API keys (see `api_keys` table), rate-limited per key via Upstash Redis.

| Route | Method | Purpose |
|---|---|---|
| `/api/v1/scans` | POST | Trigger a scan programmatically |
| `/api/v1/scans/{id}` | GET | Get scan status/result |
| `/api/v1/reports/{id}` | GET | Get structured report JSON |
| `/api/v1/businesses` | GET, POST | Manage businesses via API |

Response format follows a consistent envelope (`{ data, error, meta }`) and documented errors use standard HTTP status codes (400 validation, 401 auth, 403 plan-limit, 404 not found, 429 rate limited, 500 server error) — predictable enough that agency developers can integrate without guesswork.

## Authentication layers

- **Session auth** (internal API, web app): Supabase Auth session cookie, verified server-side via `lib/supabase/server.ts` on every request in `middleware.ts` for protected routes.
- **Service-role access** (background jobs only): Inngest functions use the Supabase service-role key (`lib/supabase/admin.ts`) to bypass RLS when doing legitimate cross-tenant system work (e.g., the scheduler scanning all due `monitoring_schedules` across every org). This key never reaches the browser or a user-facing route.
- **API key auth** (public API, Phase 4): hashed key lookup against `api_keys`, scoped to a single organization.

## Error handling & idempotency

Because scans run as multi-step background jobs that can retry, every step is written to be **idempotent** — safe to run twice. Concretely: each Inngest step checks "has this already been done?" (e.g., "does an `agent_runs` row for this scan+agent already have `status = completed`?") before doing paid work again. This is what prevents a transient network blip from silently double-charging us for AI calls or creating duplicate report rows.
