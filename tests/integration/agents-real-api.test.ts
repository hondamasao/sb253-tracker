import { describe, expect, it } from "vitest";
import { parsePage } from "@/lib/parsing/parse-page";
import { detectTechnicalIssues } from "@/lib/parsing/technical-issues";
import { callCategoryAgent, buildEvidenceList, passesBannedContentRules } from "@/agents/shared";
import {
  technicalAnalysisAgent,
  seoAnalysisAgent,
  conversionOptimizationAgent,
  trustCredibilityAgent,
  copywritingAgent,
  reportSynthesisAgent,
} from "@/agents";
import type { LighthouseOutput } from "@/agents/lighthouse";
import type { SiteSignalsOutput } from "@/agents/site-signals";
import type { CrawlResult } from "@/lib/crawler";
import { assembleReport } from "@/lib/report/assemble-report";
import type { CategoryReportInput } from "@/lib/report/assemble-report";

/**
 * These tests make REAL calls to the Anthropic API — no mocked AI output,
 * per this milestone's explicit instruction (docs/18-m1b-ai-agent-architecture.md).
 * They only run when a real ANTHROPIC_API_KEY is present (loaded from
 * .env.local by vitest.config.ts); without one, they skip cleanly rather
 * than failing, so CI and contributors without a key are unaffected. Run
 * them locally with a real key to verify the agents/prompts for real.
 */
const hasRealApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
const TEST_TIMEOUT_MS = 45_000;

