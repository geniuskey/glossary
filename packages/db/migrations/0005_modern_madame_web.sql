CREATE TABLE IF NOT EXISTS "sso_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"button_label" text DEFAULT '회사 계정으로 로그인' NOT NULL,
	"issuer" text DEFAULT '' NOT NULL,
	"authorization_endpoint" text DEFAULT '' NOT NULL,
	"token_endpoint" text DEFAULT '' NOT NULL,
	"userinfo_endpoint" text DEFAULT '' NOT NULL,
	"client_id" text DEFAULT '' NOT NULL,
	"client_secret" text DEFAULT '' NOT NULL,
	"scopes" text[] DEFAULT '{"openid","profile","email"}' NOT NULL,
	"token_auth_method" text DEFAULT 'client_secret_post' NOT NULL,
	"base_url" text DEFAULT '' NOT NULL,
	"subject_claims" text[] DEFAULT '{"sub"}' NOT NULL,
	"email_claims" text[] DEFAULT '{"email","upn","mail"}' NOT NULL,
	"name_claims" text[] DEFAULT '{"name","displayName","preferred_username","given_name"}' NOT NULL,
	"group_claims" text[] DEFAULT '{"groups","roles"}' NOT NULL,
	"allowed_groups" text[] DEFAULT '{}' NOT NULL,
	"admin_groups" text[] DEFAULT '{}' NOT NULL,
	"auto_create" boolean DEFAULT true NOT NULL,
	"last_claim_keys" text[] DEFAULT '{}' NOT NULL,
	"last_login_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "sso_config_single_row" CHECK ("sso_config"."id" = 'default')
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sso_config" ADD CONSTRAINT "sso_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_external_id_unique" ON "users" USING btree ("external_id");