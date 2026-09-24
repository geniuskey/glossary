DROP INDEX "wiki_page_terms_role_idx";--> statement-breakpoint
ALTER TABLE "wiki_page_terms" DROP COLUMN "role";--> statement-breakpoint
DROP TYPE "public"."wiki_page_term_role";