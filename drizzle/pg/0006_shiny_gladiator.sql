ALTER TABLE "app_settings" ADD COLUMN "google_client_id" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "google_client_secret" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "google_access_token" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "google_refresh_token" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "google_token_expiry" text;