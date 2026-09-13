ALTER TABLE "app_settings" ADD COLUMN "show_model_badge" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "generated_items" ADD COLUMN "model_provider" text;--> statement-breakpoint
ALTER TABLE "generated_items" ADD COLUMN "model_name" text;