import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { crawlSite } from "@/lib/crawler";
import { parsePage } from "@/lib/parsing/parse-page";
import { detectTechnicalIssues } from "@/lib/parsing/technical-issues";

/**
 * Real HTTP servers (Node's built-in `http`), not mocks — the whole point
 * is to exercise genuine fetch/redirect/timeout/parsing behavior, not
 * assert against a stub. This substitutes for "3 real websites" because
 * this sandboxed session's network egress is allowlist-based and blocks
 * arbitrary external hosts (confirmed while planning this milestone — see
 * the M1 summary) — localhost is reachable, arbitrary internet domains
 * are not. `allowPrivateNetworks: true` is the test-only escape hatch
 * lib/ssrf-guard.ts exists specifically for; production code never sets it.
 */
type Route = { status?: number; headers?: Record<string, string>; body?: string };

function startFixtureServer(
  buildRoutes: (origin: string) => Record<string, Route>,
): Promise<{ origin: string; close: () => Promise<void> }> {
  let routes: Record<string, Route> = {};

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = routes[url.pathname];
    if (!route) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
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
      const origin = `http://127.0.0.1:${port}`;
      routes = buildRoutes(origin);
      resolve({
        origin,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

let activeServer: { close: () => Promise<void> } | null = null;
afterEach(async () => {
  await activeServer?.close();
  activeServer = null;
});

describe("crawlSite against a clean, well-built site (Acme Plumbing)", () => {
  it("crawls the homepage and discovers contact/about/services via the sitemap", async () => {
    const server = await startFixtureServer((origin) => ({
      "/": {
        body: `<html><head>
          <title>Acme Plumbing — 24/7 Emergency Plumber in Springfield</title>
          <meta name="description" content="Licensed, bonded, and insured plumbers serving Springfield since 1998.">
          <link rel="canonical" href="${origin}/">
          <script type="application/ld+json">{"@type":"LocalBusiness","name":"Acme Plumbing","telephone":"555-123-4567"}</script>
        </head><body>
          <h1>Acme Plumbing</h1>
          <nav>
            <a href="/contact">Contact Us</a>
            <a href="/about">About</a>
            <a href="/services">Our Services</a>
          </nav>
          <img src="/hero.jpg" alt="Plumber fixing a kitchen sink">
        </body></html>`,
      },
      "/contact": {
        body: `<html><head><title>Contact Acme Plumbing</title><meta name="description" content="Call us 24/7 for emergency plumbing service in Springfield."><link rel="canonical" href="${origin}/contact"></head><body><h1>Contact Us</h1></body></html>`,
      },
      "/about": {
        body: `<html><head><title>About Acme Plumbing</title><meta name="description" content="Family-owned plumbing company serving Springfield for 25 years."><link rel="canonical" href="${origin}/about"></head><body><h1>About Us</h1></body></html>`,
      },
      "/services": {
        body: `<html><head><title>Plumbing Services</title><meta name="description" content="Drain cleaning, water heater repair, and leak detection."><link rel="canonical" href="${origin}/services"></head><body><h1>Our Services</h1></body></html>`,
      },
      "/robots.txt": {
        headers: { "Content-Type": "text/plain" },
        body: `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml`,
      },
      "/sitemap.xml": {
        headers: { "Content-Type": "application/xml" },
        body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url><url><loc>${origin}/contact</loc></url><url><loc>${origin}/about</loc></url><url><loc>${origin}/services</loc></url></urlset>`,
      },
    }));
    activeServer = server;

    // Bare host:port, no scheme — the common real-world input, and it
    // exercises the http/https scheme-fallback path: our https:// attempt
    // fails against this plain-http fixture server, and crawlSite falls
    // back to http:// automatically.
    const result = await crawlSite(server.origin.replace("http://", ""), {
      allowPrivateNetworks: true,
    });

    expect(result.homepage.status).toBe(200);
    expect(result.ssl.requestedHttps).toBe(true);
    expect(result.ssl.finalUrlIsHttps).toBe(false);
    expect(result.ssl.error).toBeTruthy(); // records why the https attempt failed

    const discoveredPaths = result.additionalPages
      .map((p) => new URL(p.finalUrl).pathname)
      .sort();
    expect(discoveredPaths).toEqual(["/about", "/contact", "/services"]);
    expect(result.failedPages).toEqual([]);

    expect(result.robots.fetched).toBe(true);
    expect(result.robots.homepageAllowed).toBe(true);
    expect(result.sitemap.fetched).toBe(true);
    expect(result.sitemap.urls).toHaveLength(4);

    // Feed the crawl through the same parsing + issue-detection the
    // site_signals agent uses, and confirm a well-built site comes back clean.
    const parsedPages = [result.homepage, ...result.additionalPages].map((p) =>
      parsePage(p.html, p.finalUrl),
    );
    const issues = detectTechnicalIssues({
      pages: parsedPages,
      robots: result.robots,
      sitemap: result.sitemap,
      ssl: result.ssl,
    });
    // The only "issue" a clean site can't avoid in this fixture is
    // ssl_missing, since the fixture server can't serve real HTTPS locally.
    expect(issues.map((i) => i.type)).toEqual(["ssl_missing"]);

    const homepageStructuredData = parsedPages[0]!.structuredData;
    expect(homepageStructuredData.jsonLdTypes).toContain("LocalBusiness");
  });
});

describe("crawlSite against a messy site with real-world quirks (Msg HVAC)", () => {
  it("follows a redirect, flags on-page issues, and detects duplicate titles", async () => {
    const server = await startFixtureServer((origin) => ({
      "/": {
        body: `<html><head><title>HVAC Services</title></head><body>
          <h1>Welcome</h1><h1>HVAC Services</h1>
          <nav>
            <a href="/about-us">About Us</a>
            <a href="/old-contact">Contact</a>
          </nav>
          <img src="/truck.jpg">
        </body></html>`,
      },
      "/about-us": {
        body: `<html><head><title>HVAC Services</title><meta name="description" content="We install and repair heating and cooling systems."></head><body><h1>About Us</h1></body></html>`,
      },
      "/old-contact": {
        status: 301,
        headers: { Location: `${origin}/contact` },
      },
      "/contact": {
        body: `<html><head><title>Contact Msg HVAC</title><meta name="description" content="Reach our team for a free estimate."><link rel="canonical" href="${origin}/contact"></head><body><h1>Contact</h1></body></html>`,
      },
      // No /robots.txt, no /sitemap.xml — both 404 via the fallback handler.
    }));
    activeServer = server;

    const result = await crawlSite(server.origin, { allowPrivateNetworks: true });

    expect(result.robots.fetched).toBe(false);
    expect(result.robots.homepageAllowed).toBe(true); // fail open, per architecture doc §4
    expect(result.sitemap.fetched).toBe(false);

    // Discovered via nav links only, since there's no sitemap.
    const discoveredPaths = result.additionalPages.map((p) => new URL(p.requestedUrl).pathname).sort();
    expect(discoveredPaths).toEqual(["/about-us", "/old-contact"]);

    const oldContact = result.additionalPages.find((p) => p.requestedUrl.endsWith("/old-contact"));
    expect(oldContact?.redirected).toBe(true);
    expect(new URL(oldContact!.finalUrl).pathname).toBe("/contact");

    const parsedPages = [result.homepage, ...result.additionalPages].map((p) =>
      parsePage(p.html, p.finalUrl),
    );
    const issues = detectTechnicalIssues({
      pages: parsedPages,
      robots: result.robots,
      sitemap: result.sitemap,
      ssl: result.ssl,
    });
    const issueTypes = issues.map((i) => i.type);

    expect(issueTypes).toContain("missing_meta_description"); // homepage
    expect(issueTypes).toContain("multiple_h1"); // homepage has two H1s
    expect(issueTypes).toContain("missing_alt_text"); // homepage truck.jpg
    expect(issueTypes).toContain("missing_canonical"); // homepage + about-us
    expect(issueTypes).toContain("duplicate_title_across_pages"); // "HVAC Services" used twice
    expect(issueTypes).toContain("robots_txt_missing");
    expect(issueTypes).toContain("sitemap_missing");
  });
});

describe("crawlSite against a site with robots restrictions and a sitemap index (Roofer Pro)", () => {
  it("respects robots.txt disallow rules, follows a sitemap index, and isolates a broken-redirect page failure", async () => {
    const server = await startFixtureServer((origin) => ({
      "/": {
        body: `<html><head>
          <title>Roofer Pro — Roofing Contractor</title>
          <meta name="description" content="Storm damage repair and full roof replacement.">
          <link rel="canonical" href="${origin}/">
          <script type="application/ld+json">{"@type":"RoofingContractor","name":"Roofer Pro"}</script>
        </head><body>
          <h1>Roofer Pro</h1>
          <nav>
            <a href="/contact">Contact</a>
            <a href="/private/pricing">Private Pricing</a>
            <a href="/services-info">Our Services</a>
          </nav>
        </body></html>`,
      },
      "/contact": {
        body: `<html><head><title>Contact Roofer Pro</title><meta name="description" content="Get a free roof inspection today."><link rel="canonical" href="${origin}/contact"></head><body><h1>Contact</h1></body></html>`,
      },
      "/private/pricing": {
        body: `<html><head><title>Internal Pricing</title></head><body><h1>Internal</h1></body></html>`,
      },
      "/services-info": {
        // Redirects to a port nothing listens on — a realistic way a real
        // site's broken redirect config fails, without needing a slow
        // timeout to prove one page's failure doesn't sink the crawl.
        status: 302,
        headers: { Location: "http://127.0.0.1:1/" },
      },
      "/robots.txt": {
        headers: { "Content-Type": "text/plain" },
        body: `User-agent: *\nDisallow: /private/\nSitemap: ${origin}/sitemap.xml`,
      },
      "/sitemap.xml": {
        headers: { "Content-Type": "application/xml" },
        body: `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${origin}/sitemap-a.xml</loc></sitemap><sitemap><loc>${origin}/sitemap-b.xml</loc></sitemap></sitemapindex>`,
      },
      "/sitemap-a.xml": {
        headers: { "Content-Type": "application/xml" },
        body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/contact</loc></url></urlset>`,
      },
      "/sitemap-b.xml": {
        headers: { "Content-Type": "application/xml" },
        body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/private/pricing</loc></url></urlset>`,
      },
    }));
    activeServer = server;

    const result = await crawlSite(server.origin, { allowPrivateNetworks: true });

    expect(result.robots.homepageAllowed).toBe(true);
    expect(result.sitemap.isIndex).toBe(true);
    expect(result.sitemap.urls.sort()).toEqual(
      [`${server.origin}/contact`, `${server.origin}/private/pricing`].sort(),
    );

    // /private/pricing is in the sitemap AND linked in nav, but robots.txt
    // disallows it — it must never appear as a crawled or failed page.
    const allAttemptedPaths = [
      ...result.additionalPages.map((p) => new URL(p.requestedUrl).pathname),
      ...result.failedPages.map((p) => new URL(p.url).pathname),
    ];
    expect(allAttemptedPaths).not.toContain("/private/pricing");

    // services-info's broken redirect fails, but doesn't take down the rest
    // of the crawl — /contact still succeeds.
    expect(result.failedPages.map((p) => new URL(p.url).pathname)).toContain(
      "/services-info",
    );
    expect(
      result.additionalPages.some((p) => new URL(p.requestedUrl).pathname === "/contact"),
    ).toBe(true);

    const homepageParsed = parsePage(result.homepage.html, result.homepage.finalUrl);
    expect(homepageParsed.structuredData.jsonLdTypes).toContain("RoofingContractor");
  });
});
