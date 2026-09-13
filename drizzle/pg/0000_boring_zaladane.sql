CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"ai_provider" text DEFAULT 'api' NOT NULL,
	"anthropic_api_key" text,
	"openai_api_key" text,
	"gemini_api_key" text,
	"openrouter_api_key" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"folder_id" integer,
	"filename" text NOT NULL,
	"file_path" text NOT NULL,
	"extracted_text" text,
	"page_count" integer,
	"char_count" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flashcard_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"generated_item_id" integer NOT NULL,
	"card_index" integer NOT NULL,
	"last_result" text NOT NULL,
	"reviewed_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flashcard_schedule" (
	"generated_item_id" integer NOT NULL,
	"card_index" integer NOT NULL,
	"ease_factor" real DEFAULT 2.5 NOT NULL,
	"interval_days" real DEFAULT 0 NOT NULL,
	"repetitions" integer DEFAULT 0 NOT NULL,
	"due_at" text NOT NULL,
	"last_reviewed_at" text,
	CONSTRAINT "flashcard_schedule_generated_item_id_card_index_pk" PRIMARY KEY("generated_item_id","card_index")
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"name" text NOT NULL,
	"is_master" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"folder_id" integer,
	"mode" text NOT NULL,
	"title" text NOT NULL,
	"content_json" text NOT NULL,
	"source_document_ids" text NOT NULL,
	"source_folder_id" integer,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"generated_item_id" integer NOT NULL,
	"started_at" text NOT NULL,
	"completed_at" text,
	"score" real,
	"answers_json" text
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcard_reviews" ADD CONSTRAINT "flashcard_reviews_generated_item_id_generated_items_id_fk" FOREIGN KEY ("generated_item_id") REFERENCES "public"."generated_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcard_schedule" ADD CONSTRAINT "flashcard_schedule_generated_item_id_generated_items_id_fk" FOREIGN KEY ("generated_item_id") REFERENCES "public"."generated_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_items" ADD CONSTRAINT "generated_items_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_items" ADD CONSTRAINT "generated_items_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_items" ADD CONSTRAINT "generated_items_source_folder_id_folders_id_fk" FOREIGN KEY ("source_folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_generated_item_id_generated_items_id_fk" FOREIGN KEY ("generated_item_id") REFERENCES "public"."generated_items"("id") ON DELETE cascade ON UPDATE no action;