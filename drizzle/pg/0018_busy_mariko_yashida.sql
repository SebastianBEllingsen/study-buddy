CREATE TABLE "generation_notifications" (
	"generated_item_id" integer PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "auto_open_generated_items" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_notifications" ADD CONSTRAINT "generation_notifications_generated_item_id_generated_items_id_fk" FOREIGN KEY ("generated_item_id") REFERENCES "public"."generated_items"("id") ON DELETE cascade ON UPDATE no action;