CREATE TABLE "code_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"chapter_id" integer,
	"title" text NOT NULL,
	"language" text NOT NULL,
	"content_json" text NOT NULL,
	"progress_json" text DEFAULT '[]' NOT NULL,
	"practice_item_id" integer,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "code_sets" ADD CONSTRAINT "code_sets_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_sets" ADD CONSTRAINT "code_sets_chapter_id_study_plan_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."study_plan_chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_sets" ADD CONSTRAINT "code_sets_practice_item_id_generated_items_id_fk" FOREIGN KEY ("practice_item_id") REFERENCES "public"."generated_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_code_sets_course_id" ON "code_sets" USING btree ("course_id");