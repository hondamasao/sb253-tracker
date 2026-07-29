import "server-only";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

/**
 * Thrown whenever a URL fails the safety check — callers should treat this
 * the same as any other "this page can't be crawled" failure (see
 * docs/17-m1-crawler-architecture.md §3), not a crash.
 */
export class UnsafeUrlError extends Error {}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true; // malformed — fail closed
  }
  const [a, b, c] = parts as [number, number, number, number];

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (includes 169.254.169.254 cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 carrier-grade NAT
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, 255.255.255.255 broadcast
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true; // loopback / unspecified

  const mappedV4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedV4) return isPrivateIPv4(mappedV4[1] as string);

  const firstGroup = parseInt(normalized.split(":")[0] || "", 16);
  if (!Number.isNaN(firstGroup)) {
    if (firstGroup >= 0xfe80 && firstGroup <= 0xfebf) return true; // fe80::/10 link-local
    if (firstGroup >= 0xfc00 && firstGroup <= 0xfdff) return true; // fc00::/7 unique local
  }
  return false;
}

export type UrlSafetyOptions = {
  /**
   * Skips the private-network check entirely. Set to `true` ONLY from test
   * code exercising a local fixture server (see tests/integration) — never
   * from a real request path. There is no environment-variable-based
   * bypass on purpose: an env var can be misconfigured in production, an
   * explicit call-site argument can't be accidentally left on.
   */
  allowPrivateNetworks?: boolean;
};

/**
 * Validates that a URL is safe for our server to fetch: http(s) only, and
 * not pointed at a loopback/private/link-local address (which would let a
 * malicious input reach our own internal network or a cloud metadata
 * endpoint — a classic SSRF attack, and a real risk for any feature whose
 * entire job is "fetch a URL a stranger typed in").
 *
 * Known limitation, accepted for the MVP: this checks DNS at call time,
 * not at actual connection time, so it does not fully defend against DNS
 * rebinding (a hostname resolving safely now and to a private IP a moment
 * later). Closing that gap needs a connection-pinning fetch dispatcher —
 * real added complexity that isn't justified before this product has
 * real traffic. Revisit if that changes.
 */
export async function assertSafeUrl(
  rawUrl: string,
  options: UrlSafetyOptions = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError(`"${rawUrl}" is not a valid URL.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(
      `Only http/https URLs are allowed, got "${url.protocol}".`,
    );
  }

  if (options.allowPrivateNetworks) {
    return url;
  }

  const hostname = url.hostname;
  // URL.hostname keeps surrounding brackets for IPv6 literals (e.g.
  // "[::1]"), but net.isIP() doesn't recognize the bracketed form — strip
  // them before checking, or a bracketed IPv6 literal falls through to
  // the "treat as a DNS hostname" branch below instead of being checked
  // directly.
  const unbracketedHostname =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  const literalIpVersion = isIP(unbracketedHostname);

  if (literalIpVersion === 4 && isPrivateIPv4(unbracketedHostname)) {
    throw new UnsafeUrlError(
      `"${hostname}" is a private/internal address and cannot be crawled.`,
    );
  }
  if (literalIpVersion === 6 && isPrivateIPv6(unbracketedHostname)) {
    throw new UnsafeUrlError(
      `"${hostname}" is a private/internal address and cannot be crawled.`,
    );
  }

  if (literalIpVersion === 0) {
    // Not a literal IP — it's a hostname. Resolve it and check every
    // address it points to (a hostname can resolve to multiple IPs).
    let addresses: Array<{ address: string; family: number }>;
    try {
      addresses = await lookup(hostname, { all: true });
    } catch {
      throw new UnsafeUrlError(`Could not resolve hostname "${hostname}".`);
    }

    for (const { address, family } of addresses) {
      if (family === 4 && isPrivateIPv4(address)) {
        throw new UnsafeUrlError(
          `"${hostname}" resolves to a private/internal address (${address}) and cannot be crawled.`,
        );
      }
      if (family === 6 && isPrivateIPv6(address)) {
        throw new UnsafeUrlError(
          `"${hostname}" resolves to a private/internal address (${address}) and cannot be crawled.`,
        );
      }
    }
  }

  return url;
}
