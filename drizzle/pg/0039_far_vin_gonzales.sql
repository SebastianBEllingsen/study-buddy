CREATE TABLE "canvases" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"data" text DEFAULT '{"nodes":[],"edges":[]}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_canvases_course_id" ON "canvases" USING btree ("course_id");