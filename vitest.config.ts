import { defineConfig } from "vitest/config";
import path from "node:path";

try {
  // Same pattern as drizzle.config.ts: load real local secrets (notably
  // ANTHROPIC_API_KEY) from .env.local so the M1b integration tests
  // (tests/integration/agents-real-api.test.ts) run for real whenever a
  // developer has a real key set locally, and skip cleanly otherwise.
  // Silently a no-op in CI, where .env.local never exists.
  process.loadEnvFile(".env.local");
} catch {
  // .env.local not present — fine, every env var this project reads is optional.
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // See tests/stubs/server-only.ts for why this is aliased.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
