import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8787),
  DATABASE_URL: z.string().default('sqlite:///data/app.db'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5'),
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
  AUTH_CALLBACK_BASE_URL: z.string().optional()
});

export type AppEnv = z.infer<typeof envSchema>;

export const env: AppEnv = envSchema.parse(process.env);
