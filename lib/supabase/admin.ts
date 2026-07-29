import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

let client: SupabaseClient | undefined;

/**
 * Service-role Supabase client — bypasses Row Level Security entirely.
 * That's intentional and safe here because:
 *  1. `server-only` (imported transitively via lib/env) makes it a build
 *     error to ever import this from client-side code.
 *  2. It's only used in trusted server contexts (API routes, Inngest jobs)
 *     that do their own authorization — e.g. matching a scan's report_token
 *     — rather than relying on RLS to enforce access.
 *
 * There is no browser-side Supabase client in this MVP (no accounts to log
 * into — see docs/15-mvp-scope-and-m0-plan.md §1.1/§1.4). Every database
 * read/write goes through this client or the Drizzle client in db/index.ts.
 *
 * A getter, not a plain export — same reasoning as db/index.ts's getDb():
 * constructing the client needs real credentials, and Next.js evaluates
 * every route's module graph at build time, so deferring construction to
 * first call keeps `next build` green without real secrets present.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (!client) {
    const url = requireEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      "From Supabase → Project Settings → API.",
    );
    const serviceRoleKey = requireEnv(
      "SUPABASE_SERVICE_ROLE_KEY",
      "From Supabase → Project Settings → API. Never expose this value to the browser.",
    );

    client = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return client;
}
