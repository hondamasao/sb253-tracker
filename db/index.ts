import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requireEnv } from "@/lib/env";
import * as schema from "./schema";

let client: ReturnType<typeof postgres> | undefined;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined;

function getClient() {
  if (!client) {
    const databaseUrl = requireEnv(
      "DATABASE_URL",
      "Get it from Supabase → Project Settings → Database → Connection string (URI, pooled).",
    );

    // `prepare: false` is required when connecting through Supabase's
    // pooled connection string (pgbouncer in "transaction" mode, the
    // default Supabase hands out) — that pooling mode doesn't support
    // prepared statements, so leaving this on would cause intermittent
    // query failures under real concurrent load.
    client = postgres(databaseUrl, { prepare: false });
  }
  return client;
}

/**
 * The Drizzle database client, built lazily on first call rather than as a
 * plain top-level export — constructing it requires DATABASE_URL, and
 * Next.js evaluates every route's module graph at build time (see
 * lib/env.ts), so a plain `export const db = drizzle(...)` would force a
 * real DATABASE_URL to exist just to run `next build`. Call `getDb()`
 * from inside route handlers / Inngest functions, not at module scope.
 */
export function getDb() {
  if (!dbInstance) {
    dbInstance = drizzle(getClient(), { schema });
  }
  return dbInstance;
}