describe.skipIf(!hasRealApiKey)("category agents against the real Anthropic API", () => {
  it(
    "callCategoryAgent returns validated, evidence-grounded findings for a realistic evidence list",
    async () => {
      const evidence = buildEvidenceList([
        'Homepage title tag: "Home — Welcome to Our Website." (58 characters).',
        "Homepage has no meta description.",
        'PageSpeed Insights (mobile) Performance score: 38/100.',
        'Largest Contentful Paint (mobile): 5.9s (Google considers over 2.5s poor).',
      ]);

      const result = await callCategoryAgent({
        categoryGuidance:
          "You are analyzing TECHNICAL HEALTH: page speed, Core Web Vitals, and whether the site can be reliably reached.",
        evidence,
      });

      expect(result.modelUsed).toBe("claude-haiku-4-5-20251001");
      expect(result.costUsd).toBeGreaterThan(0);
      expect(result.categorySummary.length).toBeGreaterThan(0);
      expect(result.findings.length).toBeLessThanOrEqual(5);

      const validIds = new Set(evidence.map((item) => item.id));
      for (const finding of result.findings) {
        expect(finding.problem.length).toBeGreaterThan(0);
        expect(finding.whyItMatters.length).toBeGreaterThan(0);
        expect(finding.evidence.length).toBeGreaterThan(0);
        expect(finding.recommendedAction.length).toBeGreaterThan(0);
        expect(finding.expectedImpact.length).toBeGreaterThan(0);
        expect(finding.evidenceIds.length).toBeGreaterThan(0);
        for (const id of finding.evidenceIds) {
          expect(validIds.has(id)).toBe(true);
        }
        expect(passesBannedContentRules(finding.problem)).toBe(true);
        expect(passesBannedContentRules(finding.expectedImpact)).toBe(true);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "returns zero findings (not fabricated ones) when the evidence supports nothing significant",
    async () => {
      const evidence = buildEvidenceList([
        "Homepage has a phone number visible: 555-123-4567.",
        "Homepage has a <form> element (contact/quote form).",
        'Homepage contains call-to-action language: "call now", "free estimate".',
      ]);

      const result = await callCategoryAgent({
        categoryGuidance:
          "You are analyzing CONVERSION OPTIMIZATION: phone visibility, contact forms, and CTA language.",
        evidence,
      });

      // Not a strict assertion that findings must be empty (a real model
      // may reasonably find a nuance), but there must be no fabricated
      // evidence IDs and no banned content — the actual hard guarantees.
      const validIds = new Set(evidence.map((item) => item.id));
      for (const finding of result.findings) {
        for (const id of finding.evidenceIds) {
          expect(validIds.has(id)).toBe(true);
        }
      }
      expect(passesBannedContentRules(result.categorySummary)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});

function buildFixtureCrawlResult(): CrawlResult {
  const homepageHtml = `
    <html><head>
      <title>Home — Welcome to Our Website</title>
      <script type="application/ld+json">{"@type":"LocalBusiness","name":"Acme Plumbing"}</script>
    </head><body>
      <h1>Welcome</h1>
      <p>We do plumbing work. Contact us for more information about our services.</p>
    </body></html>
  `;
  const contactHtml = `
    <html><head><title>Contact</title></head><body>
      <form></form>
      <p>Reach us at 555-123-4567. We are licensed and insured.</p>
    </body></html>
  `;

  const now = new Date().toISOString();
  return {
    requestedUrl: "https://acmeplumbing.example/",
    homepage: {
      requestedUrl: "https://acmeplumbing.example/",
      finalUrl: "https://acmeplumbing.example/",
      status: 200,
      redirected: false,
      htmlByteLength: homepageHtml.length,
      fetchedAt: now,
      html: homepageHtml,
    },
    additionalPages: [
      {
        requestedUrl: "https://acmeplumbing.example/contact",
        finalUrl: "https://acmeplumbing.example/contact",
        status: 200,
        redirected: false,
        htmlByteLength: contactHtml.length,
        fetchedAt: now,
        html: contactHtml,
      },
    ],
    failedPages: [],
    robots: { fetched: true, originReachable: true, content: "User-agent: *\nAllow: /", sitemapUrls: [], homepageAllowed: true },
    sitemap: {
      fetched: true,
      sourceUrl: "https://acmeplumbing.example/sitemap.xml",
      urls: ["https://acmeplumbing.example/"],
      isIndex: false,
    },
    ssl: { requestedHttps: true, finalUrlIsHttps: true, certificateValid: true, error: null },
    crawledAt: now,
  };
}

function buildFixtureSiteSignals(crawlResult: CrawlResult): SiteSignalsOutput {
  const pages = [crawlResult.homepage, ...crawlResult.additionalPages].map((page) =>
    parsePage(page.html, page.finalUrl),
  );
  return {
    pages,
    failedPages: crawlResult.failedPages,
    robots: crawlResult.robots,
    sitemap: crawlResult.sitemap,
    ssl: crawlResult.ssl,
    technicalIssues: detectTechnicalIssues({
      pages,
      robots: crawlResult.robots,
      sitemap: crawlResult.sitemap,
      ssl: crawlResult.ssl,
    }),
    analyzedAt: new Date().toISOString(),
  };
}

const fixtureLighthouse: LighthouseOutput = {
  finalUrl: "https://acmeplumbing.example/",
  strategy: "mobile",
  categoryScores: { performance: 45, accessibility: 88, bestPractices: 92, seo: 80 },
  coreWebVitals: {
    largestContentfulPaintMs: 5200,
    cumulativeLayoutShift: 0.05,
    totalBlockingTimeMs: 300,
    speedIndexMs: 4800,
    timeToInteractiveMs: 6000,
  },
  topOpportunities: [{ id: "unused-css", title: "Reduce unused CSS", potentialSavingsMs: 800 }],
  analyzedAt: new Date().toISOString(),
};

describe.skipIf(!hasRealApiKey)(
  "the full M1b pipeline against the real Anthropic API (fixture site)",
  () => {
    it(
      "runs all 5 category agents + Report Synthesis end-to-end and assembles a complete report",
      async () => {
        const crawlResult = buildFixtureCrawlResult();
        const siteSignals = buildFixtureSiteSignals(crawlResult);
        const ctx = {
          scanId: "test-scan",
          websiteUrl: "https://acmeplumbing.example/",
          crawlResult,
          lighthouse: fixtureLighthouse,
          siteSignals,
        };

        const [technical, seo, conversion, trust, copywriting] = await Promise.all([
          technicalAnalysisAgent.run(ctx),
          seoAnalysisAgent.run(ctx),
          conversionOptimizationAgent.run(ctx),
          trustCredibilityAgent.run(ctx),
          copywritingAgent.run(ctx),
        ]);

        const categoryInputs: CategoryReportInput[] = [
          { category: "technical_analysis", score: technical.score, categorySummary: (technical.raw as { categorySummary: string }).categorySummary, findings: technical.findings ?? [] },
          { category: "seo_analysis", score: seo.score, categorySummary: (seo.raw as { categorySummary: string }).categorySummary, findings: seo.findings ?? [] },
          { category: "conversion_optimization", score: conversion.score, categorySummary: (conversion.raw as { categorySummary: string }).categorySummary, findings: conversion.findings ?? [] },
          { category: "trust_credibility", score: trust.score, categorySummary: (trust.raw as { categorySummary: string }).categorySummary, findings: trust.findings ?? [] },
          { category: "copywriting", score: copywriting.score, categorySummary: (copywriting.raw as { categorySummary: string }).categorySummary, findings: copywriting.findings ?? [] },
        ];

        const assembled = assembleReport(categoryInputs);
        expect(assembled.overallScore).toBeGreaterThanOrEqual(0);
        expect(assembled.overallScore).toBeLessThanOrEqual(100);
        expect(["A", "B", "C", "D", "F"]).toContain(assembled.letterGrade);

        const synthesisResult = await reportSynthesisAgent.run({
          scanId: "test-scan",
          websiteUrl: "https://acmeplumbing.example/",
          crawlResult,
          synthesisInput: {
            ...assembled.synthesisInput,
            overallScore: assembled.overallScore,
            letterGrade: assembled.letterGrade,
          },
        });

        const executiveSummary = (synthesisResult.raw as { executiveSummary: string }).executiveSummary;
        expect(executiveSummary.length).toBeGreaterThan(0);
        expect(passesBannedContentRules(executiveSummary)).toBe(true);

        // Print the assembled report so a human can read the actual
        // generated quality during local runs with a real key.
        console.log("\n=== ASSEMBLED REPORT (fixture site) ===");
        console.log(`Overall score: ${assembled.overallScore}/100 (${assembled.letterGrade})`);
        console.log(`Executive summary: ${executiveSummary}`);
        for (const finding of assembled.prioritizedFindings) {
          console.log(
            `\n#${finding.priorityRank} [${finding.category}/${finding.severity}] ${finding.problem}\n  Why it matters: ${finding.whyItMatters}\n  Evidence: ${finding.evidence}\n  Recommended action: ${finding.recommendedAction}\n  Expected impact: ${finding.expectedImpact}`,
          );
        }
      },
      TEST_TIMEOUT_MS * 2,
    );
  },
);
