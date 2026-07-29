import type { CrawlResult } from "@/lib/crawler";

/**
 * Scoped down from the full agent contract in docs/06-ai-agent-architecture.md
 * for M1: no `findings` field. M1 agents produce structured facts and, where
 * a real deterministic number exists, a score — never customer-facing
 * prose. `findings` (the Problem/Why/Evidence/Action/Impact write-ups from
 * docs/16-report-quality-standard.md) get added to this contract in the
 * milestone that introduces the AI-driven agents and the Synthesis Agent.
 */
export type AgentContext = {
  scanId: string;
  websiteUrl: string;
  crawlResult: CrawlResult;
};

export type AgentOutput = {
  /** Null when no deterministic scoring formula exists yet for this agent. */
  score: number | null;
  raw: Record<string, unknown>;
  modelUsed?: string;
  costUsd?: number;
};

export type Agent = {
  type: string;
  run: (ctx: AgentContext) => Promise<AgentOutput>;
};
