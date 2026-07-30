/**
 * A single wall-clock budget shared across every network call in one
 * crawl (docs/19-m1c-security-and-evaluation.md §1).
 *
 * Per-request timeouts alone are not a bound on total time: M1a capped
 * each fetch at 10s, but a crawl performs a homepage fetch, a possible
 * scheme-fallback retry, robots.txt, sitemap.xml, and up to four more
 * pages — so the real worst case was well over a minute of held
 * resources per scan. A Deadline converts that open-ended sum into one
 * number decided up front.
 */
export class Deadline {
  private readonly expiresAtMs: number;

  constructor(totalMs: number) {
    this.expiresAtMs = Date.now() + totalMs;
  }

  /** Milliseconds left, never negative. */
  remainingMs(): number {
    return Math.max(0, this.expiresAtMs - Date.now());
  }

  hasExpired(): boolean {
    return this.remainingMs() === 0;
  }

  /**
   * The timeout an individual request should use: whichever is sooner,
   * its own per-request limit or whatever remains of the whole crawl.
   */
  boundedTimeoutMs(perRequestMs: number): number {
    return Math.min(perRequestMs, this.remainingMs());
  }
}

export class DeadlineExceededError extends Error {}
