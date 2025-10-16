import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8787),
  DATABASE_URL: z.string().default('postgres://app:app@postgres:5432/app'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1-nano'),
  TAVILY_API_KEY: z.string().optional(),
  SCW_ACCESS_KEY: z.string().optional(),
  SCW_SECRET_KEY: z.string().optional(),
  S3_BUCKET_NAME: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  SCW_DEFAULT_ORGANIZATION_ID: z.string().optional(),
  SCW_DEFAULT_PROJECT_ID: z.string().optional(),
  SCW_NAMESPACE_ID: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  AUTH_CALLBACK_BASE_URL: z.string().optional(),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173,http://ui:5173,https://*.sent-tech.ca'),
  // WebAuthn Configuration
  WEBAUTHN_RP_ID: z.string().optional(),
  WEBAUTHN_RP_NAME: z.string().optional(),
  WEBAUTHN_ORIGIN: z.string().optional(),
  WEBAUTHN_TIMEOUT_REGISTRATION: z.string().optional(),
  WEBAUTHN_TIMEOUT_AUTHENTICATION: z.string().optional(),
  WEBAUTHN_ATTESTATION: z.enum(['none', 'indirect', 'direct']).optional(),
  // JWT Configuration
  JWT_SECRET: z.string().optional(),
  // Admin Configuration
  ADMIN_EMAIL: z.string().email().optional(),
  // Test Configuration
  DISABLE_RATE_LIMIT: z.string().optional()
});

export type AppEnv = z.infer<typeof envSchema>;

export const env: AppEnv = envSchema.parse(process.env);
