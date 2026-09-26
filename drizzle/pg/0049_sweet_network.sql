CREATE TABLE "study_plan_chapters" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"stage" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"subtopics_json" text DEFAULT '[]' NOT NULL,
	"prerequisite_ids_json" text DEFAULT '[]' NOT NULL,
	"linked_document_ids_json" text DEFAULT '[]' NOT NULL,
	"current_level" text,
	"estimated_minutes" integer,
	"completed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_plan_resources" (
	"id" serial PRIMARY KEY NOT NULL,
	"chapter_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"provider" text,
	"language" text,
	"note" text DEFAULT '' NOT NULL,
	"origin" text DEFAULT 'ai' NOT NULL,
	"link_status" text DEFAULT 'unchecked' NOT NULL,
	"status_detail" text,
	"checked_at" text,
	"done_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"preset" text NOT NULL,
	"options_json" text NOT NULL,
	"syllabus_document_id" integer,
	"syllabus_text" text,
	"source_document_ids" text NOT NULL,
	"source_folder_id" integer,
	"source_handpicked" boolean DEFAULT false NOT NULL,
	"language" text NOT NULL,
	"model_provider" text,
	"model_name" text,
	"used_web_search" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"links_checked_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "study_plans_course_id_unique" UNIQUE("course_id")
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "preferred_language" text;--> statement-breakpoint
ALTER TABLE "study_plan_chapters" ADD CONSTRAINT "study_plan_chapters_plan_id_study_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."study_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plan_resources" ADD CONSTRAINT "study_plan_resources_chapter_id_study_plan_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."study_plan_chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_syllabus_document_id_documents_id_fk" FOREIGN KEY ("syllabus_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_source_folder_id_folders_id_fk" FOREIGN KEY ("source_folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_study_plan_chapters_plan_id" ON "study_plan_chapters" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_study_plan_resources_chapter_id" ON "study_plan_resources" USING btree ("chapter_id");