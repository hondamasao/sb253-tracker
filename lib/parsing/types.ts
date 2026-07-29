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
};
