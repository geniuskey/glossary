ALTER TABLE "wiki_pages" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "wiki_pages_tags_idx" ON "wiki_pages" USING gin ("tags");