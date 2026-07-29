/**
 * A short, human-readable label for a crawled page, used to prefix
 * evidence facts (e.g. "Homepage title tag: ..." / 'Page "/contact" has no
 * meta description.') so findings read naturally instead of quoting full
 * URLs everywhere.
 */
export function pageLabel(pageUrl: string): string {
  try {
    const { pathname } = new URL(pageUrl);
    if (pathname === "" || pathname === "/") return "Homepage";
    return `Page "${pathname}"`;
  } catch {
    return "A page";
  }
}
