/**
 * Everything the crawler knows about one fetched page. Deliberately does
 * NOT include the raw HTML string — see docs/17-m1-crawler-architecture.md
 * §5 for why we store extracted facts, not markup.
 */
export type CrawledPage = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  redirected: boolean;
  htmlByteLength: number;
  fetchedAt: string;
  /** Only present on success — parsing happens in lib/parsing, not here. */
  html: string;
};

export type FailedPage = {
  url: string;
  reason: string;
};

export type RobotsInfo = {
  fetched: boolean;
  /**
   * True when the origin answered at the HTTP level at all — including a
   * 404. Distinguishes "this site has no robots.txt" from "this scheme
   * doesn't work here", which the crawler needs because it probes the
   * scheme via robots.txt before fetching anything else.
   */
  originReachable: boolean;
  /** Raw robots.txt content, capped in length — kept because it's small and directly requested as data to collect. */
  content: string | null;
  sitemapUrls: string[];
  /** Whether our user-agent is allowed to crawl the homepage itself. */
  homepageAllowed: boolean;
};

export type SitemapInfo = {
  fetched: boolean;
  sourceUrl: string | null;
  /** Capped sample of URLs found — see the "avoid crawling too much" rules. */
  urls: string[];
  /** True if this was a sitemap index that pointed at child sitemaps. */
  isIndex: boolean;
};

export type SslInfo = {
  requestedHttps: boolean;
  finalUrlIsHttps: boolean;
  certificateValid: boolean;
  error: string | null;
};

/**
 * The one object the crawler produces. Every analyzer (agents/*) reads
 * from this — the crawler has no knowledge of which analyzers exist or
 * what they'll do with it, which is what makes adding new analyzers later
 * a zero-change-to-the-crawler operation.
 */
export type CrawlResult = {
  requestedUrl: string;
  homepage: CrawledPage;
  additionalPages: CrawledPage[];
  failedPages: FailedPage[];
  robots: RobotsInfo;
  sitemap: SitemapInfo;
  ssl: SslInfo;
  crawledAt: string;
};
