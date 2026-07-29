import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Fails the production build on type errors instead of silently shipping
  // them. (Next 16 no longer runs ESLint as part of `next build` — linting
  // is its own CI step, see .github/workflows/ci.yml.)
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default withSentryConfig(nextConfig, {
  // Used only to upload source maps for readable stack traces in Sentry.
  // Safe to leave unset until a real Sentry project exists — the plugin
  // skips the upload step (with a warning, not a build failure) when
  // SENTRY_AUTH_TOKEN isn't present, which is the case until M0's manual
  // Sentry account setup is done.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: true,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
