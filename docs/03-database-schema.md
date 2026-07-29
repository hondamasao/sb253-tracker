# Database Schema

## Why this design

A few decisions shape every table below, so we explain them once here instead of repeating ourselves:

1. **Organizations, not just users, own data.** Even though team accounts don't ship until Phase 4, every business/scan/report belongs to an `organizations` row, not a `users` row, from day one. Retrofitting multi-tenancy later (moving ownership from users to orgs) would mean a painful data migration and rewriting every security policy. Building it right the first time costs almost nothing extra now.
2. **Row Level Security (RLS) is our real security boundary**, not application code. Every table below gets a Postgres RLS policy that says "you may only see rows belonging to an organization you're a member of." Even if we ever ship a buggy API route, the database itself refuses to leak data across tenants.
3. **Raw AI/agent output is stored separately from the polished report.** `agent_runs` holds the messy, detailed JSON each analysis agent produces. `reports` and `findings` hold the clean, human-facing result. This separation lets us re-generate a nicer report later from the same raw data without re-running expensive AI calls, and lets us debug "why did the AI say this" by inspecting the raw run.
4. **Money (Stripe) data is mirrored, not the source of truth.** Stripe is always the source of truth for billing; our `subscriptions` table is a cache we keep in sync via webhooks, used so the app doesn't need to call Stripe's API on every page load.

## Entity relationship summary

```
auth.users (Supabase-managed)
   │ 1:1
   ▼
profiles
   │
   │ N:M (via organization_members)
   ▼
organizations ──1:1── subscriptions
   │ 1:N
   ▼
businesses
   │ 1:N
   ▼
scans ──1:N── agent_runs
   │ 1:1
   ▼
reports ──1:N── findings
   │
businesses ──1:N── competitors (per scan)
businesses ──1:N── monitoring_schedules
businesses ──1:N── score_history
businesses ──1:N── alerts
organizations ──1:N── api_keys
organizations ──1:N── audit_logs
```

## Tables

All tables live in the `public` schema of the Supabase Postgres database. All `id` columns are `uuid` generated with `gen_random_uuid()`. All tables have `created_at timestamptz default now()` unless noted.

### `profiles`
One row per Supabase Auth user — extends the built-in `auth.users` table with app-specific fields we control.

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);
```
*Why it exists separately from `auth.users`:* Supabase manages `auth.users` internally (passwords, sessions); we're not supposed to add arbitrary columns to it. `profiles` is our own table, kept in sync automatically via a Postgres trigger on user signup.

### `organizations`
```sql
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_id uuid not null references profiles(id),
  plan text not null default 'free', -- 'free' | 'starter' | 'growth' | 'agency'
  created_at timestamptz not null default now()
);
```

### `organization_members`
```sql
create table organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'member', -- 'owner' | 'admin' | 'member'
  invited_email text, -- set when invited but not yet accepted
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
```

### `subscriptions`
```sql
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references organizations(id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  plan text not null default 'free',
  status text not null default 'inactive', -- mirrors Stripe: 'trialing'|'active'|'past_due'|'canceled'|'inactive'
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);
```

### `businesses`
```sql
create table businesses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade, -- null for anonymous pre-signup scans
  name text,
  website_url text not null,
  industry text, -- 'plumbing' | 'hvac' | 'roofing' | 'electrical' | 'landscaping' | 'pest_control' | 'other'
  address text,
  city text,
  state text,
  postal_code text,
  phone text,
  google_business_profile_url text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
