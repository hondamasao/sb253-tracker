import * as Sentry from "@sentry/nextjs";

/**
 * Next.js's instrumentation hook — runs once when the server starts, in
 * whichever runtime (Node.js or Edge) is about to handle requests. This is
 * what loads the right Sentry init for that runtime, replacing the older
 * per-runtime sentry.*.config.ts auto-loading convention.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captures errors thrown during server-side rendering / server actions
// that wouldn't otherwise reach Sentry.captureException.
export const onRequestError = Sentry.captureRequestError;
