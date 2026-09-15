ALTER TABLE "app_settings" ADD COLUMN "document_badges_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "document_badge_detail" text;