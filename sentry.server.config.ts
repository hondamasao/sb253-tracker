import * as Sentry from "@sentry/nextjs";

/**
 * Node.js runtime Sentry init (API routes, Inngest functions running
 * server-side). Loaded by instrumentation.ts, not imported directly.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
});
