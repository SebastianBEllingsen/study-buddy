ALTER TABLE "documents" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generated_items" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;