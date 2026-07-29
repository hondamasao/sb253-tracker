import { z } from "zod";

/**
 * Deliberately not `.url()` — we accept scheme-less input like
 * "acmeplumbing.com" (the common case for a non-technical user), which
 * `normalizeInputUrl` + `assertSafeUrl` turn into a real validated URL
 * downstream. This schema only guards against empty/absurd input so the
 * API can return a fast 400 instead of queuing garbage.
 */
export const createScanInputSchema = z.object({
  websiteUrl: z
    .string()
    .trim()
    .min(1, "websiteUrl is required.")
    .max(2048, "websiteUrl is too long."),
});

export type CreateScanInput = z.infer<typeof createScanInputSchema>;
