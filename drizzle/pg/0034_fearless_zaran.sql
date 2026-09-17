ALTER TABLE "app_settings" ADD COLUMN "cli_trusted_mode_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "course_id" integer;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "attachments" text;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;