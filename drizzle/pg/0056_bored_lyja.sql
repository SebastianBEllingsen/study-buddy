CREATE TABLE "source_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"source_keys_json" text DEFAULT '[]' NOT NULL,
	"result_json" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "trust" text DEFAULT 'official' NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "generation_source" text;--> statement-breakpoint
ALTER TABLE "source_checks" ADD CONSTRAINT "source_checks_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_source_checks_course_id" ON "source_checks" USING btree ("course_id");