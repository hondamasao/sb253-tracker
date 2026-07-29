import "server-only";
import { z } from "zod";

/**
 * Every environment variable is `.optional()` here on purpose — this file
 * validates *shape* only (a URL looks like a URL), never *presence*.
 * Presence is enforced by whatever code actually needs a value, at the
 * point it's used, via `requireEnv()` below.
 *
 * Why: Next.js evaluates the full module graph of every route at build
 * time — including `next build` itself, not just `next dev` — to collect
 * route metadata, even for routes that are never invoked. A module-scope
 * throw for a "required" variable (the original design) broke the build
 * the moment ANY route imported this file, including CI, which has no
 * real secrets. Splitting shape validation (here) from requiredness
 * (below, called lazily) keeps builds green everywhere while still
 * failing loudly the instant code that truly needs a value runs without
 * one.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  DATABASE_URL: z.string().optional(),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),

  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),

  // M1: scan engine data sources. Anthropic only, per
  // docs/18-m1b-ai-agent-architecture.md — OpenAI isn't reachable from
  // this project's dev sandbox and the team standardized on one provider
  // for the report-writing agents rather than mixing vendors.
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_PAGESPEED_API_KEY: z.string().optional(),

  // M3: payments + email.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Only reachable if a *set* variable has the wrong shape (e.g. a
  // malformed URL) — every field above is optional, so a missing
  // variable alone never lands here.
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(
    `Invalid environment configuration.\n${issues}\n\nSee .env.example for the full list of variables.`,
  );
}

/**
 * Shape-validated, typed environment variables — every field may be
 * `undefined`. Import this instead of reading `process.env` directly in
 * server-only code, for consistent typing and a single documented list
 * (.env.example) of everything the app can use.
 */
export const env = parsed.data;

/**
 * Asserts a variable that IS required for the calling code path is
 * actually present, throwing a clear, actionable error naming exactly
 * what's missing if not.
 *
 * Call this inside a function body (a route handler, an Inngest function,
 * a lazy client getter like db/index.ts's getDb()) — never at a module's
 * top level — so the check runs when that code path actually executes,
 * not merely when the module happens to be imported as part of Next's
 * build-time route analysis.
 */
export function requireEnv<K extends keyof typeof env>(
  key: K,
  hint?: string,
): NonNullable<(typeof env)[K]> {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new Error(
      `Missing required environment variable: ${String(key)}.${hint ? ` ${hint}` : ""} See .env.example.`,
    );
  }
  return value as NonNullable<(typeof env)[K]>;
}
