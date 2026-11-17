CREATE TABLE "term_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_id" uuid NOT NULL,
	"parent_id" uuid,
	"author_id" uuid,
	"body" text NOT NULL,
	"mentioned_user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "term_comments_not_self_parent" CHECK ("term_comments"."parent_id" is null or "term_comments"."parent_id" <> "term_comments"."id")
);
--> statement-breakpoint
ALTER TABLE "term_comments" ADD CONSTRAINT "term_comments_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_comments" ADD CONSTRAINT "term_comments_parent_id_term_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."term_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_comments" ADD CONSTRAINT "term_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "term_comments_term_idx" ON "term_comments" USING btree ("term_id","created_at");--> statement-breakpoint
CREATE INDEX "term_comments_parent_idx" ON "term_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "term_comments_mentions_idx" ON "term_comments" USING gin ("mentioned_user_ids");