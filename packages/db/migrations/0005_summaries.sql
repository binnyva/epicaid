DROP INDEX "book_summaries_key";--> statement-breakpoint
ALTER TABLE "book_summaries" ADD COLUMN "scope" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "spoiler_reports" ADD COLUMN "target_ref" text;--> statement-breakpoint
ALTER TABLE "spoiler_reports" ADD COLUMN "summary" jsonb;--> statement-breakpoint
CREATE INDEX "spend_log_reader" ON "spend_log" USING btree ("reader_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "book_summaries_key" ON "book_summaries" USING btree ("subject_id","book_id","scope","model","prompt_version");