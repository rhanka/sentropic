import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().default(8787),
  DATABASE_URL: z.string().default('postgres://app:app@postgres:5432/app'),
  // Optional DB TLS knobs (used by db/client.ts)
  DB_SSL_REJECT_UNAUTHORIZED: z.string().optional(),
  DB_SSL_CA_PEM: z.string().optional(),
  DB_SSL_CA_PEM_B64: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  COHERE_API_KEY: z.string().optional(),
  // GCP (Gemini-on-GCP / Model Garden, formerly Vertex AI) — config, not secrets.
  // The bearer is minted server-side from ADC (Application Default Credentials);
  // project/location travel as plain config. The `gcp` provider is treated as
  // AVAILABLE only when both GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION are
  // present (gated like the other optional providers); absence never crashes the
  // app. (Provider id renamed vertex→gcp — user decision 2026-06-02, Vertex AI
  // brand retired; the endpoint host stays aiplatform.googleapis.com.)
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  GOOGLE_CLOUD_LOCATION: z.string().optional(),
  // ADC source for service-account JSON local-dev / SA-key UAT. Honored by
  // google-auth-library's GoogleAuth (workload identity needs no value).
  // Delivered natively via the docker-compose api-service env passthrough; in
  // dev/UAT point it at the gitignored SA key under the workspace bind-mount,
  // e.g. GOOGLE_APPLICATION_CREDENTIALS=/workspace/.secrets/gcp-sa.json.
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1-nano'),
  TAVILY_API_KEY: z.string().optional(),
  // ---------------------------------------------------------------------------
  // Document storage (S3-compatible: MinIO dev/test, Scaleway Object Storage prod)
  // ---------------------------------------------------------------------------
  DOC_STORAGE_BUCKET: z.string().optional(),
  DOC_STORAGE_ENDPOINT: z.string().optional(),
  DOC_STORAGE_REGION: z.string().optional(),
  DOC_STORAGE_ACCESS_KEY: z.string().optional(),
  DOC_STORAGE_SECRET_KEY: z.string().optional(),
  // Artifact store (BR-52): backend override ('s3' | 'local-fs'); auto-selects S3 when a
  // DOC_STORAGE_BUCKET is configured, else local-FS. ARTIFACT_FS_ROOT is the local-FS root.
  ARTIFACT_STORE_BACKEND: z.string().optional(),
  ARTIFACT_FS_ROOT: z.string().optional(),
  SCW_DEFAULT_ORGANIZATION_ID: z.string().optional(),
  SCW_DEFAULT_PROJECT_ID: z.string().optional(),
  SCW_NAMESPACE_ID: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // BR-39e Lot 1 — social LOGIN federation (RP to Google). DISTINCT from GOOGLE_CLIENT_ID/SECRET
  // above (those drive Google Drive OAuth / Picker). When client id+secret are absent the
  // federation provider is feature-OFF (the route answers "provider not configured"). The redirect
  // URI defaults to `<issuer>/auth/federation/google/callback` when unset; register that exact URL
  // in the Google console (prod: https://auth.sent-tech.ca/auth/federation/google/callback).
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional(),
  // BR-39e Lot 2 — social LOGIN federation (RP to GitHub, OAuth2 only). When client id+secret are
  // absent the federation provider is feature-OFF (the route answers "provider not configured"). The
  // redirect URI defaults to `<issuer>/auth/federation/github/callback` when unset; register that
  // exact URL as the GitHub OAuth App callback (prod:
  // https://auth.sent-tech.ca/auth/federation/github/callback).
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
  GITHUB_OAUTH_REDIRECT_URI: z.string().optional(),
  // BR-39e Lot 3 — social LOGIN federation (RP to Microsoft Entra ID). Client credentials absent
  // means feature-OFF. The redirect URI defaults to `<issuer>/auth/federation/microsoft/callback`;
  // the tenant endpoint accepts common/organizations/consumers/a concrete tenant id.
  MICROSOFT_OAUTH_CLIENT_ID: z.string().optional(),
  MICROSOFT_OAUTH_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_OAUTH_REDIRECT_URI: z.string().optional(),
  MICROSOFT_OAUTH_TENANT: z.string().default('common'),
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  AUTH_CALLBACK_BASE_URL: z.string().optional(),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default(
      'http://localhost:5173,http://127.0.0.1:5173,http://ui:5173,https://*.sent-tech.ca,chrome-extension://*,vscode-webview://*'
    ),
  CHROME_EXTENSION_DOWNLOAD_URL: z.string().optional(),
  CHROME_EXTENSION_VERSION: z.string().optional(),
  CHROME_EXTENSION_SOURCE: z.string().optional(),
  VSCODE_EXTENSION_DOWNLOAD_URL: z.string().optional(),
  VSCODE_EXTENSION_VERSION: z.string().optional(),
  VSCODE_EXTENSION_SOURCE: z.string().optional(),
  COWORK_DESKTOP_DOWNLOAD_URL: z.string().optional(),
  COWORK_DESKTOP_VERSION: z.string().optional(),
  COWORK_DESKTOP_SOURCE: z.string().optional(),
  // Prerelease channel (admin-selectable): the branch-built unsigned exe served
  // for UAT, distinct from the official RELEASE url above.
  COWORK_DESKTOP_PRERELEASE_URL: z.string().optional(),
  COWORK_DESKTOP_PRERELEASE_VERSION: z.string().optional(),
  // ---------------------------------------------------------------------------
  // Outbound email — Scaleway Transactional Email (TEM) HTTP API.
  // SMTP egress is blocked at the Kapsule platform level (BR37b-FL1), so mail
  // is sent via the TEM HTTP API. In dev/test the api targets the local
  // scw-tem-mock service which forwards to maildev over SMTP.
  // ---------------------------------------------------------------------------
  SCW_TEM_API_BASE_URL: z.string().default('https://api.scaleway.com'),
  SCW_TEM_REGION: z.string().default('fr-par'),
  SCW_TEM_PROJECT_ID: z.string().optional(),
  SCW_TEM_SECRET_KEY: z.string(),
  SCW_TEM_FROM_EMAIL: z.string().default('no-reply@sent-tech.ca'),
  SCW_TEM_FROM_NAME: z.string().default('Sentropic'),
  // WebAuthn Configuration
  WEBAUTHN_RP_ID: z.string().optional(),
  WEBAUTHN_RP_NAME: z.string().optional(),
  WEBAUTHN_ORIGIN: z.string().optional(),
  WEBAUTHN_TIMEOUT_REGISTRATION: z.string().optional(),
  WEBAUTHN_TIMEOUT_AUTHENTICATION: z.string().optional(),
  WEBAUTHN_ATTESTATION: z.enum(['none', 'indirect', 'direct']).optional(),
  // JWT Configuration
  JWT_SECRET: z.string().optional(),
  // OAuth2 / OIDC IdP Configuration
  OAUTH_SIGNING_KEK: z.string().optional(),
  OAUTH_ISSUER_URL: z.string().optional(),
  OAUTH_ACCESS_TOKEN_TTL_SEC: z.coerce.number().default(3600),
  OAUTH_ID_TOKEN_TTL_SEC: z.coerce.number().default(3600),
  OAUTH_AUTHORIZATION_CODE_TTL_SEC: z.coerce.number().default(60),
  OAUTH_DPOP_IAT_SKEW_SEC: z.coerce.number().default(60),
  // Service-to-service (client_credentials) — stateless tokens (BR39d-D5)
  OAUTH_SERVICE_ACCESS_TOKEN_TTL_SEC: z.coerce.number().default(900),
  OAUTH_SERVICE_RESOURCE_URI: z.string().optional(),
  // MCP resource server (BR-39l Lot 3) — activation-by-consumption of @sentropic/mcp-auth.
  // Default OFF: only the RFC 9728 PRM well-known + a sample guarded /api/v1/mcp/* surface
  // are mounted when explicitly enabled. MCP_RESOURCE_URI overrides the resource/audience
  // (defaults to the OAuth issuer URL).
  MCP_RESOURCE_SERVER_ENABLED: z.string().optional(),
  MCP_RESOURCE_URI: z.string().optional(),
  // Dev/test self-S2S dogfood client (BR39d-D10)
  OAUTH_SELF_SERVICE_CLIENT_ID: z.string().optional(),
  OAUTH_SELF_SERVICE_CLIENT_SECRET: z.string().optional(),
  // Admin Configuration
  ADMIN_EMAIL: z.string().email().optional(),
  // Test Configuration
  DISABLE_RATE_LIMIT: z.string().optional(),
  HTTP_LOG: z.string().default('true'),

  // Chat tracing (debug / audit)
  // Store OpenAI payloads + tool calls for troubleshooting loops.
  CHAT_TRACE_ENABLED: z.string().optional(),
  CHAT_TRACE_RETENTION_DAYS: z.coerce.number().optional(),

  // Queue reaper (WI-1) — stranded-processing recovery.
  // QUEUE_REAPER_STALE_MINUTES: jobs in 'processing' older than this are reaped.
  // QUEUE_MAX_REDELIVERIES: maximum reap-requeue cycles before a job is marked failed.
  QUEUE_REAPER_STALE_MINUTES: z.coerce.number().optional(),
  QUEUE_MAX_REDELIVERIES: z.coerce.number().optional(),

  // Stream events retention (WI-2) — chat_stream_events purge.
  // STREAM_RETENTION_DAYS: events older than this are deleted in batches.
  STREAM_RETENTION_DAYS: z.coerce.number().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

