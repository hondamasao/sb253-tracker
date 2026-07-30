CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"agent_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"score" integer,
	"raw_output" jsonb,
	"model_used" text,
	"cost_usd" numeric(10, 5),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"why_it_matters" text NOT NULL,
	"evidence" text NOT NULL,
	"recommendation" text NOT NULL,
	"expected_impact" text NOT NULL,
	"evidence_refs" jsonb NOT NULL,
	"effort_level" text NOT NULL,
	"before_example" text,
	"after_example" text,
	"priority_rank" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "findings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"email" text,
	"stripe_checkout_session_id" text NOT NULL,
	"stripe_payment_intent_id" text,
	"amount_cents" integer DEFAULT 2900 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "orders_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id")
);
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"overall_score" integer NOT NULL,
	"letter_grade" text NOT NULL,
	"executive_summary" text NOT NULL,
	"estimated_lost_leads_min" integer,
	"estimated_lost_leads_max" integer,
	"monthly_action_plan" jsonb NOT NULL,
	"omitted_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_unlocked" boolean DEFAULT false NOT NULL,
	"pdf_url" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_scan_id_unique" UNIQUE("scan_id")
);
--> statement-breakpoint
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "scan_benchmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"industry" text,
	"cms" text DEFAULT 'unknown' NOT NULL,
	"page_count" integer NOT NULL,
	"overall_score" integer NOT NULL,
	"technical_score" integer,
	"seo_score" integer,
	"conversion_score" integer,
	"trust_score" integer,
	"copywriting_score" integer,
	"finding_count" integer NOT NULL,
	"critical_finding_count" integer NOT NULL,
	"total_cost_usd" numeric(10, 5),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_benchmarks_scan_id_unique" UNIQUE("scan_id")
);
--> statement-breakpoint
ALTER TABLE "scan_benchmarks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_url" text NOT NULL,
	"report_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"ip_address" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scans_report_token_unique" UNIQUE("report_token")
);
--> statement-breakpoint
ALTER TABLE "scans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_benchmarks" ADD CONSTRAINT "scan_benchmarks_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;