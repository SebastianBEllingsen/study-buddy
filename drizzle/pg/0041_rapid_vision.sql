ALTER TABLE "app_settings" ADD COLUMN "folder_chips" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "show_practice" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "folder_chips" text;