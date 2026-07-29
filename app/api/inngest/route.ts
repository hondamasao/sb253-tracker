import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { runScan } from "@/inngest/functions/run-scan";

/**
 * Inngest's serve handler — the single HTTP endpoint Inngest calls into to
 * invoke registered functions.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [runScan],
});
