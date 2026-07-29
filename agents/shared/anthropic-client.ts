import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { requireEnv } from "@/lib/env";

let client: Anthropic | undefined;

/**
 * Lazy Anthropic client, same pattern as db/index.ts's getDb() and
 * lib/supabase/admin.ts's getSupabaseAdmin() — constructing it requires a
 * real ANTHROPIC_API_KEY, and Next.js evaluates every route's module graph
 * at build time, so a plain top-level `new Anthropic(...)` would force a
 * real key to exist just to run `next build`. Call this from inside an
 * agent's run function, not at module scope.
 *
 * When ANTHROPIC_API_KEY is missing, requireEnv() throws a clear error;
 * the category/synthesis agents run inside runAgentSafely (agents/run-safely.ts),
 * so that throw becomes a normal `{status:"failed"}` result — the scan
 * doesn't crash, it just records that agent as failed.
 */
export function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = requireEnv(
      "ANTHROPIC_API_KEY",
      "Get it from https://console.anthropic.com/settings/keys. Required to run the M1b AI report-writing agents — see docs/18-m1b-ai-agent-architecture.md.",
    );
    client = new Anthropic({ apiKey });
  }
  return client;
}
