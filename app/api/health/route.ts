import { NextResponse } from "next/server";

/**
 * Liveness check — used to confirm a deploy is actually serving traffic
 * (docs/15-mvp-scope-and-m0-plan.md §3.2/3.3). Deliberately has zero
 * dependencies (no env, no database, no Inngest) so it stays useful as a
 * "is the app up at all" signal even if a real config problem elsewhere
 * is broken — mixing that in would turn a liveness check into a
 * dependency check, which is a different, noisier signal.
 */
export function GET() {
  return NextResponse.json({ ok: true, timestamp: new Date().toISOString() });
}
