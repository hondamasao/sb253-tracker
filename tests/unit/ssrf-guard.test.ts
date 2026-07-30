import { describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

import { lookup } from "node:dns/promises";
import { assertSafeUrl, UnsafeUrlError } from "@/lib/ssrf-guard";

describe("assertSafeUrl — scheme and parsing", () => {
  it("rejects non-http(s) protocols", async () => {
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("gopher://example.com/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("ftp://example.com/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("data:text/html,hi")).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects unparseable input", async () => {
    await expect(assertSafeUrl("not a url at all")).rejects.toThrow(UnsafeUrlError);
  });
});

describe("assertSafeUrl — literal IP addresses", () => {
  it("rejects a literal loopback IPv4 address", async () => {
    await expect(assertSafeUrl("http://127.0.0.1/")).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects the AWS/GCP metadata link-local address", async () => {
    await expect(assertSafeUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it("rejects literal private IPv4 ranges (10/8, 172.16/12, 192.168/16, 100.64/10, 0/8)", async () => {
    await expect(assertSafeUrl("http://10.0.0.5/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("http://172.16.0.1/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("http://192.168.1.1/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("http://100.64.0.1/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("http://0.0.0.0/")).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects literal IPv6 loopback, link-local, ULA, and mapped-v4 loopback", async () => {
    await expect(assertSafeUrl("http://[::1]/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("http://[fe80::1]/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("http://[fd00::1]/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("http://[::ffff:127.0.0.1]/")).rejects.toThrow(UnsafeUrlError);
  });

  it("allows a public literal IPv4 address and returns it as the pinned address", async () => {
    const safe = await assertSafeUrl("http://93.184.216.34/");
    expect(safe.url.hostname).toBe("93.184.216.34");
    expect(safe.addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });
});

describe("assertSafeUrl — internal hostnames (rejected before any DNS lookup)", () => {
  it("rejects mDNS .local and other internal-only suffixes", async () => {
    for (const host of [
      "http://printer.local/",
      "http://api.internal/",
      "http://box.home.arpa/",
      "http://nas.lan/",
      "http://wiki.intranet/",
      "http://git.corp/",
      "http://vault.private/",
      "http://foo.localhost/",
    ]) {
      await expect(assertSafeUrl(host)).rejects.toThrow(UnsafeUrlError);
    }
  });

  it("rejects bare 'localhost' and single-label intranet hostnames", async () => {
    await expect(assertSafeUrl("http://localhost:3000/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("http://intranet/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("http://buildserver/")).rejects.toThrow(UnsafeUrlError);
  });

  it("never consults DNS for a denylisted hostname", async () => {
    vi.mocked(lookup).mockClear();
    await expect(assertSafeUrl("http://printer.local/")).rejects.toThrow(UnsafeUrlError);
    expect(vi.mocked(lookup)).not.toHaveBeenCalled();
  });
});

describe("assertSafeUrl — DNS resolution", () => {
  it("rejects a hostname that resolves to a private address", async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }] as never);
    await expect(assertSafeUrl("http://sneaky.example/")).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects if ANY resolved address is private, even when others are public", async () => {
    vi.mocked(lookup).mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ] as never);
    await expect(assertSafeUrl("http://mixed.example/")).rejects.toThrow(UnsafeUrlError);
  });

  it("allows a public hostname and returns every resolved address for pinning", async () => {
    vi.mocked(lookup).mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "93.184.216.35", family: 4 },
    ] as never);
    const safe = await assertSafeUrl("http://real-business.example/");
    expect(safe.url.hostname).toBe("real-business.example");
    expect(safe.addresses).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "93.184.216.35", family: 4 },
    ]);
  });

  it("fails closed when DNS resolution errors", async () => {
    vi.mocked(lookup).mockRejectedValueOnce(new Error("ENOTFOUND"));
    await expect(assertSafeUrl("http://does-not-exist.invalid/")).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it("fails closed when DNS returns an empty answer", async () => {
    vi.mocked(lookup).mockResolvedValueOnce([] as never);
    await expect(assertSafeUrl("http://empty.example/")).rejects.toThrow(UnsafeUrlError);
  });

  it("uses an injected resolver when provided, leaving the system resolver untouched", async () => {
    vi.mocked(lookup).mockClear();
    const safe = await assertSafeUrl("http://injected.example/", {
      lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    expect(safe.addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
    expect(vi.mocked(lookup)).not.toHaveBeenCalled();
  });
});

describe("assertSafeUrl — test-only escape hatch", () => {
  it("bypasses the check only when allowPrivateNetworks is explicitly set", async () => {
    const safe = await assertSafeUrl("http://127.0.0.1:4000/", {
      allowPrivateNetworks: true,
    });
    expect(safe.url.hostname).toBe("127.0.0.1");
  });

  it("still pins to a literal IP on the escape hatch, so tests observe the real destination", async () => {
    const safe = await assertSafeUrl("http://127.0.0.1:4000/", {
      allowPrivateNetworks: true,
    });
    expect(safe.addresses).toEqual([{ address: "127.0.0.1", family: 4 }]);
  });

  it("returns an empty address list ('do not pin') for a hostname with no injected resolver", async () => {
    // A fixture reached via `localhost` may resolve to both 127.0.0.1 and
    // ::1; picking one arbitrarily would make tests flaky, so pinning is
    // skipped unless the caller supplied an explicit resolver.
    const safe = await assertSafeUrl("http://localhost:4000/", {
      allowPrivateNetworks: true,
    });
    expect(safe.addresses).toEqual([]);
  });
});
