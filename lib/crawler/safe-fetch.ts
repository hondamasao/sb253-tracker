import "server-only";
import { assertSafeUrl, type UrlSafetyOptions } from "@/lib/ssrf-guard";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024; // 3 MB — see "avoid crawling too much"

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; GrowthOSBot/1.0; +https://growthos.app/bot)";

export class FetchFailedError extends Error {}

export type SafeFetchOptions = UrlSafetyOptions & {
  timeoutMs?: number;
  userAgent?: string;
};

export type SafeFetchResult = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  redirected: boolean;
  headers: Headers;
  body: string;
};

/**
 * Fetches a URL the way anything crawling arbitrary user-submitted sites
 * must: with a hard timeout, a response-size ceiling, and — the part a
 * naive `fetch(url, { redirect: "follow" })` would get wrong — redirects
 * followed one hop at a time, re-validating the SSRF guard against EVERY
 * hop's destination, not just the original URL. See
 * docs/17-m1-crawler-architecture.md §3 for why that distinction matters:
 * a malicious site can return a redirect to an internal address, and
 * auto-follow would happily chase it there.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  let currentUrl = rawUrl;
  let redirected = false;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const validated = await assertSafeUrl(currentUrl, options);

    const response = await fetchOnce(validated, { userAgent, timeoutMs });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new FetchFailedError(
          `Redirect (${response.status}) with no Location header from ${validated.toString()}.`,
        );
      }
      if (hop === MAX_REDIRECTS) {
        throw new FetchFailedError(
          `Too many redirects (>${MAX_REDIRECTS}) starting from ${rawUrl}.`,
        );
      }
      // Location may be relative — resolve against the current URL.
      currentUrl = new URL(location, validated).toString();
      redirected = true;
      continue;
    }

    const body = await readBodyWithLimit(response);

    return {
      requestedUrl: rawUrl,
      finalUrl: validated.toString(),
      status: response.status,
      redirected,
      headers: response.headers,
      body,
    };
  }

  // Unreachable (the loop above always returns or throws), kept so
  // TypeScript knows every path returns a value.
  throw new FetchFailedError(`Too many redirects starting from ${rawUrl}.`);
}

async function fetchOnce(
  url: URL,
  { userAgent, timeoutMs }: { userAgent: string; timeoutMs: number },
): Promise<Response> {
  try {
    return await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": userAgent },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new FetchFailedError(
        `Timed out after ${timeoutMs}ms fetching ${url.toString()}.`,
      );
    }
    // Covers DNS failures, connection refused, and — importantly — TLS
    // handshake failures (invalid/expired certificate), which surface as
    // generic fetch errors rather than a distinct error type in undici.
    const message = error instanceof Error ? error.message : String(error);
    throw new FetchFailedError(
      `Failed to fetch ${url.toString()}: ${message}`,
    );
  }
}

async function readBodyWithLimit(response: Response): Promise<string> {
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
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new FetchFailedError(
        `Response exceeded ${MAX_RESPONSE_BYTES} byte limit from ${response.url}.`,
      );
    }
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();

  return result;
}
