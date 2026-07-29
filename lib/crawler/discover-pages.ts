const IMPORTANT_PAGE_KEYWORDS = [
  "contact",
  "about",
  "service",
  "services",
  "pricing",
  "location",
  "locations",
];

const MAX_ADDITIONAL_PAGES = 4;

type NavLink = { href: string; text: string };
type Candidate = { url: string; source: "sitemap" | "nav-link" };

function matchesKeyword(haystack: string): boolean {
  const lower = haystack.toLowerCase();
  return IMPORTANT_PAGE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

/**
 * Decides which additional pages (beyond the homepage) to crawl. This is
 * the entire "avoid crawling too much" policy in one place: a small fixed
 * keyword allowlist instead of breadth-first crawling, sitemap matches
 * preferred over nav-link scraping (sitemaps are a more reliable source of
 * real pages — nav scraping can pick up social-share links, anchors,
 * etc.), same-origin only, capped at 4, and filtered through robots.txt.
 */
export function discoverAdditionalPages(params: {
  origin: string;
  homepageUrl: string;
  sitemapUrls: string[];
  navLinks: NavLink[];
  isAllowed: (url: string) => boolean;
}): string[] {
  const { origin, homepageUrl, sitemapUrls, navLinks, isAllowed } = params;

  const normalize = (raw: string): string | null => {
    try {
      const parsed = new URL(raw, origin);
      parsed.hash = "";
      const withoutTrailingSlash = parsed.toString().replace(/\/$/, "");
      return withoutTrailingSlash;
    } catch {
      return null;
    }
  };

  const homepageNormalized = normalize(homepageUrl);
  const seen = new Set<string>(homepageNormalized ? [homepageNormalized] : []);
  const candidates: Candidate[] = [];

  for (const rawUrl of sitemapUrls) {
    const normalized = normalize(rawUrl);
    if (!normalized || seen.has(normalized)) continue;
    if (!matchesKeyword(normalized)) continue;
    seen.add(normalized);
    candidates.push({ url: normalized, source: "sitemap" });
  }

  for (const link of navLinks) {
    const normalized = normalize(link.href);
    if (!normalized || seen.has(normalized)) continue;

    let sameOrigin: boolean;
    try {
      sameOrigin = new URL(normalized).origin === origin;
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) continue;

    if (!matchesKeyword(`${normalized} ${link.text}`)) continue;
    seen.add(normalized);
    candidates.push({ url: normalized, source: "nav-link" });
  }

  return candidates
    .filter((candidate) => isAllowed(candidate.url))
    .slice(0, MAX_ADDITIONAL_PAGES)
    .map((candidate) => candidate.url);
}
