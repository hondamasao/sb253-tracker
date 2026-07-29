// `server-only` is a build-time guard meant to make webpack/Turbopack fail
// if server code is pulled into a client bundle. That concept doesn't
// apply when running tests directly under Node (Vitest) — there is no
// client bundle being built — so it's aliased to this no-op here instead
// of throwing, which is what the real package does unconditionally
// outside a bundler context. See vitest.config.ts.
export {};
