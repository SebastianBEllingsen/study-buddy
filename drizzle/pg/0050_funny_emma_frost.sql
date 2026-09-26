CREATE TABLE "study_plan_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"chapter_id" integer NOT NULL,
	"date" text NOT NULL,
	"minutes" integer NOT NULL,
	"kind" text DEFAULT 'study' NOT NULL,
	"done_at" text,
	"google_event_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generated_items" ADD COLUMN "study_plan_chapter_id" integer;--> statement-breakpoint
ALTER TABLE "study_plan_sessions" ADD CONSTRAINT "study_plan_sessions_plan_id_study_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."study_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plan_sessions" ADD CONSTRAINT "study_plan_sessions_chapter_id_study_plan_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."study_plan_chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_study_plan_sessions_plan_id" ON "study_plan_sessions" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_study_plan_sessions_date" ON "study_plan_sessions" USING btree ("date");--> statement-breakpoint
ALTER TABLE "generated_items" ADD CONSTRAINT "generated_items_study_plan_chapter_id_study_plan_chapters_id_fk" FOREIGN KEY ("study_plan_chapter_id") REFERENCES "public"."study_plan_chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_generated_items_study_plan_chapter_id" ON "generated_items" USING btree ("study_plan_chapter_id");