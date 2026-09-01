CREATE TYPE "public"."sso_protocol" AS ENUM('oidc', 'oauth2');--> statement-breakpoint
ALTER TABLE "sso_config" ADD COLUMN "protocol" "sso_protocol" DEFAULT 'oidc' NOT NULL;--> statement-breakpoint
ALTER TABLE "sso_config" ADD COLUMN "jwks_uri" text DEFAULT '' NOT NULL;