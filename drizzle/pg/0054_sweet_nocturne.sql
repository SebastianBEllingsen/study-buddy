CREATE TABLE "exam_dates" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"date" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "exam_dates_course_id_unique" UNIQUE("course_id")
);
--> statement-breakpoint
CREATE TABLE "explain_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"chapter_id" integer,
	"kind" text NOT NULL,
	"topic" text NOT NULL,
	"status" text NOT NULL,
	"messages_json" text DEFAULT '[]' NOT NULL,
	"result_json" text,
	"practice_item_id" integer,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_dates" ADD CONSTRAINT "exam_dates_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explain_sessions" ADD CONSTRAINT "explain_sessions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explain_sessions" ADD CONSTRAINT "explain_sessions_chapter_id_study_plan_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."study_plan_chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explain_sessions" ADD CONSTRAINT "explain_sessions_practice_item_id_generated_items_id_fk" FOREIGN KEY ("practice_item_id") REFERENCES "public"."generated_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_explain_sessions_course_id" ON "explain_sessions" USING btree ("course_id");