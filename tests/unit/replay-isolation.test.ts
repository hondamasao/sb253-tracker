import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";

/**
 * Statically walks the replay entry point's import graph and asserts it
 * can never reach the crawler or the PageSpeed client.
 *
 * "Replay performs no network I/O" is only a real guarantee if the code
 * that could perform it is not reachable. Checking at runtime would only
 * prove that one particular execution didn't crawl; checking the import
 * closure proves no execution can. Type-only imports are excluded because
 * they are erased before anything runs.
 */

const ROOT = resolve(__dirname, "../..");
const FORBIDDEN = [
  { pattern: /@\/lib\/crawler/, label: "lib/crawler (network crawling)" },
  { pattern: /@\/agents\/lighthouse/, label: "agents/lighthouse (PageSpeed API)" },
  { pattern: /@\/agents\/site-signals/, label: "agents/site-signals (capture phase)" },
  { pattern: /^["']undici["']$/, label: "undici (raw HTTP client)" },
];

/** Value imports only — `import type` is erased and cannot execute. */
function valueImportsOf(source: string): string[] {
  const specifiers: string[] = [];
  const importRe = /^\s*import\s+(?!type\s)([\s\S]*?)\s+from\s+["']([^"']+)["']/gm;
  const bareRe = /^\s*import\s+["']([^"']+)["']/gm;

  for (const match of source.matchAll(importRe)) {
    const clause = match[1] ?? "";
    const specifier = match[2] as string;
    // `import { type A, type B } from "x"` is also fully erased.
    const named = clause.match(/^\{([\s\S]*)\}$/);
    if (named) {
      const parts = (named[1] as string).split(",").map((p) => p.trim()).filter(Boolean);
      if (parts.length > 0 && parts.every((p) => p.startsWith("type "))) continue;
    }
    specifiers.push(specifier);
  }
  for (const match of source.matchAll(bareRe)) {
    specifiers.push(match[1] as string);
  }
  return specifiers;
}

function resolveLocal(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else return null; // node_modules — not part of our graph

  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function importClosure(entry: string): { files: string[]; specifiers: string[] } {
  const seen = new Set<string>();
  const allSpecifiers: string[] = [];
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);

    const specifiers = valueImportsOf(readFileSync(file, "utf8"));
    for (const specifier of specifiers) {
      allSpecifiers.push(specifier);
      const resolved = resolveLocal(specifier, file);
      if (resolved) queue.push(resolved);
    }
  }
  return { files: [...seen], specifiers: allSpecifiers };
}

describe("replay is structurally incapable of crawling", () => {
  const { files, specifiers } = importClosure(resolve(ROOT, "scripts/replay.ts"));

  it("resolves a non-trivial import graph (guards against the walker silently finding nothing)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(FORBIDDEN)("never reaches $label", ({ pattern, label }) => {
    const offenders = specifiers.filter((specifier) => pattern.test(specifier));
    expect(offenders, `replay must not import ${label}`).toEqual([]);
  });

  it("does reach the shared analysis pipeline — the same one the live scan uses", () => {
    expect(files.some((file) => file.endsWith("lib/pipeline/run-analysis.ts"))).toBe(true);
  });
});

describe("the live scan uses that identical pipeline", () => {
  const { files } = importClosure(resolve(ROOT, "inngest/functions/run-scan.ts"));

  it("imports the same run-analysis module rather than a parallel implementation", () => {
    expect(files.some((file) => file.endsWith("lib/pipeline/run-analysis.ts"))).toBe(true);
  });

  it("is the side that owns the crawler, keeping capture and analysis separate", () => {
    expect(files.some((file) => file.includes("lib/crawler"))).toBe(true);
  });
});

/** Strips comments so assertions are about executable code, not prose about it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the analysis pipeline cannot tell live from replay", () => {
  it("contains no branch on bundle provenance or a replay mode flag", () => {
    const code = stripComments(
      readFileSync(resolve(ROOT, "lib/pipeline/run-analysis.ts"), "utf8"),
    );
    expect(code).not.toMatch(/provenance/);
    expect(code).not.toMatch(/\bisReplay\b|\breplayMode\b/);
  });

  it("does not read the filesystem or process arguments — its only input is the bundle it is handed", () => {
    const code = stripComments(
      readFileSync(resolve(ROOT, "lib/pipeline/run-analysis.ts"), "utf8"),
    );
    expect(code).not.toMatch(/readFileSync|process\.argv/);
  });
});
