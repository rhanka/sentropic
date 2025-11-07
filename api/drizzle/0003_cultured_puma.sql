CREATE TABLE IF NOT EXISTS "email_verification_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"email" text NOT NULL,
	"verification_token" text,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "email_verification_codes_verification_token_unique" UNIQUE("verification_token")
);
--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_verification_codes_expires_at_idx" ON "email_verification_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_verification_codes_email_idx" ON "email_verification_codes" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_verification_codes_verification_token_idx" ON "email_verification_codes" USING btree ("verification_token");