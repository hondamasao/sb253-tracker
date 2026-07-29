import * as Sentry from "@sentry/nextjs";

/**
 * Client-side (browser) Sentry init. Next.js auto-loads this file by
 * convention — nothing else needs to import it.
 *
 * Sentry safely does nothing (no errors, no crash) when
 * NEXT_PUBLIC_SENTRY_DSN is unset, which is the case until a real Sentry
 * project exists (docs/15-mvp-scope-and-m0-plan.md §3.1) — so this can
 * ship now and start reporting the moment the DSN is added in Vercel.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  // Session Replay is powerful but adds real cost at scale — left off in
  // M0, revisit once there's real traffic to justify it.
});

// Required export: lets Sentry track client-side route transitions as
// part of a request's performance trace.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
