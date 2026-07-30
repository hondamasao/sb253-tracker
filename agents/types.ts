import type { CrawlResult } from "@/lib/crawler";
import type { LighthouseOutput } from "./lighthouse";
import type { SiteSignalsOutput } from "./site-signals";
import type { Finding } from "./shared/schemas";
import type { SynthesisInput } from "./report-synthesis";
import type { ScanBudget } from "@/lib/budget";

/**
 * `lighthouse`/`siteSignals` are the M1a agents' already-computed output,
 * passed through in-memory for M1b's category agents to read — see
 * docs/18-m1b-ai-agent-architecture.md §2. Optional and nullable because
 * the M1a agent that produces them can itself fail (runAgentSafely never
 * throws); a category agent that depends on missing data fails gracefully
 * rather than crashing the scan (see each agent's own null-handling).
 *
 * `synthesisInput` is only populated for the Report Synthesis agent
 * (agents/report-synthesis) — it's architecturally narrower than the
 * category agents (docs/18 §1): it never sees crawlResult/lighthouse/
 * siteSignals directly, only the already-validated findings and the
 * deterministically-computed overall score/grade it must stay consistent
 * with.
 */
export type AgentContext = {
  scanId: string;
  websiteUrl: string;
  /**
   * Only the capture-phase agents (lighthouse, site_signals) need the raw
   * crawl, and they throw if it's absent. It is optional so the analysis
   * phase — which by design reads only `lighthouse`/`siteSignals` — can
   * run from a stored evidence bundle without fabricating a crawl result.
   * That absence is what lets the type system prove replay is complete
   * rather than us asserting it.
   */
  crawlResult?: CrawlResult;
  lighthouse?: LighthouseOutput | null;
  siteSignals?: SiteSignalsOutput | null;
  synthesisInput?: SynthesisInput;
  /**
   * The scan's shared spend ceiling (lib/budget.ts). Every AI-calling
   * agent reserves against it before dispatch; a breach aborts the
   * analysis and makes the scan unshippable (docs/19 §5).
   */
  budget?: ScanBudget;
};

export type AgentOutput = {
  /** Null when no deterministic scoring formula exists yet for this agent. */
  score: number | null;
  raw: Record<string, unknown>;
  modelUsed?: string;
  costUsd?: number;
  /**
   * The Problem/Why/Evidence/Action/Impact write-ups from
   * docs/16-report-quality-standard.md, added in M1b. Only the category
   * agents (agents/technical-analysis, seo-analysis, etc.) populate this —
   * M1a's lighthouse/site_signals agents never do, since they produce
   * structured facts, not customer-facing prose.
   */
  findings?: Finding[];
};

export type Agent = {
  type: string;
  run: (ctx: AgentContext) => Promise<AgentOutput>;
};
