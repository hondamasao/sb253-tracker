import "server-only";
import { env } from "@/lib/env";
import { countRecentScansByIp, sumAgentSpendSince } from "@/lib/scans";
import { dailySpendCapUsd } from "@/lib/budget";

/**
 * Default free scans per IP per hour.
 *
 * NOTE — this is a conversion question, not a fixed security parameter.
 * The free scan is the top of the acquisition funnel, and this limit is
 * keyed on IP: an office, a coffee shop, a school, or anyone behind
 * carrier-grade NAT shares one address, so the fourth genuinely
 * interested prospect in an hour gets a 429 and probably never comes
 * back. It is left at 3 for now because there is no traffic data to tune
 * against, and it is env-configurable (SCANS_PER_IP_PER_HOUR) precisely
 * so it can be raised without a redeploy once real funnel data exists.
 * Revisit alongside the first conversion numbers, not as a security
 * review item.
 */
const DEFAULT_SCANS_PER_IP_PER_HOUR = 3;

export function scansPerIpPerHour(): number {
  return env.SCANS_PER_IP_PER_HOUR ?? DEFAULT_SCANS_PER_IP_PER_HOUR;
}

export type RateLimitVerdict = {
  allowed: boolean;
  limit: number;
  reason?: string;
};

/**
 * Per-IP request limiting. Protects against one actor scripting the free
 * endpoint; it does NOT bound spend, which is what `checkDailySpendCap`
 * below is for.
 */
export async function checkScanRateLimit(
  ipAddress: string | null,
): Promise<RateLimitVerdict> {
  const limit = scansPerIpPerHour();

  if (!ipAddress) {
    // No IP to key off (e.g. unusual proxy setup) — fail open rather than
    // blocking legitimate traffic. Safe only because the daily spend cap
    // below is IP-independent and bounds the damage regardless.
    return { allowed: true, limit };
  }

  const recentCount = await countRecentScansByIp(ipAddress, 60);
  return {
    allowed: recentCount < limit,
    limit,
    reason:
      recentCount < limit
        ? undefined
        : `Too many scans from this address. Limit is ${limit} per hour.`,
  };
}

/**
 * Global spend ceiling across all scans in a rolling 24 hours, checked at
 * the **queue boundary** — before a scan row is created and before the
 * job is enqueued.
 *
 * Enforcing it here rather than mid-pipeline is the whole point: a scan
 * that is aborted halfway has already burned most of its cost and leaves
 * the user with a failed scan and us with the bill. A per-IP request
 * limit does not help — 2,000 individually compliant scans from 2,000
 * addresses are each within their limit and collectively expensive. This
 * is the only control that bounds total money.
 */
export async function checkDailySpendCap(): Promise<RateLimitVerdict> {
  const cap = dailySpendCapUsd();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const spent = await sumAgentSpendSince(since);

  if (spent >= cap) {
    return {
      allowed: false,
      limit: cap,
      reason:
        "Scanning is temporarily paused because today's processing budget has been reached. Please try again tomorrow.",
    };
  }
  return { allowed: true, limit: cap };
}
