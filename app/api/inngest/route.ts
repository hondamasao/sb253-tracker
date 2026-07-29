import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";

/**
 * Inngest's serve handler — the single HTTP endpoint Inngest calls into to
 * invoke registered functions. `functions` is empty in M0 on purpose: no
 * background jobs exist yet. This endpoint exists purely to prove the
 * client/route wiring deploys and connects correctly before M1 adds the
 * first real job (run-scan).
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [],
});
