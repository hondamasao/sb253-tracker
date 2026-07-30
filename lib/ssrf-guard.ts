import "server-only";
import { isIP } from "node:net";
import { lookup as systemLookup } from "node:dns/promises";

/**
 * Thrown whenever a URL fails the safety check — callers should treat this
 * the same as any other "this page can't be crawled" failure (see
 * docs/17-m1-crawler-architecture.md §3), not a crash.
 */
export class UnsafeUrlError extends Error {}

export type ValidatedAddress = { address: string; family: 4 | 6 };

/**
 * The result of a successful safety check: the parsed URL plus **every IP
 * address we resolved and validated for it**.
 *
 * Returning the addresses is the whole point (see
 * docs/19-m1c-security-and-evaluation.md §1): the caller must connect to
 * one of *these* addresses rather than resolving the hostname a second
 * time. A second resolution is what makes DNS rebinding possible, so the
 * fix is to never perform one — not to check harder.
 *
 * `addresses` is empty only on the `allowPrivateNetworks` test path, which
 * means "don't pin, this is a local fixture server."
 */
export type SafeUrl = { url: URL; addresses: ValidatedAddress[] };

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

/**
 * Expands any IPv6 textual form into its eight 16-bit groups, including
 * `::` compression and a trailing dotted-quad (`::ffff:127.0.0.1`).
 * Returns null if the input isn't parseable as IPv6.
 *
 * This exists because string matching on IPv6 is not safe. `new URL()`
 * re-serializes `[::ffff:127.0.0.1]` to its hex form `::ffff:7f00:1`, so
 * a regex looking for the dotted-decimal spelling never fires and a
 * loopback address sails through the guard. That was a live bypass in
 * M1a, caught by the M1c test suite. Numeric expansion has no such
 * spelling dependency.
 */
