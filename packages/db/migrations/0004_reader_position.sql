ALTER TABLE "readings" DROP CONSTRAINT "readings_last_finished_chapter_id_chapters_id_fk";
--> statement-breakpoint
ALTER TABLE "lookup_history" ADD COLUMN "alias_id" uuid;--> statement-breakpoint
ALTER TABLE "readings" ADD COLUMN "current_book_id" uuid;--> statement-breakpoint
ALTER TABLE "readings" ADD COLUMN "last_finished_chapter_index" integer;--> statement-breakpoint
ALTER TABLE "lookup_history" ADD CONSTRAINT "lookup_history_alias_id_aliases_id_fk" FOREIGN KEY ("alias_id") REFERENCES "public"."aliases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_current_book_id_books_id_fk" FOREIGN KEY ("current_book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" DROP COLUMN "last_finished_chapter_id";