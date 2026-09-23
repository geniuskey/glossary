ALTER TABLE "business_categories" ALTER COLUMN "label_en" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "label_en" text;--> statement-breakpoint
CREATE UNIQUE INDEX "domains_label_en_unique" ON "domains" USING btree ("label_en");