CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"ats" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"origin" text DEFAULT 'user' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_job_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"company" text,
	"location" text,
	"description" text,
	"work_model" text,
	"employment_type" text,
	"query" text,
	"posted_at" timestamp with time zone,
	"fingerprint" text,
	"duplicate_of" integer,
	"score" integer,
	"match" jsonb,
	"scored_version" integer,
	"ai_scored" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"status_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" integer PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"cv_text" text,
	"cv_file_name" text,
	"cv_updated_at" timestamp with time zone,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"found" integer DEFAULT 0 NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"message" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "companies_ats_slug_idx" ON "companies" USING btree ("ats","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_source_external_idx" ON "jobs" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "jobs_fingerprint_idx" ON "jobs" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "jobs_first_seen_idx" ON "jobs" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "jobs_score_idx" ON "jobs" USING btree ("score");