```
*Why `organization_id` is nullable:* Phase 1 supports anonymous scans (no login) per FR-1/FR-11. When an anonymous user later signs up, we attach their scan's business row to their new organization instead of losing the data.

### `scans`
```sql
create table scans (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  status text not null default 'queued', -- 'queued' | 'running' | 'completed' | 'failed'
  scan_type text not null default 'manual', -- 'manual' | 'scheduled'
  triggered_by uuid references profiles(id), -- null for anonymous/system
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);
```

### `agent_runs`
One row per analysis agent, per scan — the raw output.
```sql
create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans(id) on delete cascade,
  agent_type text not null, -- see full enum in 06-ai-agent-architecture.md
  status text not null default 'queued', -- 'queued' | 'running' | 'completed' | 'failed'
  score integer, -- 0-100, null until completed
  raw_output jsonb, -- full structured output from the agent
  model_used text, -- e.g. 'gpt-4o-mini', 'claude-sonnet', or null for non-AI agents
  cost_usd numeric(10,5), -- tracked per run for margin visibility
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);
```

### `reports`
The polished, human-facing output of a completed scan.
```sql
create table reports (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null unique references scans(id) on delete cascade,
  overall_score integer not null,
  letter_grade text not null, -- 'A'|'B'|'C'|'D'|'F'
  executive_summary text not null, -- AI-generated narrative summary
  estimated_lost_leads_min integer,
  estimated_lost_leads_max integer,
  monthly_action_plan jsonb not null, -- structured month 1/2/3 plan
  pdf_url text, -- Supabase Storage path once generated
  generated_at timestamptz not null default now()
);
```

### `findings`
Individual, actionable issues that make up a report's checklist.
```sql
create table findings (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  agent_type text not null,
  category text not null, -- human-facing grouping, e.g. 'Trust Signals'
  severity text not null, -- 'critical' | 'high' | 'medium' | 'low'
  title text not null,
  description text not null,
  recommendation text not null,
  estimated_impact text, -- plain-language ROI note, e.g. "could recover ~8 leads/mo"
  effort_level text, -- 'low' | 'medium' | 'high' — used to rank ROI (impact vs effort)
  before_example text,
  after_example text,
  priority_rank integer not null, -- 1 = fix first
  created_at timestamptz not null default now()
);
```

### `competitors`
```sql
create table competitors (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans(id) on delete cascade,
  name text not null,
  website_url text,
  comparison_data jsonb not null, -- category scores for the competitor, same shape as agent_runs scores
  created_at timestamptz not null default now()
);
```

### `monitoring_schedules`
```sql
create table monitoring_schedules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references businesses(id) on delete cascade,
  frequency text not null default 'weekly', -- 'weekly' | 'monthly'
  is_active boolean not null default true,
  next_run_at timestamptz not null,
  created_at timestamptz not null default now()
);
```

### `score_history`
Denormalized on purpose — cheap to query for trend charts without joining through scans/reports every time.
```sql
create table score_history (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  scan_id uuid not null references scans(id) on delete cascade,
  overall_score integer not null,
  category_scores jsonb not null, -- { "performance": 82, "local_seo": 61, ... }
  recorded_at timestamptz not null default now()
);
```

### `alerts`
```sql
create table alerts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  type text not null, -- 'score_drop' | 'new_critical_issue' | 'scan_complete' | 'scan_failed'
  message text not null,
  email_sent boolean not null default false,
  created_at timestamptz not null default now()
);
```

### `api_keys` (Phase 4)
```sql
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  key_hash text not null unique, -- we store a hash, never the raw key
  key_prefix text not null, -- first 8 chars shown in UI, e.g. "gos_live_a1b2c3d4"
  scopes text[] not null default '{scan:read,scan:write}',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
```

### `audit_logs`
```sql
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  user_id uuid references profiles(id),
  action text not null, -- e.g. 'member.invited', 'plan.changed', 'business.deleted'
  target_type text,
  target_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);
```

## Row Level Security pattern

Every org-scoped table follows the same policy shape. Example for `businesses`:

```sql
alter table businesses enable row level security;

create policy "Members can view their org's businesses"
  on businesses for select
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

create policy "Members can insert businesses into their org"
  on businesses for insert
  with check (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );
```
The same `select`/`insert`/`update`/`delete` pattern (scoped through `organization_members`) is applied to `scans`, `reports`, `findings`, `competitors`, `monitoring_schedules`, `score_history`, `alerts`, `api_keys`, and `audit_logs`, joining up through `business_id`/`scan_id`/`report_id` back to `organization_id` where the table doesn't have `organization_id` directly. Anonymous (pre-signup) scans use a separate, narrower policy scoped by a signed session token instead of `auth.uid()`, since there's no logged-in user yet.

## Migrations

Schema changes are written as Drizzle ORM migrations (`drizzle-kit generate` + `drizzle-kit push`), version-controlled in `db/migrations/`, and applied to Supabase via CI on merge to `main` — never edited by hand in the Supabase dashboard in production. See `04-folder-structure.md` for exactly where these files live and `11-deployment-strategy.md` for how migrations run in CI.
