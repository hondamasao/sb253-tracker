# Deployment Strategy

## Environments

We run three separate environments, kept genuinely isolated from each other (separate databases, separate API keys where possible) so that development mistakes can never touch real customer data or run up real AI costs:

| Environment | Purpose | Database | URL |
|---|---|---|---|
| **Local** | Your own machine, day-to-day development | Local Supabase (via Supabase CLI) or a personal dev Supabase project | `localhost:3000` |
| **Preview** | One per pull request, automatic | Shared staging Supabase project | Auto-generated Vercel preview URL |
| **Production** | Real users, real money | Production Supabase project | `growthos.com` (or chosen domain) |

Vercel creates this preview-per-PR behavior automatically once the GitHub repo is connected — it's one of the main reasons Vercel was chosen as the host: you get a real, shareable, fully-functional deployment of every change before it ever reaches production, at no extra setup cost.

## Branching model

Simple and deliberately low-ceremony for a small team:

```
main            ── always deployable, auto-deploys to Production on merge
 └─ feature/*    ── one branch per milestone/feature, opens a PR into main
```

- Every feature branch gets a free Vercel Preview deployment the moment it's pushed.
- Merging to `main` triggers the Production deploy automatically — so a PR merge *is* the "go live" action. There is no separate manual deploy step, which removes an entire category of human error ("forgot to deploy").
- Database migrations (Drizzle) run as part of the CI pipeline against the target environment's database, before the app deploy completes, so schema and code are never out of sync.

## CI/CD pipeline (GitHub Actions)

```
On every PR:
  1. Install deps
  2. Typecheck + lint
  3. Unit + integration tests (against an ephemeral test DB spun up in CI)
  4. Build
  5. Playwright smoke tests (against the Vercel Preview URL, once deployed)
  → PR shows a green check + a link to its live Preview URL, ready for you to click and manually check

On merge to main:
  1. Same checks as above (safety net)
  2. Run pending Drizzle migrations against Production Supabase
  3. Vercel deploys the new build to Production
  4. Nightly: full Playwright suite runs against Production (read-only checks only) to catch anything preview testing missed
```

## Secrets management

- All secrets (Supabase service key, OpenAI/Anthropic keys, Stripe keys, Resend key, Inngest signing key) live in **Vercel Environment Variables**, scoped per environment (Development/Preview/Production get different values — e.g., Stripe *test* keys in Preview, Stripe *live* keys only in Production).
- `.env.example` in the repo documents every required variable name with a placeholder, so setup is copy-pasteable but no real secret is ever committed.
- Nothing secret is ever hardcoded or logged. Sentry is configured to scrub sensitive fields from error reports.

## Rollback strategy

Because Vercel keeps every previous deployment addressable, a bad Production deploy is fixed by **instantly re-promoting the last-known-good deployment** in the Vercel dashboard (seconds, no rebuild needed) while the root cause is fixed properly on a new branch. Database migrations are written to be backward-compatible where possible (e.g., add a new nullable column in one deploy, backfill and enforce `not null` in a later deploy) specifically so a code rollback never leaves the database in a state the old code can't handle.

## Domains & DNS

- Production app: your chosen domain (e.g., `growthos.com`), pointed at Vercel via their DNS instructions.
- Transactional email (Resend) requires its own DNS records (SPF/DKIM) on the same domain for deliverability — set up once during M6/M7 when email actually starts sending.

## Monitoring in production

- **Sentry**: real-time error alerts (frontend + API routes + Inngest functions).
- **Vercel Analytics**: performance/traffic.
- **PostHog**: funnel tracking for the growth-critical Flow A (visitor → scan → signup → paid), so conversion drop-off is visible, not guessed at.
- **Inngest dashboard**: background job success/failure rates, retry counts — this is our early-warning system for AI provider outages or crawler breakage.
