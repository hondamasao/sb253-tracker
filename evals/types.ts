/**
 * Plain data shapes exchanged with the judge.
 *
 * Deliberately standalone rather than re-using the pipeline's own types:
 * the judge module must not import from `agents/`, so giving it its own
 * vocabulary removes any temptation (and any transitive import path) to
 * reach the generating prompts. See evals/judge/index.ts and the ESLint
 * rule in eslint.config.mjs.
 */

export type JudgeFinding = {
  priorityRank: number;
  category: string;
  severity: string;
  effortLevel: string;
  problem: string;
  whyItMatters: string;
  evidence: string;
  evidenceIds: string[];
  recommendedAction: string;
  expectedImpact: string;
};

export type JudgeReportInput = {
  websiteUrl: string;
  overallScore: number;
  letterGrade: string;
  executiveSummary: string;
  findings: JudgeFinding[];
};

/**
 * The raw crawl facts, rendered as text. This is the ground truth the
 * judge checks claims against — deliberately the underlying evidence
 * rather than the agents' numbered evidence lists, so the judge verifies
 * "is this true of the site" rather than "does this ID exist", which the
 * deterministic validator already guarantees.
 */
export type JudgeEvidenceInput = string;
