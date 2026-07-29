export type Heading = { level: 1 | 2 | 3 | 4 | 5 | 6; text: string };
export type LinkInfo = { href: string; text: string };
export type ImageInfo = { src: string; alt: string | null };

export type StructuredDataInfo = {
  jsonLdTypes: string[];
  jsonLdCount: number;
  hasMicrodata: boolean;
  parseErrors: number;
};

export type ParsedPage = {
  url: string;
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  isNoIndex: boolean;
  headings: Heading[];
  internalLinks: LinkInfo[];
  images: ImageInfo[];
  structuredData: StructuredDataInfo;
  /**
   * The four fields below exist for M1b's AI agents (Conversion, Trust,
   * Copywriting) — see docs/18-m1b-ai-agent-architecture.md §2. All four
   * are deterministic extraction (regex/keyword/DOM-query), computed here
   * so the model never has to "search" raw text for these facts itself.
   */
  /** Cleaned, whitespace-normalized visible text, capped — for Copywriting to quote real sentences. */
  visibleText: string;
  /** Deduplicated, regex-extracted phone-number-shaped strings. */
  phoneNumbers: string[];
  hasContactForm: boolean;
  /** Matched phrases from a small fixed CTA-language list found in visible text. */
  ctaPhrases: string[];
  /** Matched phrases from a small fixed trust-keyword list found in visible text. */
  trustSignalMentions: string[];
};
