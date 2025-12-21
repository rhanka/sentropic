import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Workspace constants (keep stable IDs for migrations/backfills)
export const ADMIN_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').unique(), // nullable is allowed; unique permits multiple NULLs in Postgres
  name: text('name').notNull(),
  shareWithAdmin: boolean('share_with_admin').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
});

export const companies = pgTable('companies', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id)
    .default(ADMIN_WORKSPACE_ID),
  name: text('name').notNull(),
  industry: text('industry'),
  size: text('size'),
  products: text('products'),
  processes: text('processes'),
  challenges: text('challenges'),
  objectives: text('objectives'),
  technologies: text('technologies'),
  status: text('status').default('completed'), // 'draft', 'enriching', 'completed'
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow()
});

export const folders = pgTable('folders', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id)
    .default(ADMIN_WORKSPACE_ID),
  name: text('name').notNull(),
  description: text('description'),
  companyId: text('company_id').references(() => companies.id),
  matrixConfig: text('matrix_config'),
  executiveSummary: text('executive_summary'), // JSON string with 4 sections: { introduction, analyse, recommandation, synthese_executive }
  status: text('status').default('completed'), // 'generating', 'completed'
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow()
});

export const useCases = pgTable('use_cases', {
  // === GESTION D'ÉTAT ===
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id)
    .default(ADMIN_WORKSPACE_ID),
  folderId: text('folder_id')
    .notNull()
    .references(() => folders.id, { onDelete: 'cascade' }),
  companyId: text('company_id').references(() => companies.id),
  status: text('status').default('completed'), // 'draft', 'generating', 'detailing', 'completed'
  model: text('model'), // Model used for generation (e.g., 'gpt-5', 'gpt-4.1-nano') - nullable, uses default from settings
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  
  // === DONNÉES MÉTIER (tout dans JSONB, y compris name, description, et toutes les autres colonnes métier) ===
  // Toutes les colonnes métier (name, description, process, domain, technologies, etc.) ont été migrées vers data JSONB
  // et supprimées de la table (migration 0008)
  data: jsonb('data').notNull().default(sql`'{}'::jsonb`)
  // Note: totalValueScore et totalComplexityScore supprimés (champs calculés dynamiquement)
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
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  expiresAt: text('expires_at')
});

export const jobQueue = pgTable('job_queue', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'use_case_list' | 'use_case_detail'
  status: text('status').notNull().default('pending'), // 'pending' | 'processing' | 'completed' | 'failed'
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id)
    .default(ADMIN_WORKSPACE_ID),
  data: text('data').notNull(), // JSON string
  result: text('result'), // JSON string
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  startedAt: text('started_at'),
  completedAt: text('completed_at')
});

// WebAuthn Authentication Tables
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique(),
  displayName: text('display_name'),
  role: text('role').notNull().default('guest'), // 'admin_app' | 'admin_org' | 'editor' | 'guest'
  accountStatus: text('account_status').notNull().default('active'),
  approvalDueAt: timestamp('approval_due_at', { withTimezone: false }),
  approvedAt: timestamp('approved_at', { withTimezone: false }),
  approvedByUserId: text('approved_by_user_id').references(() => users.id),
  disabledAt: timestamp('disabled_at', { withTimezone: false }),
  disabledReason: text('disabled_reason'),
  emailVerified: boolean('email_verified').notNull().default(false), // Email verification required before WebAuthn registration
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
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
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
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
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
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
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow()
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
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow()
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
export type WorkspaceRow = typeof workspaces.$inferSelect;
// Chatbot Tables (Lot A)
export const chatSessions = pgTable('chat_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  primaryContextType: text('primary_context_type'), // 'company' | 'folder' | 'usecase' | 'executive_summary'
  primaryContextId: text('primary_context_id'),
  title: text('title'),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow()
}, (table) => ({
  userIdIdx: index('chat_sessions_user_id_idx').on(table.userId),
  primaryContextIdx: index('chat_sessions_primary_context_idx').on(table.primaryContextType, table.primaryContextId),
}));

export const chatMessages = pgTable('chat_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => chatSessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant' | 'system' | 'tool'
  content: text('content'), // nullable for tool calls
  toolCalls: jsonb('tool_calls'), // array of tool calls OpenAI
  toolCallId: text('tool_call_id'), // ID du tool call si ce message est un résultat d'outil
  reasoning: text('reasoning'), // Tokens de reasoning (pour modèles avec reasoning)
  model: text('model'), // Modèle OpenAI utilisé
  promptId: text('prompt_id'), // ID du prompt utilisé (nullable pour sessions informelles)
  promptVersionId: text('prompt_version_id'), // Version précise du prompt (nullable pour sessions informelles)
  sequence: integer('sequence').notNull(), // Ordre du message dans la conversation
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow()
}, (table) => ({
  sessionIdIdx: index('chat_messages_session_id_idx').on(table.sessionId),
  sequenceIdx: index('chat_messages_sequence_idx').on(table.sessionId, table.sequence),
  promptVersionIdIdx: index('chat_messages_prompt_version_id_idx').on(table.promptVersionId),
}));

