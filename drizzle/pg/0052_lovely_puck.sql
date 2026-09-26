CREATE TABLE "exam_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"source_document_ids_json" text DEFAULT '[]' NOT NULL,
	"profile_json" text NOT NULL,
	"model_provider" text,
	"model_name" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "exam_profiles_course_id_unique" UNIQUE("course_id")
);
--> statement-breakpoint
CREATE TABLE "mock_exam_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"mock_exam_id" integer NOT NULL,
	"status" text NOT NULL,
	"answers_json" text DEFAULT '[]' NOT NULL,
	"results_json" text,
	"score" real,
	"error_message" text,
	"started_at" text NOT NULL,
	"submitted_at" text
);
--> statement-breakpoint
CREATE TABLE "mock_exams" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"title" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"total_points" real NOT NULL,
	"tasks_json" text NOT NULL,
	"practice_item_id" integer,
	"model_provider" text,
	"model_name" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_profiles" ADD CONSTRAINT "exam_profiles_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_exam_attempts" ADD CONSTRAINT "mock_exam_attempts_mock_exam_id_mock_exams_id_fk" FOREIGN KEY ("mock_exam_id") REFERENCES "public"."mock_exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_exams" ADD CONSTRAINT "mock_exams_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_exams" ADD CONSTRAINT "mock_exams_practice_item_id_generated_items_id_fk" FOREIGN KEY ("practice_item_id") REFERENCES "public"."generated_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_mock_exam_attempts_exam_id" ON "mock_exam_attempts" USING btree ("mock_exam_id");--> statement-breakpoint
CREATE INDEX "idx_mock_exams_course_id" ON "mock_exams" USING btree ("course_id");