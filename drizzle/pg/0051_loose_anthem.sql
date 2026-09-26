CREATE TABLE "concepts" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"chapter_id" integer,
	"name" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mistakes" (
	"id" serial PRIMARY KEY NOT NULL,
	"generated_item_id" integer NOT NULL,
	"review_item_id" integer,
	"concept_id" integer,
	"kind" text NOT NULL,
	"item_index" integer NOT NULL,
	"prompt" text NOT NULL,
	"given_answer" text,
	"correct_answer" text NOT NULL,
	"confidence" text,
	"misconception" text,
	"created_at" text NOT NULL,
	"resolved_at" text
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"generated_item_id" integer NOT NULL,
	"kind" text NOT NULL,
	"item_index" integer NOT NULL,
	"concept_id" integer,
	"due_at" text NOT NULL,
	"stability" real DEFAULT 0 NOT NULL,
	"difficulty" real DEFAULT 0 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"state" integer DEFAULT 0 NOT NULL,
	"scheduled_days" integer DEFAULT 0 NOT NULL,
	"last_reviewed_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_item_id" integer NOT NULL,
	"rating" integer NOT NULL,
	"confidence" text,
	"source" text NOT NULL,
	"correct" boolean NOT NULL,
	"reviewed_at" text NOT NULL,
	"stability" real NOT NULL,
	"difficulty" real NOT NULL,
	"scheduled_days" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "review_retention" real;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "new_cards_per_day" integer;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "fsrs_migrated_at" text;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_chapter_id_study_plan_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."study_plan_chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistakes" ADD CONSTRAINT "mistakes_generated_item_id_generated_items_id_fk" FOREIGN KEY ("generated_item_id") REFERENCES "public"."generated_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistakes" ADD CONSTRAINT "mistakes_review_item_id_review_items_id_fk" FOREIGN KEY ("review_item_id") REFERENCES "public"."review_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistakes" ADD CONSTRAINT "mistakes_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_generated_item_id_generated_items_id_fk" FOREIGN KEY ("generated_item_id") REFERENCES "public"."generated_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_review_item_id_review_items_id_fk" FOREIGN KEY ("review_item_id") REFERENCES "public"."review_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_concepts_course_id" ON "concepts" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "idx_mistakes_generated_item_id" ON "mistakes" USING btree ("generated_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_review_items_item_kind_index" ON "review_items" USING btree ("generated_item_id","kind","item_index");--> statement-breakpoint
CREATE INDEX "idx_review_items_due_at" ON "review_items" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "idx_review_logs_review_item_id" ON "review_logs" USING btree ("review_item_id");--> statement-breakpoint
CREATE INDEX "idx_review_logs_reviewed_at" ON "review_logs" USING btree ("reviewed_at");