CREATE TABLE "quiz_generation_presets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"single_choice" boolean DEFAULT true NOT NULL,
	"multiple_choice" boolean DEFAULT false NOT NULL,
	"short_answer" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL
);
