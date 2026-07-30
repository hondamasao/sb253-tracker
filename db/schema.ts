import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The 5 MVP tables, mirroring docs/15-mvp-scope-and-m0-plan.md §1.4 exactly.
 * No `organizations`, `profiles`, or auth-related tables — the MVP has no
 * accounts (see that doc for why). `report_token` is what stands in for
 * authentication: an unguessable UUID in the report URL.
 */

export const scans = pgTable("scans", {
  id: uuid("id").primaryKey().defaultRandom(),
  websiteUrl: text("website_url").notNull(),
  reportToken: uuid("report_token").notNull().defaultRandom().unique(),
  status: text("status").notNull().default("queued"), // queued | running | completed | failed
  ipAddress: text("ip_address"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  scanId: uuid("scan_id")
    .notNull()
    .references(() => scans.id, { onDelete: "cascade" }),
  // lighthouse | site_signals | technical_analysis | seo_analysis |
  // conversion_optimization | trust_credibility | copywriting | report_synthesis
  agentType: text("agent_type").notNull(),
  status: text("status").notNull().default("queued"),
  score: integer("score"),
  rawOutput: jsonb("raw_output"),
  modelUsed: text("model_used"),
  costUsd: numeric("cost_usd", { precision: 10, scale: 5 }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  scanId: uuid("scan_id")
    .notNull()
    .unique()
    .references(() => scans.id, { onDelete: "cascade" }),
  overallScore: integer("overall_score").notNull(),
  letterGrade: text("letter_grade").notNull(),
  executiveSummary: text("executive_summary").notNull(),
  estimatedLostLeadsMin: integer("estimated_lost_leads_min"),
  estimatedLostLeadsMax: integer("estimated_lost_leads_max"),
  monthlyActionPlan: jsonb("monthly_action_plan").notNull(),
  /**
   * Degradable categories that failed and were left out
   * (docs/19-m1c-security-and-evaluation.md §5). Stored structured for
   * rendering, but the disclosure is ALSO written into
   * `executive_summary` so a renderer that forgets this field still shows
   * the customer what's missing. Never a silent omission.
   */
  omittedCategories: jsonb("omitted_categories").notNull().default([]),
  isUnlocked: boolean("is_unlocked").notNull().default(false),
  pdfUrl: text("pdf_url"),
  generatedAt: timestamp("generated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

/**
 * Columns map one-to-one to the 5-part finding structure required by
 * docs/16-report-quality-standard.md §6: title = Problem (one sentence),
 * whyItMatters, evidence, recommendation = Recommended action,
 * expectedImpact. `evidenceRefs` stores the evidence IDs the finding
 * cited (docs/18-m1b-ai-agent-architecture.md §5) so any finding can be
 * traced back to the exact raw facts it was grounded in, permanently —
 * not just checked once at generation time.
 */
export const findings = pgTable("findings", {
  id: uuid("id").primaryKey().defaultRandom(),
  reportId: uuid("report_id")
    .notNull()
    .references(() => reports.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  severity: text("severity").notNull(), // critical | high | medium | low
  title: text("title").notNull(), // Problem
  whyItMatters: text("why_it_matters").notNull(),
  evidence: text("evidence").notNull(),
  recommendation: text("recommendation").notNull(), // Recommended action
  expectedImpact: text("expected_impact").notNull(),
  evidenceRefs: jsonb("evidence_refs").notNull(),
  effortLevel: text("effort_level").notNull(), // low | medium | high
  beforeExample: text("before_example"),
  afterExample: text("after_example"),
  priorityRank: integer("priority_rank").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

/**
 * Denormalized per-scan benchmark row, written in the SAME transaction as
 * the report (docs/19-m1c-security-and-evaluation.md §6).
 *
 * Same-transaction is the whole point: the numbers are derivable from
 * `reports` + `agent_runs` today, but only while those rows survive and
 * only while the derivation rules stay unchanged. Recording the answer at
 * write time means we can never end up unable to backfill. Category
 * scores are individual columns rather than jsonb specifically so
 * percentile queries (`percentile_cont(0.5) WITHIN GROUP (ORDER BY
 * seo_score)`) work directly, sliced by industry, CMS, or page count.
 *
 * No UI consumes this yet — that's intentional. It exists so the data
 * starts accumulating now rather than beginning the day someone wants it.
 */
export const scanBenchmarks = pgTable("scan_benchmarks", {
  id: uuid("id").primaryKey().defaultRandom(),
  scanId: uuid("scan_id")
    .notNull()
    .unique()
    .references(() => scans.id, { onDelete: "cascade" }),
  /** Best-effort keyword guess (agents/shared/detect-industry.ts); null when undetected. */
  industry: text("industry"),
  /** Coarse platform fingerprint (lib/parsing/detect-cms.ts). */
  cms: text("cms").notNull().default("unknown"),
  pageCount: integer("page_count").notNull(),
  overallScore: integer("overall_score").notNull(),
  technicalScore: integer("technical_score"),
  seoScore: integer("seo_score"),
  conversionScore: integer("conversion_score"),
  trustScore: integer("trust_score"),
  copywritingScore: integer("copywriting_score"),
  findingCount: integer("finding_count").notNull(),
  criticalFindingCount: integer("critical_finding_count").notNull(),
  /** Real measured spend for this scan — the data that will reset the provisional ceiling. */
  totalCostUsd: numeric("total_cost_usd", { precision: 10, scale: 5 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  scanId: uuid("scan_id")
    .notNull()
    .references(() => scans.id),
  email: text("email"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id")
    .notNull()
    .unique(),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  amountCents: integer("amount_cents").notNull().default(2900),
  status: text("status").notNull().default("pending"), // pending | paid | refunded
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}).enableRLS();

/**
 * Relations let M1+ code write `db.query.scans.findFirst({ with: { agentRuns:
 * true, report: { with: { findings: true } } } })` instead of hand-rolled
 * joins — purely a query-ergonomics layer, no schema/table impact.
 */
export const scansRelations = relations(scans, ({ many, one }) => ({
  agentRuns: many(agentRuns),
  report: one(reports, { fields: [scans.id], references: [reports.scanId] }),
  order: one(orders, { fields: [scans.id], references: [orders.scanId] }),
  benchmark: one(scanBenchmarks, {
    fields: [scans.id],
    references: [scanBenchmarks.scanId],
  }),
}));

export const scanBenchmarksRelations = relations(scanBenchmarks, ({ one }) => ({
  scan: one(scans, { fields: [scanBenchmarks.scanId], references: [scans.id] }),
}));

export const agentRunsRelations = relations(agentRuns, ({ one }) => ({
  scan: one(scans, { fields: [agentRuns.scanId], references: [scans.id] }),
}));

export const reportsRelations = relations(reports, ({ one, many }) => ({
  scan: one(scans, { fields: [reports.scanId], references: [scans.id] }),
  findings: many(findings),
}));

export const findingsRelations = relations(findings, ({ one }) => ({
  report: one(reports, { fields: [findings.reportId], references: [reports.id] }),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  scan: one(scans, { fields: [orders.scanId], references: [scans.id] }),
}));