export const env: AppEnv = (() => {
  const parsed = envSchema.parse(process.env);
  // TEM project id falls back to the shared Scaleway default project when unset.
  if (!parsed.SCW_TEM_PROJECT_ID && parsed.SCW_DEFAULT_PROJECT_ID) {
    parsed.SCW_TEM_PROJECT_ID = parsed.SCW_DEFAULT_PROJECT_ID;
  }
  // Tests execute a lot of auth requests quickly; default to disabling auth rate limiting in test env
  // unless explicitly overridden.
  if (parsed.NODE_ENV === 'test' && !parsed.DISABLE_RATE_LIMIT) {
    return { ...parsed, DISABLE_RATE_LIMIT: 'true' };
  }
  // Defaults for chat tracing
  if (!parsed.CHAT_TRACE_RETENTION_DAYS) {
    return { ...parsed, CHAT_TRACE_RETENTION_DAYS: 7 };
  }
  return parsed;
})();

export const isE2eProductionImageRuntime = (value: AppEnv = env): boolean =>
  value.NODE_ENV === 'production' &&
  value.DISABLE_RATE_LIMIT === 'true' &&
  value.ADMIN_EMAIL === 'e2e-admin@example.com';

export const requiresOAuthProductionSecrets = (value: AppEnv = env): boolean =>
  value.NODE_ENV === 'production' && !isE2eProductionImageRuntime(value);
