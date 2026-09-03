DO $$ BEGIN
 IF (SELECT count(*) FROM "domains") > 72 THEN
  RAISE EXCEPTION 'domain color palette supports up to 72 domains';
 END IF;
END $$;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "color" text;--> statement-breakpoint
WITH ranked AS (
 SELECT "key", row_number() OVER (ORDER BY "sort_order", "key") - 1 AS color_index
 FROM "domains"
)
UPDATE "domains" AS domain
SET "color" = 'p' || lpad(ranked.color_index::text, 2, '0')
FROM ranked
WHERE domain."key" = ranked."key";--> statement-breakpoint
ALTER TABLE "domains" ALTER COLUMN "color" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "domains_color_unique" ON "domains" USING btree ("color");
