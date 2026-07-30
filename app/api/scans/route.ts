import { NextResponse, type NextRequest } from "next/server";
import { createScanInputSchema } from "@/lib/validations/scan";
import { checkScanRateLimit, checkDailySpendCap } from "@/lib/rate-limit";
import { createScan } from "@/lib/scans";
import { normalizeInputUrl } from "@/lib/crawler";
import { assertSafeUrl, UnsafeUrlError } from "@/lib/ssrf-guard";
import { inngest } from "@/inngest/client";

function getClientIp(request: NextRequest): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }
  return request.headers.get("x-real-ip");
}

/**
 * Starts a scan. Thin and synchronous on purpose (per
 * docs/05-api-architecture.md): validate, rate-limit, create the `scans`
 * row, hand off to Inngest, return immediately. The actual crawl + agent
 * work happens in inngest/functions/run-scan.ts, entirely decoupled from
 * this request/response cycle.
 */
export async function POST(request: NextRequest) {
  const ipAddress = getClientIp(request);

  // Both limits are checked at the queue boundary, before any scan row is
  // created and before anything is enqueued — a scan aborted mid-pipeline
  // has already spent most of its money (docs/19 §1).
  const rateLimit = await checkScanRateLimit(ipAddress);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error:
          rateLimit.reason ??
          `Too many scans from this address. Limit is ${rateLimit.limit} per hour.`,
      },
      { status: 429 },
    );
  }

  const spendCap = await checkDailySpendCap();
  if (!spendCap.allowed) {
    return NextResponse.json({ error: spendCap.reason }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = createScanInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const normalizedUrl = normalizeInputUrl(parsed.data.websiteUrl);

  // Fail fast on an obviously bad/unsafe URL rather than queuing a scan
  // that's doomed to fail in the background — the crawler re-validates
  // this anyway (URLs can change via redirect), so this is a fast-path
  // convenience, not the only line of defense.
  try {
    // Discards the validated addresses on purpose — this is only a
    // fast-fail check so we don't queue a doomed scan. The crawler
    // re-validates and pins its own connection later.
    await assertSafeUrl(normalizedUrl);
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const scan = await createScan({ websiteUrl: normalizedUrl, ipAddress });

  await inngest.send({
    name: "scan/requested",
    data: { scanId: scan.id, websiteUrl: normalizedUrl },
  });

  return NextResponse.json(
    { scanId: scan.id, reportToken: scan.reportToken },
    { status: 202 },
  );
}
