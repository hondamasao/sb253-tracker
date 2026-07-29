import { describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

import { lookup } from "node:dns/promises";
import { assertSafeUrl, UnsafeUrlError } from "@/lib/ssrf-guard";

describe("assertSafeUrl", () => {
  it("rejects non-http(s) protocols", async () => {
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects unparseable input", async () => {
    await expect(assertSafeUrl("not a url at all")).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects a literal loopback IPv4 address", async () => {
    await expect(assertSafeUrl("http://127.0.0.1/")).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects the AWS/GCP metadata link-local address", async () => {
    await expect(assertSafeUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it("rejects literal private IPv4 ranges (10/8, 172.16/12, 192.168/16)", async () => {
    await expect(assertSafeUrl("http://10.0.0.5/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("http://172.16.0.1/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("http://192.168.1.1/")).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects literal IPv6 loopback", async () => {
    await expect(assertSafeUrl("http://[::1]/")).rejects.toThrow(UnsafeUrlError);
  });

  it("allows a public-looking literal IPv4 address", async () => {
    const url = await assertSafeUrl("http://93.184.216.34/");
    expect(url.hostname).toBe("93.184.216.34");
  });

  it("rejects a hostname that resolves to a private address", async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }] as never);
    await expect(assertSafeUrl("http://sneaky.example/")).rejects.toThrow(UnsafeUrlError);
  });

  it("allows a hostname that resolves to a public address", async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never);
    const url = await assertSafeUrl("http://real-business.example/");
    expect(url.hostname).toBe("real-business.example");
  });

  it("fails closed when DNS resolution errors", async () => {
    vi.mocked(lookup).mockRejectedValueOnce(new Error("ENOTFOUND"));
    await expect(assertSafeUrl("http://does-not-exist.invalid/")).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it("bypasses the check only when allowPrivateNetworks is explicitly set (test-only escape hatch)", async () => {
    const url = await assertSafeUrl("http://127.0.0.1:4000/", {
      allowPrivateNetworks: true,
    });
    expect(url.hostname).toBe("127.0.0.1");
  });
});
