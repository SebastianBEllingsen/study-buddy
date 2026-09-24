ALTER TABLE "calendar_feeds" ADD COLUMN "own_calendar" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD COLUMN "calendar_config" text;