export const chatContexts = pgTable('chat_contexts', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => chatSessions.id, { onDelete: 'cascade' }),
  contextType: text('context_type').notNull(), // 'company' | 'folder' | 'usecase' | 'executive_summary'
  contextId: text('context_id').notNull(), // ID de l'objet modifié
  snapshotBefore: jsonb('snapshot_before'), // État de l'objet avant modification
  snapshotAfter: jsonb('snapshot_after'), // État de l'objet après modification
  modifications: jsonb('modifications'), // Détail des champs modifiés et leurs valeurs
  modifiedAt: timestamp('modified_at', { withTimezone: false }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow()
}, (table) => ({
  sessionIdIdx: index('chat_contexts_session_id_idx').on(table.sessionId),
  contextIdx: index('chat_contexts_context_idx').on(table.contextType, table.contextId),
  contextTypeIdIdx: index('chat_contexts_context_type_id_idx').on(table.contextType, table.contextId),
}));

export const chatStreamEvents = pgTable('chat_stream_events', {
  id: text('id').primaryKey(),
  messageId: text('message_id').references(() => chatMessages.id, { onDelete: 'cascade' }), // nullable pour appels structurés
  streamId: text('stream_id').notNull(), // Identifiant du stream
  eventType: text('event_type').notNull(), // 'content_delta' | 'reasoning_delta' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_result' | 'status' | 'error' | 'done'
  data: jsonb('data').notNull(), // Données de l'événement
  sequence: integer('sequence').notNull(), // Ordre des événements pour ce stream
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow()
}, (table) => ({
  messageIdIdx: index('chat_stream_events_message_id_idx').on(table.messageId),
  streamIdIdx: index('chat_stream_events_stream_id_idx').on(table.streamId),
  sequenceIdx: index('chat_stream_events_sequence_idx').on(table.streamId, table.sequence),
  streamIdSequenceUnique: uniqueIndex('chat_stream_events_stream_id_sequence_unique').on(table.streamId, table.sequence),
}));

export const contextModificationHistory = pgTable('context_modification_history', {
  id: text('id').primaryKey(),
  contextType: text('context_type').notNull(), // 'company' | 'folder' | 'usecase' | 'executive_summary'
  contextId: text('context_id').notNull(), // ID de l'objet modifié
  sessionId: text('session_id').references(() => chatSessions.id, { onDelete: 'set null' }), // nullable si modification non liée à une session
  messageId: text('message_id').references(() => chatMessages.id, { onDelete: 'set null' }), // nullable
  field: text('field').notNull(), // Nom du champ modifié (ex: 'name', 'description', 'data.description')
  oldValue: jsonb('old_value'), // Ancienne valeur
  newValue: jsonb('new_value'), // Nouvelle valeur
  toolCallId: text('tool_call_id'), // ID du tool call si modification via tool
  promptId: text('prompt_id'), // ID du prompt utilisé (obligatoire pour appels structurés, nullable pour sessions informelles)
  promptType: text('prompt_type'), // Type de prompt pour les appels structurés (nullable pour sessions informelles)
  promptVersionId: text('prompt_version_id'), // Version exacte du prompt (obligatoire pour appels structurés, nullable pour sessions informelles)
  jobId: text('job_id').references(() => jobQueue.id, { onDelete: 'set null' }), // Job de génération (appels structurés)
  sequence: integer('sequence').notNull(), // Ordre des modifications pour cet objet
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow()
}, (table) => ({
  contextIdx: index('context_modification_history_context_idx').on(table.contextType, table.contextId),
  sessionIdIdx: index('context_modification_history_session_id_idx').on(table.sessionId),
  sequenceIdx: index('context_modification_history_sequence_idx').on(table.contextType, table.contextId, table.sequence),
}));

export type UserRow = typeof users.$inferSelect;
export type WebauthnCredentialRow = typeof webauthnCredentials.$inferSelect;
export type UserSessionRow = typeof userSessions.$inferSelect;
export type WebauthnChallengeRow = typeof webauthnChallenges.$inferSelect;
export type MagicLinkRow = typeof magicLinks.$inferSelect;
export type EmailVerificationCodeRow = typeof emailVerificationCodes.$inferSelect;
export type ChatSessionRow = typeof chatSessions.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type ChatContextRow = typeof chatContexts.$inferSelect;
export type ChatStreamEventRow = typeof chatStreamEvents.$inferSelect;
export type ContextModificationHistoryRow = typeof contextModificationHistory.$inferSelect;
