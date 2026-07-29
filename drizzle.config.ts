import { defineConfig } from "drizzle-kit";

try {
  // Node's built-in .env loader (no extra dependency needed). Silently
  // skipped when the file doesn't exist — e.g. in CI, where `generate`
  // still works fine since it only reads db/schema.ts, not a live database.
  process.loadEnvFile(".env.local");
} catch {
  // .env.local not present — fine for `db:generate`; `db:migrate`/`db:studio`
  // need a real DATABASE_URL to actually connect.
}

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
