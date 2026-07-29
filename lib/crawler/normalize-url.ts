/**
 * A user typing a business's website rarely includes a scheme
 * ("acmeplumbing.com", not "https://acmeplumbing.com"). Default to https —
 * the common case — and leave the caller's own scheme alone if they gave
 * one. Shared by the API route (fast input validation) and the crawler
 * (actual fetching) so both agree on what counts as a plausible URL.
 */
export function normalizeInputUrl(input: string): string {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    // fall through to the https:// default below
  }
  return `https://${trimmed}`;
}
