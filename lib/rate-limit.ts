import "server-only";
import { countRecentScansByIp } from "@/lib/scans";

const MAX_SCANS_PER_IP_PER_HOUR = 3;

/**
 * Simple Postgres-backed rate limit on free scan requests — the plan
 * explicitly chose this over standing up Upstash Redis this early (see
 * docs/15-mvp-scope-and-m0-plan.md §1.1). Protects our own AI/API budget
 * from scripted abuse; a separate, unrelated set of limits in the crawler
 * itself protects the *target* site from being over-crawled (see
 * docs/17-m1-crawler-architecture.md §2).
 */
export async function checkScanRateLimit(
  ipAddress: string | null,
): Promise<{ allowed: boolean; limit: number }> {
  if (!ipAddress) {
    // No IP to key off (e.g. unusual proxy setup) — fail open rather than
    // blocking legitimate traffic; abuse without a stable IP to rate-limit
    // against is a problem for a later, more robust control anyway.
    return { allowed: true, limit: MAX_SCANS_PER_IP_PER_HOUR };
  }

  const recentCount = await countRecentScansByIp(ipAddress, 60);
  return {
    allowed: recentCount < MAX_SCANS_PER_IP_PER_HOUR,
    limit: MAX_SCANS_PER_IP_PER_HOUR,
  };
}
