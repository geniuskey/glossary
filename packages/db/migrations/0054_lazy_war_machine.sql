CREATE TABLE "term_batch_receipts" (
	"actor" text NOT NULL,
	"batch_key" text NOT NULL,
	"row_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "term_batch_receipts_pk" PRIMARY KEY("actor","batch_key","row_key")
);
