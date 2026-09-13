CREATE TABLE "recent_views" (
	"item_type" text NOT NULL,
	"item_id" integer NOT NULL,
	"viewed_at" text NOT NULL,
	CONSTRAINT "recent_views_item_type_item_id_pk" PRIMARY KEY("item_type","item_id")
);