function expandIPv6Groups(ip: string): number[] | null {
  const lower = ip.toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(lower)) return null;

  let head = lower;
  let embeddedV4Groups: number[] = [];

  const dotted = lower.match(/^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (dotted) {
    head = dotted[1] as string;
    const octets = (dotted[2] as string).split(".").map(Number);
    if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return null;
    embeddedV4Groups = [
      ((octets[0] as number) << 8) | (octets[1] as number),
      ((octets[2] as number) << 8) | (octets[3] as number),
    ];
  }

  const halves = head.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (segment: string): number[] =>
    segment
      .split(":")
      .filter((part) => part !== "")
      .map((part) => parseInt(part, 16));

  const left = parseGroups(halves[0] ?? "");
  const right = halves.length === 2 ? parseGroups(halves[1] ?? "") : [];
  const groups = [...left, ...right, ...embeddedV4Groups];
  if (groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null;

  if (halves.length === 2) {
    const fill = 8 - groups.length;
    if (fill < 0) return null;
    return [...left, ...Array<number>(fill).fill(0), ...right, ...embeddedV4Groups];
  }

  return groups.length === 8 ? groups : null;
}

function isPrivateIPv6(ip: string): boolean {
  const groups = expandIPv6Groups(ip);
  if (!groups) return true; // unparseable — fail closed

  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number, number, number, number, number, number, number, number,
  ];

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d, which also
  // covers :: and ::1) carry a v4 address in the low 32 bits — judge them
  // by the embedded v4 address, not by the v6 prefix.
  const topFiveAreZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (topFiveAreZero && (g5 === 0xffff || g5 === 0)) {
    const embedded = `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
    return isPrivateIPv4(embedded);
  }

  if (g0 >= 0xfe80 && g0 <= 0xfebf) return true; // fe80::/10 link-local
  if (g0 >= 0xfc00 && g0 <= 0xfdff) return true; // fc00::/7 unique local
  return false;
}

/**
 * Hostnames that resolve to internal infrastructure by convention rather
 * than by IP range, so an IP-range check alone never catches them. These
 * are rejected **before** any DNS lookup: mDNS (`.local`) resolution in
 * particular can behave unpredictably and shouldn't be attempted at all,
 * and a bare single-label name (`intranet`, no dot) resolves via the
 * host's DNS search domains straight onto the private network.
 *
 * No public website can have one of these names, so there is no
 * legitimate-traffic cost to failing closed here.
 */
const BLOCKED_HOSTNAMES = new Set(["localhost"]);
const BLOCKED_HOSTNAME_SUFFIXES = [
  ".local", // mDNS / Bonjour
  ".localhost",
  ".internal", // common cloud-internal convention (incl. GCP)
  ".home.arpa", // RFC 8375 home networks
  ".lan",
  ".intranet",
  ".corp",
  ".private",
];

/** Injectable so tests can simulate hostile DNS. Mirrors dns/promises lookup. */
export type LookupFn = (
  hostname: string,
  options: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

export type UrlSafetyOptions = {
  /**
   * Skips the private-network check entirely. Set to `true` ONLY from test
   * code exercising a local fixture server (see tests/integration) — never
   * from a real request path. There is no environment-variable-based
   * bypass on purpose: an env var can be misconfigured in production, an
   * explicit call-site argument can't be accidentally left on.
   */
  allowPrivateNetworks?: boolean;
  /**
   * Test-only DNS injection, used to prove the rebinding defence works
   * (a resolver that answers differently on each call). Production code
   * never passes this and gets the real system resolver.
   */
  lookupFn?: LookupFn;
};

/**
 * Validates that a URL is safe for our server to fetch: http(s) only, not
 * an internal-by-convention hostname, and not pointed at a
 * loopback/private/link-local address (which would let a malicious input
 * reach our own internal network or a cloud metadata endpoint — a classic
 * SSRF attack, and a real risk for any feature whose entire job is "fetch
 * a URL a stranger typed in").
 *
 * Returns the addresses it validated so the caller can pin its connection
 * to them. Callers MUST use those addresses rather than letting the HTTP
 * client resolve the hostname again — see `SafeUrl` above and
 * lib/crawler/pinned-dispatcher.ts. This closes the DNS-rebinding hole
 * that M1a explicitly deferred.
 */
export async function assertSafeUrl(
  rawUrl: string,
  options: UrlSafetyOptions = {},
): Promise<SafeUrl> {
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

  if (options.allowPrivateNetworks) {
    // Test-only path: the private-range check is skipped, but pinning is
    // still honoured whenever we have a concrete address, because the
    // rebinding tests need to observe *which address the socket actually
    // used* — a bypass that also disabled pinning could not prove the
    // defence works. With no literal IP and no injected resolver, an
    // empty list means "don't pin" (a fixture reached via `localhost`
    // may legitimately resolve to both 127.0.0.1 and ::1).
    if (literalIpVersion !== 0) {
      return {
        url,
        addresses: [
          { address: unbracketedHostname, family: literalIpVersion === 6 ? 6 : 4 },
        ],
      };
    }
    if (options.lookupFn) {
      const resolved = await options.lookupFn(hostname, { all: true });
      return {
        url,
        addresses: resolved.map(({ address, family }) => ({
          address,
          family: family === 6 ? (6 as const) : (4 as const),
        })),
      };
    }
    return { url, addresses: [] };
  }

  if (literalIpVersion === 0) {
    assertHostnameNotInternal(unbracketedHostname);
  }

  if (literalIpVersion === 4) {
    if (isPrivateIPv4(unbracketedHostname)) {
      throw new UnsafeUrlError(
        `"${hostname}" is a private/internal address and cannot be crawled.`,
      );
    }
    return { url, addresses: [{ address: unbracketedHostname, family: 4 }] };
  }

  if (literalIpVersion === 6) {
    if (isPrivateIPv6(unbracketedHostname)) {
      throw new UnsafeUrlError(
        `"${hostname}" is a private/internal address and cannot be crawled.`,
      );
    }
    return { url, addresses: [{ address: unbracketedHostname, family: 6 }] };
  }

  // Not a literal IP — it's a hostname. Resolve it once and check every
  // address it points to (a hostname can resolve to multiple IPs).
  const resolve: LookupFn =
    options.lookupFn ?? ((host, opts) => systemLookup(host, opts));

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolve(hostname, { all: true });
  } catch {
    throw new UnsafeUrlError(`Could not resolve hostname "${hostname}".`);
  }

  if (addresses.length === 0) {
    throw new UnsafeUrlError(`Could not resolve hostname "${hostname}".`);
  }

  const validated: ValidatedAddress[] = [];
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
    validated.push({ address, family: family === 6 ? 6 : 4 });
  }

  return { url, addresses: validated };
}

function assertHostnameNotInternal(hostname: string): void {
  const lower = hostname.toLowerCase().replace(/\.$/, ""); // strip FQDN root dot

  if (BLOCKED_HOSTNAMES.has(lower)) {
    throw new UnsafeUrlError(
      `"${hostname}" is an internal hostname and cannot be crawled.`,
    );
  }

  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      throw new UnsafeUrlError(
        `"${hostname}" uses the internal-only suffix "${suffix}" and cannot be crawled.`,
      );
    }
  }

  if (!lower.includes(".")) {
    throw new UnsafeUrlError(
      `"${hostname}" is a single-label hostname, which resolves onto the local network, and cannot be crawled.`,
    );
  }
}
