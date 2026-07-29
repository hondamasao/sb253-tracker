# Security Plan

## Threat model, in plain terms

For a product like GrowthOS, the realistic risks — in priority order — are: (1) one customer's data leaking to another customer (multi-tenancy failure), (2) account takeover, (3) billing/payment fraud or manipulation, (4) abuse of our AI/API resources running up costs, (5) a general web vulnerability (injection, XSS) in a route we wrote. Everything below maps to one of these five.

## 1. Multi-tenant data isolation

- **Postgres Row Level Security (RLS) is the primary defense**, not application-layer checks (per `03-database-schema.md`). Every table is scoped to `organization_id` via a policy that checks `auth.uid()` against `organization_members`. Even a bug in our API code cannot leak another org's rows, because the database itself refuses the query.
- The Supabase **service-role key** (which bypasses RLS) is used only in trusted server contexts that must legitimately cross tenants (e.g., the scheduled-scan cron finding all due businesses across all orgs). It is never sent to the browser and never used inside a user-facing request path.
- Automated integration tests explicitly prove cross-tenant isolation (see `10-testing-strategy.md`) — this is treated as a release-blocking test category, not optional coverage.

## 2. Authentication & session security

- Supabase Auth handles password hashing, session tokens, and OAuth (Google) — we do not write our own auth/crypto code, which is the single biggest security win available to a small team (auth bugs are one of the most common and most severe classes of vulnerability, and Supabase's implementation is audited and battle-tested at far larger scale than we could self-verify).
- Sessions use secure, httpOnly cookies; `middleware.ts` enforces auth on every protected route server-side (never relying on the client to "just not show" a protected page).
- Passwords: minimum length + breach-list check (Supabase supports this); optional in later phase — 2FA for admin/staff accounts specifically, since those hold the most leverage.

## 3. Billing & payment security

- We never touch, store, or transmit raw card data — Stripe Checkout and the Customer Portal are Stripe-hosted, so we're never in PCI-DSS scope beyond the lightest tier.
- Stripe webhook endpoint verifies the `Stripe-Signature` header on every request; unsigned/invalid requests are rejected before any processing.
- Plan-limit enforcement happens server-side on every relevant request (never trust a client-sent "my plan is Agency" value).

## 4. Abuse & cost-control

- **Rate limiting** (Upstash Redis) on anonymous scan submission by IP, and on authenticated scan requests by org, to stop both scripted abuse and accidental cost spirals.
- **CAPTCHA or equivalent friction** (e.g., Cloudflare Turnstile) on the anonymous scan form if/when abuse is observed — not built pre-emptively, but planned for and cheap to add given the form is already isolated in one component.
- Every external paid API call (AI models, PageSpeed, SERP provider) is logged with cost, letting us set hard monthly cost alerts and investigate anomalies quickly.
- API keys (Phase 4 public API) are rate-limited per key and can be instantly revoked.

## 5. Application-layer security (OWASP-style hygiene)

- **Input validation**: every API route validates its input with a Zod schema before touching the database or calling an external service — this defends against malformed input causing crashes and against injection-style attacks.
- **SQL injection**: not applicable in the traditional sense — Drizzle ORM uses parameterized queries exclusively; we never string-concatenate raw SQL.
- **XSS**: React escapes output by default; any place we render AI-generated or user-generated text as HTML (none currently planned) would require explicit sanitization — flagged as a rule for future features, not just a one-time check.
- **CSRF**: mitigated by Supabase's cookie-based session model (`SameSite` cookies) plus Next.js's built-in protections for Server Actions/route handlers.
- **Security headers**: standard hardening via `next.config.ts` (Content-Security-Policy, `X-Frame-Options`, `Referrer-Policy`, etc.), configured in M0/M1 so it's never "added later."
- **Dependency scanning**: GitHub Dependabot enabled from day one on this repo, auto-opening PRs for vulnerable dependency updates.
- **Secrets**: never committed to git (enforced by a pre-commit check + `.gitignore`), stored only in Vercel environment variables, scoped per environment (see `11-deployment-strategy.md`).

## 6. Data privacy & retention

- We collect the minimum necessary: business website/contact info the user provides, plus publicly available data about that business (reviews, GBP listing) gathered as part of the scan — no unrelated personal data collection.
- Scan raw data (`agent_runs.raw_output`) retained 12 months, then purged; polished `reports` retained while the account is active.
- Account deletion request: all personally identifying data removed within 30 days; aggregate, de-identified metrics (e.g., "we've run 50,000 scans") may be retained.
- A privacy policy and terms of service are required before public launch (legal documents, not engineering — flagged here as a dependency of going live, tracked alongside M6 billing launch).

## 7. Admin & internal access

- Admin dashboard (`/admin`, FR-26) is gated by a `role = 'staff'` check that is *not* the same as an organization role — it's a separate, explicitly-granted flag on a profile, so no organization owner/admin can ever accidentally see cross-customer data through a role-naming collision.
- All admin actions that change customer data (refund flags, plan overrides, bans) are written to `audit_logs` with the acting user, so every privileged action is traceable after the fact.

## 8. Incident response (lightweight, for our current stage)

- Sentry alerts route to you immediately for unhandled errors.
- A documented (even if simple) runbook: if a data leak or breach is suspected — rotate affected keys immediately, identify scope via `audit_logs`, notify affected customers per applicable law, and file a postmortem. This gets fleshed out formally before Phase 4 (team accounts) when the blast radius of a mistake grows.
