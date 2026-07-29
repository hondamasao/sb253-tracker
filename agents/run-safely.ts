import type { Agent, AgentContext } from "./types";
import type { Finding } from "./shared/schemas";

export type AgentRunResult =
  | {
      status: "completed";
      agentType: string;
      score: number | null;
      raw: Record<string, unknown>;
      modelUsed?: string;
      costUsd?: number;
      /** Only present for the category agents (M1b) — see agents/types.ts. */
      findings?: Finding[];
    }
  | { status: "failed"; agentType: string; error: string };

/**
 * Runs one agent and NEVER throws — a failure becomes a `{status:"failed"}`
 * value instead. This is what makes per-agent failure isolation work: the
 * caller (the Inngest function) can run every agent as its own step and
 * know that one agent blowing up can never fail the others or the scan as
 * a whole. See docs/17-m1-crawler-architecture.md §4.
 */
export async function runAgentSafely(
  agent: Agent,
  ctx: AgentContext,
): Promise<AgentRunResult> {
  try {
    const output = await agent.run(ctx);
    return { status: "completed", agentType: agent.type, ...output };
  } catch (error) {
    return {
      status: "failed",
      agentType: agent.type,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
