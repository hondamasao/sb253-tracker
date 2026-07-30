import "server-only";
import { fetch as undiciFetch, type Agent } from "undici";
import { assertSafeUrl, type SafeUrl, type UrlSafetyOptions } from "@/lib/ssrf-guard";
import { Deadline, DeadlineExceededError } from "@/lib/deadline";
import { createPinnedDispatcher } from "./pinned-dispatcher";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024; // 3 MB — see "avoid crawling too much"

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; GrowthOSBot/1.0; +https://growthos.app/bot)";

export class FetchFailedError extends Error {}

export type SafeFetchOptions = UrlSafetyOptions & {
  timeoutMs?: number;
  userAgent?: string;
  /**
   * Shared wall-clock budget for the whole crawl. Each request gets
   * `min(timeoutMs, deadline.remainingMs())`, so a slow site degrades the
   * crawl instead of extending it indefinitely.
   */
  deadline?: Deadline;
};

export type SafeFetchResult = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  redirected: boolean;
  headers: Record<string, string>;
  body: string;
};

/**
 * Fetches a URL the way anything crawling arbitrary user-submitted sites
 * must: a hard per-request timeout bounded by a whole-crawl deadline, a
 * response-size ceiling enforced while streaming, redirects followed one
 * hop at a time with the SSRF guard re-run against every hop, and — the
 * part that closes M1a's documented gap — **the connection pinned to the
 * exact IP the guard validated**, so the hostname is never resolved a
 * second time. See docs/19-m1c-security-and-evaluation.md §1 and
 * lib/crawler/pinned-dispatcher.ts.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const perRequestTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const { deadline } = options;

  let currentUrl = rawUrl;
  let redirected = false;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (deadline?.hasExpired()) {
      throw new DeadlineExceededError(
        `Crawl deadline exhausted before fetching ${currentUrl}.`,
      );
    }

    // Re-validated on EVERY hop, not just the first — a malicious site can
    // redirect to an internal address, and each hop is re-pinned to its
    // own validated IP.
    const validated = await assertSafeUrl(currentUrl, options);

    const timeoutMs = deadline
      ? deadline.boundedTimeoutMs(perRequestTimeoutMs)
      : perRequestTimeoutMs;

    const { response, dispatcher } = await fetchOnce(validated, {
      userAgent,
      timeoutMs,
    });

    try {
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new FetchFailedError(
            `Redirect (${response.status}) with no Location header from ${validated.url.toString()}.`,
          );
        }
        if (hop === MAX_REDIRECTS) {
          throw new FetchFailedError(
            `Too many redirects (>${MAX_REDIRECTS}) starting from ${rawUrl}.`,
          );
        }
        // Location may be relative — resolve against the current URL.
        currentUrl = new URL(location, validated.url).toString();
        redirected = true;
        continue;
      }

      const body = await readBodyWithLimit(response, validated.url.toString());

      return {
        requestedUrl: rawUrl,
        finalUrl: validated.url.toString(),
        status: response.status,
        redirected,
        headers: headersToRecord(response.headers),
        body,
      };
    } finally {
      // One dispatcher is built per hop (it is pinned to that hop's
      // validated IP), so it must be torn down per hop or the process
      // leaks sockets and keeps the event loop alive.
      await dispatcher?.close().catch(() => {});
    }
  }

  // Unreachable (the loop above always returns or throws), kept so
  // TypeScript knows every path returns a value.
  throw new FetchFailedError(`Too many redirects starting from ${rawUrl}.`);
}

type FetchResponse = Awaited<ReturnType<typeof undiciFetch>>;

async function fetchOnce(
  validated: SafeUrl,
  { userAgent, timeoutMs }: { userAgent: string; timeoutMs: number },
): Promise<{ response: FetchResponse; dispatcher: Agent | null }> {
  // An empty address list only happens on the `allowPrivateNetworks`
  // test path, where a fixture server on localhost may legitimately
  // resolve to several addresses. Production always pins.
  const dispatcher =
    validated.addresses.length > 0
      ? createPinnedDispatcher(validated.addresses)
      : null;

  try {
    const response = await undiciFetch(validated.url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": userAgent },
      ...(dispatcher ? { dispatcher } : {}),
    });
    return { response, dispatcher };
  } catch (error) {
    await dispatcher?.close().catch(() => {});
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new FetchFailedError(
        `Timed out after ${timeoutMs}ms fetching ${validated.url.toString()}.`,
      );
    }
    // Covers DNS failures, connection refused, and — importantly — TLS
    // handshake failures (invalid/expired certificate), which surface as
    // generic fetch errors rather than a distinct error type in undici.
    const message = error instanceof Error ? error.message : String(error);
    throw new FetchFailedError(
      `Failed to fetch ${validated.url.toString()}: ${message}`,
    );
  }
}

async function readBodyWithLimit(
  response: FetchResponse,
  url: string,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return response.text();
  }

  const decoder = new TextDecoder();
  let result = "";
  let totalBytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    // Enforced against bytes actually received, never against the
    // Content-Length header — a hostile server can simply lie in the
    // header while streaming an unbounded body.
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new FetchFailedError(
        `Response exceeded ${MAX_RESPONSE_BYTES} byte limit from ${url}.`,
      );
    }
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();

  return result;
}

function headersToRecord(headers: FetchResponse["headers"]): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}
