UPDATE "folders" SET "parent_folder_id" = NULL WHERE "parent_folder_id" IN (SELECT "id" FROM "folders" WHERE "is_master" = true);
--> statement-breakpoint
DELETE FROM "folders" WHERE "is_master" = true;
--> statement-breakpoint
ALTER TABLE "folders" DROP COLUMN "is_master";
