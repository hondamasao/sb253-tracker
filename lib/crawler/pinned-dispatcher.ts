import "server-only";
import { Agent } from "undici";
import type { ValidatedAddress } from "@/lib/ssrf-guard";

/**
 * Builds an undici dispatcher whose DNS resolution is replaced by a fixed
 * answer: the exact addresses `assertSafeUrl` already validated.
 *
 * This is the DNS-rebinding fix, and it works by *removing* a step rather
 * than adding one. The vulnerability in M1a was structural: the guard
 * resolved a hostname and approved the resulting IPs, then `fetch()`
 * resolved the same hostname again independently. An attacker serving a
 * 1-second TTL could return a public IP to the guard's query and
 * 127.0.0.1 to the connection's query — no amount of extra checking in
 * the guard can close that, because the guard never sees the second
 * answer. Pinning deletes the second query entirely, so the address we
 * approved and the address we connect to are the same value by
 * construction.
 *
 * Note the shape undici expects: it calls `lookup` with `options.all =
 * true` and wants an array of `{ address, family }`, not the plain
 * `(err, address, family)` form. Getting this wrong fails with a confusing
 * "Invalid IP address: undefined", so both shapes are handled.
 */
export function createPinnedDispatcher(addresses: ValidatedAddress[]): Agent {
  if (addresses.length === 0) {
    throw new Error(
      "createPinnedDispatcher requires at least one validated address — refusing to build a dispatcher that would fall back to real DNS.",
    );
  }

  const pinned = addresses.map(({ address, family }) => ({ address, family }));
  const [first] = pinned as [{ address: string; family: 4 | 6 }];

  return new Agent({
    connect: {
      lookup: ((
        _hostname: string,
        options: { all?: boolean } | undefined,
        callback: (
          err: Error | null,
          address: string | Array<{ address: string; family: number }>,
          family?: number,
        ) => void,
      ) => {
        if (options?.all) {
          callback(null, pinned);
          return;
        }
        callback(null, first.address, first.family);
      }) as unknown as undefined,
    },
  });
}
