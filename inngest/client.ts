import "server-only";
import { Inngest } from "inngest";
import { env } from "@/lib/env";

/**
 * The Inngest client — the entry point both for sending events ("a scan
 * was requested") and, starting M1, for registering the functions that
 * handle them (see app/api/inngest/route.ts). No functions exist yet in
 * M0; this file exists now so M1 can write inngest/functions/* against an
 * already-verified connection instead of debugging the wiring and the
 * first real background job at the same time.
 *
 * `eventKey` is only required once this runs against Inngest Cloud — the
 * local Inngest Dev Server (`npx inngest-cli dev`) needs no keys at all.
 */
export const inngest = new Inngest({
  id: "growthos",
  eventKey: env.INNGEST_EVENT_KEY,
});
