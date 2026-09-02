CREATE TABLE IF NOT EXISTS "domains" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "domains_label_unique" ON "domains" USING btree ("label");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "domains_order_idx" ON "domains" USING btree ("sort_order","key");--> statement-breakpoint
WITH existing_domains AS (
	SELECT DISTINCT btrim(value) AS label
	FROM "terms"
	CROSS JOIN LATERAL unnest("terms"."domain") AS value
	WHERE btrim(value) <> ''
), ordered_domains AS (
	SELECT label, row_number() OVER (ORDER BY label) - 1 AS sort_order
	FROM existing_domains
)
INSERT INTO "domains" ("key", "label", "sort_order")
SELECT 'domain-' || substr(md5(label), 1, 16), label, sort_order
FROM ordered_domains
ON CONFLICT ("label") DO NOTHING;
