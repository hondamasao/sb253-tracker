import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { agentRuns, scans } from "@/db/schema";
import type { AgentRunResult } from "@/agents";

export async function createScan(params: {
  websiteUrl: string;
  ipAddress: string | null;
}): Promise<{ id: string; reportToken: string }> {
  const db = getDb();
  const [row] = await db
    .insert(scans)
    .values({
      websiteUrl: params.websiteUrl,
      ipAddress: params.ipAddress,
    })
    .returning({ id: scans.id, reportToken: scans.reportToken });

  if (!row) {
    throw new Error("Failed to create scan row.");
  }
  return row;
}

export async function markScanRunning(scanId: string): Promise<void> {
  await getDb()
    .update(scans)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(scans.id, scanId));
}

export async function markScanCompleted(scanId: string): Promise<void> {
  await getDb()
    .update(scans)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(scans.id, scanId));
}

export async function markScanFailed(
  scanId: string,
  errorMessage: string,
): Promise<void> {
  await getDb()
    .update(scans)
    .set({ status: "failed", completedAt: new Date(), errorMessage })
    .where(eq(scans.id, scanId));
}

/**
 * Persists one agent's outcome — completed or failed — as its own row.
 * Called once per agent, independently, so one agent's failure never
 * prevents another's successful result from being saved (per the
 * per-agent isolation design in docs/17-m1-crawler-architecture.md §4).
 */
export async function saveAgentRun(
  scanId: string,
  result: AgentRunResult,
): Promise<void> {
  const now = new Date();

  if (result.status === "completed") {
    await getDb()
      .insert(agentRuns)
      .values({
        scanId,
        agentType: result.agentType,
        status: "completed",
        score: result.score,
        rawOutput: result.raw,
        modelUsed: result.modelUsed ?? null,
        costUsd: result.costUsd !== undefined ? result.costUsd.toFixed(5) : null,
        startedAt: now,
        completedAt: now,
      });
    return;
  }

  await getDb()
    .insert(agentRuns)
    .values({
      scanId,
      agentType: result.agentType,
      status: "failed",
      errorMessage: result.error,
      startedAt: now,
      completedAt: now,
    });
}

/**
 * Backs the per-IP rate limit on POST /api/scans — a plain count query
 * against our own database instead of standing up Upstash Redis this
 * early, per docs/15-mvp-scope-and-m0-plan.md §1.1.
 */
export async function countRecentScansByIp(
  ipAddress: string,
  sinceMinutesAgo: number,
): Promise<number> {
  const since = new Date(Date.now() - sinceMinutesAgo * 60_000);
  const result = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(scans)
    .where(and(eq(scans.ipAddress, ipAddress), gte(scans.createdAt, since)));

  return Number(result[0]?.count ?? 0);
}
