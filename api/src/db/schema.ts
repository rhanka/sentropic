import { boolean, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const companies = pgTable('companies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  industry: text('industry'),
  size: text('size'),
  products: text('products'),
  processes: text('processes'),
  challenges: text('challenges'),
  objectives: text('objectives'),
  technologies: text('technologies'),
  status: text('status').default('completed'), // 'draft', 'enriching', 'completed'
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow()
});

export const folders = pgTable('folders', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  companyId: text('company_id').references(() => companies.id),
  matrixConfig: text('matrix_config'),
  executiveSummary: text('executive_summary'), // JSON string with 4 sections: { introduction, analyse, recommandation, synthese_executive }
  status: text('status').default('completed'), // 'generating', 'completed'
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow()
});

export const useCases = pgTable('use_cases', {
  // === GESTION D'ÉTAT ===
  id: text('id').primaryKey(),
  folderId: text('folder_id')
    .notNull()
    .references(() => folders.id, { onDelete: 'cascade' }),
  companyId: text('company_id').references(() => companies.id),
  status: text('status').default('completed'), // 'draft', 'generating', 'detailing', 'completed'
  model: text('model'), // Model used for generation (e.g., 'gpt-5', 'gpt-4.1-nano') - nullable, uses default from settings
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow(),
  
  // === CHAMPS FRÉQUEMMENT ACCÉDÉS EN MASSE (performance) ===
  name: text('name').notNull(), // Colonne native pour requêtes rapides
  description: text('description'), // Colonne native pour requêtes rapides (description courte 30-60 caractères)
  
  // === DONNÉES MÉTIER (tout dans JSONB pour flexibilité) ===
  data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
  
  // === COLONNES MÉTIER À MIGRER (temporaires, seront supprimées après migration) ===
  process: text('process'),
  domain: text('domain'),
  technologies: text('technologies'),
  prerequisites: text('prerequisites'),
  deadline: text('deadline'),
  contact: text('contact'),
  benefits: text('benefits'),
  metrics: text('metrics'),
  risks: text('risks'),
  nextSteps: text('next_steps'),
  dataSources: text('data_sources'),
  dataObjects: text('data_objects'),
  references: text('references'),
  valueScores: text('value_scores'),
  complexityScores: text('complexity_scores')
  // Note: totalValueScore et totalComplexityScore supprimés (champs calculés)
});

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow()
});

export const businessConfig = pgTable('business_config', {
  id: text('id').primaryKey(),
  sectors: text('sectors'),
  processes: text('processes')
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  provider: text('provider'),
  profile: text('profile'),
  userId: text('user_id'),
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow(),
  expiresAt: text('expires_at')
});

export const jobQueue = pgTable('job_queue', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'use_case_list' | 'use_case_detail'
  status: text('status').notNull().default('pending'), // 'pending' | 'processing' | 'completed' | 'failed'
  data: text('data').notNull(), // JSON string
  result: text('result'), // JSON string
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow(),
  startedAt: text('started_at'),
  completedAt: text('completed_at')
});

// WebAuthn Authentication Tables
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique(),
  displayName: text('display_name'),
  role: text('role').notNull().default('guest'), // 'admin_app' | 'admin_org' | 'editor' | 'guest'
  emailVerified: boolean('email_verified').notNull().default(false), // Email verification required before WebAuthn registration
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow()
});

export const webauthnCredentials = pgTable('webauthn_credentials', {
  id: text('id').primaryKey(),
  credentialId: text('credential_id').notNull().unique(), // base64url-encoded
  publicKeyCose: text('public_key_cose').notNull(), // base64url-encoded COSE public key
  counter: integer('counter').notNull().default(0),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  deviceName: text('device_name').notNull(),
  transportsJson: text('transports_json'), // JSON-encoded array
  uv: boolean('uv').notNull().default(false), // user verification
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: false })
}, (table) => ({
  userIdIdx: index('webauthn_credentials_user_id_idx').on(table.userId),
}));

export const userSessions = pgTable('user_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sessionTokenHash: text('session_token_hash').notNull().unique(),
  refreshTokenHash: text('refresh_token_hash').unique(),
  deviceName: text('device_name'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  mfaVerified: boolean('mfa_verified').notNull().default(false),
  expiresAt: timestamp('expires_at', { withTimezone: false }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: false }).defaultNow()
}, (table) => ({
  userIdIdx: index('user_sessions_user_id_idx').on(table.userId),
  expiresAtIdx: index('user_sessions_expires_at_idx').on(table.expiresAt),
}));

export const webauthnChallenges = pgTable('webauthn_challenges', {
  id: text('id').primaryKey(),
  challenge: text('challenge').notNull().unique(), // base64url-encoded
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }), // nullable for registration
  type: text('type').notNull(), // 'registration' | 'authentication'
  expiresAt: timestamp('expires_at', { withTimezone: false }).notNull(),
  used: boolean('used').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow()
}, (table) => ({
  expiresAtIdx: index('webauthn_challenges_expires_at_idx').on(table.expiresAt),
  userIdIdx: index('webauthn_challenges_user_id_idx').on(table.userId),
}));

export const magicLinks = pgTable('magic_links', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  email: text('email').notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }), // nullable for new users
  expiresAt: timestamp('expires_at', { withTimezone: false }).notNull(),
  used: boolean('used').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow()
}, (table) => ({
  expiresAtIdx: index('magic_links_expires_at_idx').on(table.expiresAt),
  emailIdx: index('magic_links_email_idx').on(table.email),
}));

export const emailVerificationCodes = pgTable('email_verification_codes', {
  id: text('id').primaryKey(),
  codeHash: text('code_hash').notNull(), // SHA-256 hash of the 6-digit code
  email: text('email').notNull(),
  verificationToken: text('verification_token').unique(), // Token returned after code verification, used for registration
  expiresAt: timestamp('expires_at', { withTimezone: false }).notNull(),
  used: boolean('used').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow()
}, (table) => ({
  expiresAtIdx: index('email_verification_codes_expires_at_idx').on(table.expiresAt),
  emailIdx: index('email_verification_codes_email_idx').on(table.email),
  verificationTokenIdx: index('email_verification_codes_verification_token_idx').on(table.verificationToken),
}));

export type CompanyRow = typeof companies.$inferSelect;
export type FolderRow = typeof folders.$inferSelect;
export type UseCaseRow = typeof useCases.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
export type BusinessConfigRow = typeof businessConfig.$inferSelect;
export type JobQueueRow = typeof jobQueue.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type WebauthnCredentialRow = typeof webauthnCredentials.$inferSelect;
export type UserSessionRow = typeof userSessions.$inferSelect;
export type WebauthnChallengeRow = typeof webauthnChallenges.$inferSelect;
export type MagicLinkRow = typeof magicLinks.$inferSelect;
export type EmailVerificationCodeRow = typeof emailVerificationCodes.$inferSelect;
