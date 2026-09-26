ALTER TABLE "mock_exam_attempts" ADD COLUMN "paused_at" text;--> statement-breakpoint
ALTER TABLE "mock_exam_attempts" ADD COLUMN "paused_seconds" integer DEFAULT 0 NOT NULL;