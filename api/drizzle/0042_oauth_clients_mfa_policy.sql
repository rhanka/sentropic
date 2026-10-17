-- B3+C1: per-client MFA policy on the authorization_code flow.
-- Additive, backward-compatible: NULL required_acr = no policy (existing clients
-- keep bearer-accepting behavior); '{}' allowed_user_ids = no restriction.
-- A policy client (`required_acr = 'urn:sentropic:loa:passkey-fresh'`) forces
-- re-authentication at authorize and refuses bearer sessions (magic-link,
-- federation) with `access_denied`; a non-empty allowlist refuses non-listed
-- subjects with `access_denied` before consent.
ALTER TABLE "oauth_clients" ADD COLUMN IF NOT EXISTS "required_acr" text;
--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN IF NOT EXISTS "allowed_user_ids" text[] DEFAULT '{}' NOT NULL;
