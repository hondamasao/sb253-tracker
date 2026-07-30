import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { safeFetch, FetchFailedError } from "@/lib/crawler/safe-fetch";
import { crawlSite, RobotsDisallowedError } from "@/lib/crawler/crawl-site";
import { UnsafeUrlError } from "@/lib/ssrf-guard";
import { Deadline, DeadlineExceededError } from "@/lib/deadline";

/**
 * Proves each abuse control actually *blocks*, against real HTTP servers
 * rather than mocks (docs/19-m1c-security-and-evaluation.md §1). The two
 * load-bearing tests here are:
 *
 *  - the rebinding pair, which proves the crawler pins its socket to the
 *    validated IP rather than merely checking DNS and hoping; and
 *  - the robots test, which asserts the fixture server *received no
 *    request at all* for the homepage — the only way to show we honoured
 *    the disallow, rather than fetching it and reporting on it afterwards.
 *
 * `allowPrivateNetworks: true` is the documented test-only escape hatch
 * for reaching a fixture server on loopback; production paths never set it.
 */

type Recorded = { paths: string[] };

type Route = {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  /** Overrides body/status for streaming or delayed responses. */
  handler?: (res: http.ServerResponse) => void;
};

function startServer(
  routes: Record<string, Route>,
): Promise<{ origin: string; port: number; recorded: Recorded; close: () => Promise<void> }> {
  const recorded: Recorded = { paths: [] };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    recorded.paths.push(url.pathname);

    const route = routes[url.pathname];
    if (!route) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    if (route.handler) {
      route.handler(res);
      return;
    }
    res.writeHead(route.status ?? 200, {
      "Content-Type": "text/html",
      ...route.headers,
    });
    res.end(route.body ?? "");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        port,
        recorded,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

let active: { close: () => Promise<void> } | null = null;
afterEach(async () => {
  await active?.close();
  active = null;
});

describe("DNS rebinding — the connection is pinned, not merely checked", () => {
  it("CONTROL: the fixture server is genuinely reachable via the hostname 'localhost'", async () => {
    const server = await startServer({ "/": { body: "<html>reachable</html>" } });
    active = server;

    // No injected resolver -> no pinning -> the OS resolves `localhost`
    // to 127.0.0.1 and the request lands. This control exists so the
    // zero-request assertion in the next test is meaningful rather than
    // vacuously true.
    const result = await safeFetch(`http://localhost:${server.port}/`, {
      allowPrivateNetworks: true,
      timeoutMs: 3_000,
    });

    expect(result.status).toBe(200);
    expect(server.recorded.paths).toEqual(["/"]);
  });

  it("BLOCKS the rebind: a host whose DNS points at loopback is never contacted there, because the socket is pinned to the address that was validated", async () => {
    const server = await startServer({ "/": { body: "<html>should never be served</html>" } });
    active = server;

    // Simulates the attacker's first DNS answer: a public address, which
    // passes validation. The attacker's *second* answer would be
    // 127.0.0.1 — and `localhost` really does resolve there, as the
    // control test above proved. Pinning means no second resolution
    // happens at all, so the socket goes to 192.0.2.1 (TEST-NET-1,
    // unroutable) and the loopback server is never touched.
    await expect(
      safeFetch(`http://localhost:${server.port}/`, {
        allowPrivateNetworks: true,
        timeoutMs: 2_000,
        lookupFn: async () => [{ address: "192.0.2.1", family: 4 }],
      }),
    ).rejects.toThrow(FetchFailedError);

    expect(server.recorded.paths).toEqual([]);
  });

  it("proves the pinned address (not DNS) chooses the destination: an unresolvable hostname still connects", async () => {
    const server = await startServer({ "/": { body: "<html>pinned</html>" } });
    active = server;

    // `.invalid` is guaranteed never to resolve (RFC 6761). The request
    // can only succeed if the socket used the pinned address.
    const result = await safeFetch(`http://pinned-target.invalid:${server.port}/`, {
      allowPrivateNetworks: true,
      timeoutMs: 3_000,
      lookupFn: async () => [{ address: "127.0.0.1", family: 4 }],
    });

    expect(result.status).toBe(200);
    expect(result.body).toContain("pinned");
    expect(server.recorded.paths).toEqual(["/"]);
  });
});

describe("robots.txt is honoured before the homepage is requested", () => {
  it("BLOCKS the crawl and the server receives NO request for the homepage", async () => {
    const server = await startServer({
      "/robots.txt": {
        headers: { "Content-Type": "text/plain" },
        body: "User-agent: GrowthOSBot\nDisallow: /\n",
      },
      "/": { body: "<html><body>should never be fetched</body></html>" },
    });
    active = server;

    await expect(
      crawlSite(server.origin, { allowPrivateNetworks: true }),
    ).rejects.toThrow(RobotsDisallowedError);

    // The whole point: robots.txt was read, the homepage never was.
    expect(server.recorded.paths).toEqual(["/robots.txt"]);
    expect(server.recorded.paths).not.toContain("/");
  });

  it("allows the crawl when robots.txt permits it, fetching robots first", async () => {
    const server = await startServer({
      "/robots.txt": {
        headers: { "Content-Type": "text/plain" },
        body: "User-agent: *\nAllow: /\n",
      },
      "/": { body: "<html><head><title>Allowed</title></head><body><h1>Hi</h1></body></html>" },
    });
    active = server;

    const result = await crawlSite(server.origin, { allowPrivateNetworks: true });

    expect(result.homepage.status).toBe(200);
    expect(server.recorded.paths[0]).toBe("/robots.txt");
    expect(server.recorded.paths).toContain("/");
  });
});

describe("redirects are re-validated on every hop", () => {
  it("BLOCKS a redirect that pivots to a non-http(s) scheme", async () => {
    const server = await startServer({
      "/start": { status: 302, headers: { Location: "file:///etc/passwd" } },
    });
    active = server;

    await expect(
      safeFetch(`${server.origin}/start`, { allowPrivateNetworks: true, timeoutMs: 3_000 }),
    ).rejects.toThrow(UnsafeUrlError);
  });

  it("BLOCKS a redirect chain longer than the hop limit", async () => {
    const routes: Record<string, Route> = {};
    for (let i = 0; i < 10; i++) {
      routes[`/hop${i}`] = { status: 302, headers: { Location: `/hop${i + 1}` } };
    }
    const server = await startServer(routes);
    active = server;

    await expect(
      safeFetch(`${server.origin}/hop0`, { allowPrivateNetworks: true, timeoutMs: 3_000 }),
    ).rejects.toThrow(/Too many redirects/);
  });
});

describe("response size ceiling", () => {
  const oneMb = "x".repeat(1024 * 1024);

  it("BLOCKS an unbounded chunked response with no Content-Length at all", async () => {
    // This is the real attack shape. A server that simply omits
    // Content-Length and streams forever cannot be defended against by
    // inspecting headers — only by counting bytes as they arrive, which
    // is why the limit is enforced inside the read loop.
    const server = await startServer({
      "/endless": {
        handler: (res) => {
          res.on("error", () => {}); // client aborts mid-stream; expected
          res.writeHead(200, { "Content-Type": "text/html" }); // chunked
          let written = 0;
          const pump = () => {
            while (written < 8) {
              written++;
              if (!res.write(oneMb)) {
                res.once("drain", pump);
                return;
              }
            }
            res.end();
          };
          pump();
        },
      },
    });
    active = server;

    await expect(
      safeFetch(`${server.origin}/endless`, { allowPrivateNetworks: true, timeoutMs: 8_000 }),
    ).rejects.toThrow(/exceeded .* byte limit/);
  });

  it("is not fooled into over-reading by a Content-Length that understates the body", async () => {
    // Complementary case: a header that lies *short*. undici stops at the
    // declared length, so we receive exactly what was declared and never
    // read the extra megabytes. Safe by a different mechanism than the
    // byte counter, and worth pinning down so a future client swap that
    // changed this behaviour would surface here.
    const server = await startServer({
      "/liar": {
        handler: (res) => {
          res.on("error", () => {});
          res.writeHead(200, { "Content-Type": "text/html", "Content-Length": "100" });
          for (let i = 0; i < 5; i++) res.write(oneMb);
          res.end();
        },
      },
    });
    active = server;

    const result = await safeFetch(`${server.origin}/liar`, {
      allowPrivateNetworks: true,
      timeoutMs: 8_000,
    });
    expect(result.body.length).toBe(100);
  });
});

describe("wall-clock deadline", () => {
  it("BLOCKS a request once the shared crawl budget is spent", async () => {
    const server = await startServer({ "/": { body: "<html>ok</html>" } });
    active = server;

    const spent = new Deadline(0);
    await expect(
      safeFetch(`${server.origin}/`, { allowPrivateNetworks: true, deadline: spent }),
    ).rejects.toThrow(DeadlineExceededError);

    expect(server.recorded.paths).toEqual([]);
  });

  it("bounds a single slow request by whatever remains of the crawl budget", async () => {
    const server = await startServer({
      "/slow": {
        handler: (res) => {
          // Never responds — only the deadline can end this.
          res.writeHead(200, { "Content-Type": "text/html" });
        },
      },
    });
    active = server;

    const deadline = new Deadline(600);
    const startedAt = Date.now();
    await expect(
      safeFetch(`${server.origin}/slow`, {
        allowPrivateNetworks: true,
        timeoutMs: 30_000, // would hang far past the deadline on its own
        deadline,
      }),
    ).rejects.toThrow(FetchFailedError);

    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });
});
