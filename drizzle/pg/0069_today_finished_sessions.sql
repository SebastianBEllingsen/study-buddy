CREATE TABLE "today_finished_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"steps" integer NOT NULL,
	"focus_ms" integer NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_today_finished_sessions_date" ON "today_finished_sessions" USING btree ("date");