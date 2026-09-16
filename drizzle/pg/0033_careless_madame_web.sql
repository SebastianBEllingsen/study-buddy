CREATE INDEX "idx_chat_messages_conversation_id" ON "chat_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_documents_course_id" ON "documents" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "idx_documents_folder_id" ON "documents" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "idx_flashcard_reviews_item_id" ON "flashcard_reviews" USING btree ("generated_item_id");--> statement-breakpoint
CREATE INDEX "idx_folders_course_id" ON "folders" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "idx_generated_items_course_id" ON "generated_items" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "idx_generated_items_folder_id" ON "generated_items" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "idx_generated_items_source_folder_id" ON "generated_items" USING btree ("source_folder_id");--> statement-breakpoint
CREATE INDEX "idx_notes_course_id" ON "notes" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "idx_notes_folder_id" ON "notes" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "idx_quiz_attempts_item_id" ON "quiz_attempts" USING btree ("generated_item_id");--> statement-breakpoint
CREATE INDEX "idx_uploaded_images_kind" ON "uploaded_images" USING btree ("kind");