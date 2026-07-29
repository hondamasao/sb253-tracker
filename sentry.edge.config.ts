import * as Sentry from "@sentry/nextjs";

/**
 * Edge runtime Sentry init (middleware, any route explicitly opted into
 * `runtime: "edge"`). Kept as a separate file from sentry.server.config.ts
 * because the edge runtime has a restricted set of Node APIs available —
 * today's init options happen to be identical, but the split is what lets
 * them diverge safely later without restructuring anything.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
});
