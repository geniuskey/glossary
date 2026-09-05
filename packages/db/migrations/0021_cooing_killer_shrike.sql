CREATE TYPE "public"."sso_mode" AS ENUM('disabled', 'oidc', 'oauth2', 'oauth2-proxy');--> statement-breakpoint
ALTER TABLE "sso_config" ADD COLUMN "mode" "sso_mode";
