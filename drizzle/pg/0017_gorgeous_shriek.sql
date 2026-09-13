CREATE TABLE "uploaded_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"data_url" text NOT NULL,
	"created_at" text NOT NULL
);
