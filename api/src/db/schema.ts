import { boolean, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Workspace constants (keep stable IDs for migrations/backfills)
export const ADMIN_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id'), // nullable; UNIQUE constraint removed to allow multiple workspaces per user
  name: text('name').notNull(),
  hiddenAt: timestamp('hidden_at', { withTimezone: false }), // nullable; timestamp when workspace was hidden
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
});

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id)
    .default(ADMIN_WORKSPACE_ID),
  name: text('name').notNull(),
  status: text('status').default('completed'), // 'draft', 'enriching', 'completed'
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
  // Business fields moved to JSONB to avoid schema churn (similar to use_cases.data)
  // Suggested structure (non-exhaustive):
  // - industry, size, products, processes, challenges, objectives, technologies
  // - kpis: string (markdown)
  // - references: { title, url, excerpt? }[]
  data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
});

export const folders = pgTable('folders', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id)
    .default(ADMIN_WORKSPACE_ID),
  name: text('name').notNull(),
  description: text('description'),
  organizationId: text('organization_id').references(() => organizations.id),
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
  organizationId: text('organization_id').references(() => organizations.id),
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
  key: text('key').notNull(),
  userId: text('user_id'),
  value: text('value'),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow()
}, (table) => ({
  keyIdx: index('settings_key_idx').on(table.key),
  userIdIdx: index('settings_user_id_idx').on(table.userId),
  userKeyIdx: index('settings_user_key_idx').on(table.userId, table.key),
}));

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
  // Self-FK: define via table callback below to avoid TS self-referential initializer inference issues.
  approvedByUserId: text('approved_by_user_id'),
  disabledAt: timestamp('disabled_at', { withTimezone: false }),
  disabledReason: text('disabled_reason'),
  emailVerified: boolean('email_verified').notNull().default(false), // Email verification required before WebAuthn registration
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow()
}, (table) => ({
  approvedByUserIdFk: foreignKey({
    columns: [table.approvedByUserId],
    foreignColumns: [table.id],
  }),
}));

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

export type OrganizationRow = typeof organizations.$inferSelect;
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
  // Workspace scope for this chat session.
  // - For regular users: their own workspace (set at session creation)
  // - For admin_app: can be a shared workspace (read-only) or Admin Workspace
  workspaceId: text('workspace_id').references(() => workspaces.id),
  primaryContextType: text('primary_context_type'), // 'organization' | 'folder' | 'usecase' | 'executive_summary'
  primaryContextId: text('primary_context_id'),
  title: text('title'),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow()
}, (table) => ({
  userIdIdx: index('chat_sessions_user_id_idx').on(table.userId),
  primaryContextIdx: index('chat_sessions_primary_context_idx').on(table.primaryContextType, table.primaryContextId),
  workspaceIdIdx: index('chat_sessions_workspace_id_idx').on(table.workspaceId),
}));

export const chatMessages = pgTable('chat_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => chatSessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant' | 'system' | 'tool'
  content: text('content'), // nullable for tool calls
  contexts: jsonb('contexts'), // array of { contextType, contextId } for message traceability
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
  contextType: text('context_type').notNull(), // 'organization' | 'folder' | 'usecase' | 'executive_summary'
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

export const chatMessageFeedback = pgTable('chat_message_feedback', {
  id: text('id').primaryKey(),
  messageId: text('message_id')
    .notNull()
    .references(() => chatMessages.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  vote: integer('vote').notNull(), // 1 = up, -1 = down
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).notNull().defaultNow()
}, (table) => ({
  messageIdIdx: index('chat_message_feedback_message_id_idx').on(table.messageId),
  userIdIdx: index('chat_message_feedback_user_id_idx').on(table.userId),
  messageUserUnique: uniqueIndex('chat_message_feedback_message_user_unique').on(table.messageId, table.userId),
}));

// Chat tracing (debug/audit): store the exact OpenAI payloads + tool calls per iteration.
// Retention is enforced via periodic purge (7 days by default).
export const chatGenerationTraces = pgTable('chat_generation_traces', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => chatSessions.id, { onDelete: 'cascade' }),
  assistantMessageId: text('assistant_message_id')
    .notNull()
    .references(() => chatMessages.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').references(() => workspaces.id),
  phase: text('phase').notNull(), // 'pass1' | 'pass2'
  iteration: integer('iteration').notNull(), // within phase
  model: text('model'),
  toolChoice: text('tool_choice'),
  tools: jsonb('tools'), // array of tool metadata (names etc.)
  openaiMessages: jsonb('openai_messages').notNull(), // exact messages payload sent to OpenAI
  toolCalls: jsonb('tool_calls'), // executed tool calls for this iteration (args + results)
  meta: jsonb('meta'), // sizes, truncation flags, timings
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow()
}, (table) => ({
  sessionIdIdx: index('chat_generation_traces_session_id_idx').on(table.sessionId),
  assistantMessageIdIdx: index('chat_generation_traces_assistant_message_id_idx').on(table.assistantMessageId),
  createdAtIdx: index('chat_generation_traces_created_at_idx').on(table.createdAt),
}));

export const contextModificationHistory = pgTable('context_modification_history', {
  id: text('id').primaryKey(),
  contextType: text('context_type').notNull(), // 'organization' | 'folder' | 'usecase' | 'executive_summary'
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

// Chatbot Lot B: attach documents to a business context (organization/folder/usecase).
// Storage is external (S3-compatible); DB stores metadata + summary + status.
export const contextDocuments = pgTable('context_documents', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id)
    .default(ADMIN_WORKSPACE_ID),
  contextType: text('context_type').notNull(), // 'organization' | 'folder' | 'usecase'
  contextId: text('context_id').notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageKey: text('storage_key').notNull(), // object key in S3-compatible storage
  status: text('status').notNull().default('uploaded'), // 'uploaded' | 'processing' | 'ready' | 'failed'
  // Document metadata / summaries are stored in JSONB to avoid schema churn (like organizations/use_cases)
  // Suggested structure:
  // - summary: string (résumé général)
  // - summaryLang: 'fr' | 'en'
  // - detailedSummary: string (optionnel, ~10k mots)
  // - detailedSummaryLang: 'fr' | 'en'
  // - extracted: { title?: string; pages?: number; words?: number }
  // - prompts: { summaryPromptId?: string; summaryPromptVersionId?: string; detailedPromptId?: string; detailedPromptVersionId?: string }
  data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
  jobId: text('job_id').references(() => jobQueue.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
  version: integer('version').notNull().default(1),
}, (table) => ({
  workspaceIdIdx: index('context_documents_workspace_id_idx').on(table.workspaceId),
  contextIdx: index('context_documents_context_idx').on(table.contextType, table.contextId),
  statusIdx: index('context_documents_status_idx').on(table.status),
}));

// Optional: keep history of uploads/summaries per document.
export const contextDocumentVersions = pgTable('context_document_versions', {
  id: text('id').primaryKey(),
  documentId: text('document_id')
    .notNull()
    .references(() => contextDocuments.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageKey: text('storage_key').notNull(),
  data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  documentIdIdx: index('context_document_versions_document_id_idx').on(table.documentId),
  documentVersionUnique: uniqueIndex('context_document_versions_document_id_version_unique').on(table.documentId, table.version),
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
export type ChatGenerationTraceRow = typeof chatGenerationTraces.$inferSelect;
export type ContextModificationHistoryRow = typeof contextModificationHistory.$inferSelect;
export type ContextDocumentRow = typeof contextDocuments.$inferSelect;
export type ContextDocumentVersionRow = typeof contextDocumentVersions.$inferSelect;

// Collaboration tables (Lot 1-5) - Migration will be created at Lot 5
export const workspaceMemberships = pgTable('workspace_memberships', {
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'viewer' | 'commenter' | 'editor' | 'admin'
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  workspaceUserUnique: uniqueIndex('workspace_memberships_workspace_id_user_id_unique').on(table.workspaceId, table.userId),
  workspaceIdIdx: index('workspace_memberships_workspace_id_idx').on(table.workspaceId),
  userIdIdx: index('workspace_memberships_user_id_idx').on(table.userId),
}));

export type WorkspaceMembershipRow = typeof workspaceMemberships.$inferSelect;

// Lot 2: Object edition locks (soft locks with TTL, enforced on mutations)
export const objectLocks = pgTable('object_locks', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  objectType: text('object_type').notNull(), // 'organization' | 'folder' | 'usecase'
  objectId: text('object_id').notNull(),
  lockedByUserId: text('locked_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  lockedAt: timestamp('locked_at', { withTimezone: false }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: false }).notNull(),
  unlockRequestedAt: timestamp('unlock_requested_at', { withTimezone: false }),
  unlockRequestedByUserId: text('unlock_requested_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  unlockRequestMessage: text('unlock_request_message'),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  objectUnique: uniqueIndex('object_locks_workspace_object_unique').on(table.workspaceId, table.objectType, table.objectId),
  workspaceIdIdx: index('object_locks_workspace_id_idx').on(table.workspaceId),
  expiresAtIdx: index('object_locks_expires_at_idx').on(table.expiresAt),
}));

export type ObjectLockRow = typeof objectLocks.$inferSelect;

// Lot 4: Comments (flat conversations, workspace-scoped)
export const comments = pgTable('comments', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  contextType: text('context_type').notNull(), // 'organization' | 'folder' | 'usecase' | ...
  contextId: text('context_id').notNull(),
  sectionKey: text('section_key'), // optional sub-section key (e.g., 'description', 'matrix.cell.x.y')
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  assignedTo: text('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('open'), // 'open' | 'closed'
  threadId: text('thread_id').notNull(),
  content: text('content').notNull(),
  toolCallId: text('tool_call_id'),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  workspaceIdIdx: index('comments_workspace_id_idx').on(table.workspaceId),
  contextIdx: index('comments_context_idx').on(table.contextType, table.contextId),
  threadIdIdx: index('comments_thread_id_idx').on(table.threadId),
  assignedToIdx: index('comments_assigned_to_idx').on(table.assignedTo),
  statusIdx: index('comments_status_idx').on(table.status),
  toolCallIdIdx: index('comments_tool_call_id_idx').on(table.toolCallId),
}));

export type CommentRow = typeof comments.$inferSelect;

// Chrome extension local-tool permissions (per user/workspace/tool/origin).
export const extensionToolPermissions = pgTable('extension_tool_permissions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  toolName: text('tool_name').notNull(),
  origin: text('origin').notNull(),
  policy: text('policy').notNull().default('allow'), // 'allow' | 'deny'
  updatedAt: timestamp('updated_at', { withTimezone: false }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  userWorkspaceIdx: index('extension_tool_permissions_user_workspace_idx').on(table.userId, table.workspaceId),
  toolOriginIdx: index('extension_tool_permissions_tool_origin_idx').on(table.toolName, table.origin),
  userWorkspaceToolOriginUnique: uniqueIndex(
    'extension_tool_permissions_user_workspace_tool_origin_unique',
  ).on(table.userId, table.workspaceId, table.toolName, table.origin),
}));

// BR-03: TODO + steering + workflow core runtime entities
export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  workspaceIdIdx: index('plans_workspace_id_idx').on(table.workspaceId),
}));

export const todos = pgTable('todos', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  planId: text('plan_id').references(() => plans.id, { onDelete: 'cascade' }),
  parentTodoId: text('parent_todo_id'),
  title: text('title').notNull(),
  description: text('description'),
  position: integer('position').notNull().default(0),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  closedAt: timestamp('closed_at', { withTimezone: false }),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  parentTodoIdFk: foreignKey({
    columns: [table.parentTodoId],
    foreignColumns: [table.id],
    name: 'todos_parent_todo_id_todos_id_fk',
  }),
  workspaceIdIdx: index('todos_workspace_id_idx').on(table.workspaceId),
  planIdIdx: index('todos_plan_id_idx').on(table.planId),
  parentTodoIdIdx: index('todos_parent_todo_id_idx').on(table.parentTodoId),
  ownerUserIdIdx: index('todos_owner_user_id_idx').on(table.ownerUserId),
}));

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  todoId: text('todo_id')
    .notNull()
    .references(() => todos.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  position: integer('position').notNull().default(0),
  status: text('status').notNull().default('todo'),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  assigneeUserId: text('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at', { withTimezone: false }),
  completedAt: timestamp('completed_at', { withTimezone: false }),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  workspaceIdIdx: index('tasks_workspace_id_idx').on(table.workspaceId),
  todoIdIdx: index('tasks_todo_id_idx').on(table.todoId),
  statusIdx: index('tasks_status_idx').on(table.status),
  assigneeUserIdIdx: index('tasks_assignee_user_id_idx').on(table.assigneeUserId),
}));

export const todoDependencies = pgTable('todo_dependencies', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  todoId: text('todo_id')
    .notNull()
    .references(() => todos.id, { onDelete: 'cascade' }),
  dependsOnTodoId: text('depends_on_todo_id')
    .notNull()
    .references(() => todos.id, { onDelete: 'cascade' }),
  dependencyType: text('dependency_type').notNull().default('blocks'),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  dependencyUnique: uniqueIndex('todo_dependencies_unique_idx').on(table.todoId, table.dependsOnTodoId),
  workspaceIdIdx: index('todo_dependencies_workspace_id_idx').on(table.workspaceId),
}));

export const taskDependencies = pgTable('task_dependencies', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  dependsOnTaskId: text('depends_on_task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  dependencyType: text('dependency_type').notNull().default('blocks'),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  dependencyUnique: uniqueIndex('task_dependencies_unique_idx').on(table.taskId, table.dependsOnTaskId),
  workspaceIdIdx: index('task_dependencies_workspace_id_idx').on(table.workspaceId),
}));

export const taskIoContracts = pgTable('task_io_contracts', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  schemaFormat: text('schema_format').notNull().default('json_schema'),
  inputSchema: jsonb('input_schema').notNull().default(sql`'{}'::jsonb`),
  outputSchema: jsonb('output_schema').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  taskIdUnique: uniqueIndex('task_io_contracts_task_id_unique').on(table.taskId),
  workspaceIdIdx: index('task_io_contracts_workspace_id_idx').on(table.workspaceId),
}));

export const agentDefinitions = pgTable('agent_definitions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  sourceLevel: text('source_level').notNull().default('code'),
  lineageRootId: text('lineage_root_id'),
  parentId: text('parent_id'),
  isDetached: boolean('is_detached').notNull().default(false),
  lastParentSyncAt: timestamp('last_parent_sync_at', { withTimezone: false }),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  parentIdFk: foreignKey({
    columns: [table.parentId],
    foreignColumns: [table.id],
    name: 'agent_definitions_parent_id_agent_definitions_id_fk',
  }),
  workspaceKeyUnique: uniqueIndex('agent_definitions_workspace_key_unique').on(table.workspaceId, table.key),
  workspaceIdIdx: index('agent_definitions_workspace_id_idx').on(table.workspaceId),
  parentIdIdx: index('agent_definitions_parent_id_idx').on(table.parentId),
}));

export const workflowDefinitions = pgTable('workflow_definitions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  sourceLevel: text('source_level').notNull().default('code'),
  lineageRootId: text('lineage_root_id'),
  parentId: text('parent_id'),
  isDetached: boolean('is_detached').notNull().default(false),
  lastParentSyncAt: timestamp('last_parent_sync_at', { withTimezone: false }),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  parentIdFk: foreignKey({
    columns: [table.parentId],
    foreignColumns: [table.id],
    name: 'workflow_definitions_parent_id_workflow_definitions_id_fk',
  }),
  workspaceKeyUnique: uniqueIndex('workflow_definitions_workspace_key_unique').on(table.workspaceId, table.key),
  workspaceIdIdx: index('workflow_definitions_workspace_id_idx').on(table.workspaceId),
  parentIdIdx: index('workflow_definitions_parent_id_idx').on(table.parentId),
}));

export const workflowDefinitionTasks = pgTable('workflow_definition_tasks', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  workflowDefinitionId: text('workflow_definition_id')
    .notNull()
    .references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  taskKey: text('task_key').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  orderIndex: integer('order_index').notNull().default(0),
  agentDefinitionId: text('agent_definition_id').references(() => agentDefinitions.id, { onDelete: 'set null' }),
  schemaFormat: text('schema_format').notNull().default('json_schema'),
  inputSchema: jsonb('input_schema').notNull().default(sql`'{}'::jsonb`),
  outputSchema: jsonb('output_schema').notNull().default(sql`'{}'::jsonb`),
  sectionKey: text('section_key'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  workflowTaskKeyUnique: uniqueIndex('workflow_definition_tasks_unique_key').on(table.workflowDefinitionId, table.taskKey),
  orderIdx: index('workflow_definition_tasks_order_idx').on(table.workflowDefinitionId, table.orderIndex),
  workspaceIdIdx: index('workflow_definition_tasks_workspace_id_idx').on(table.workspaceId),
}));

export const guardrails = pgTable('guardrails', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  category: text('category').notNull(),
  title: text('title'),
  instruction: text('instruction').notNull(),
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  isActive: boolean('is_active').notNull().default(true),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  workspaceIdIdx: index('guardrails_workspace_id_idx').on(table.workspaceId),
  entityIdx: index('guardrails_entity_idx').on(table.entityType, table.entityId),
}));

export const entityLinks = pgTable('entity_links', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  sourceEntityType: text('source_entity_type').notNull(),
  sourceEntityId: text('source_entity_id').notNull(),
  targetObjectType: text('target_object_type').notNull(),
  targetObjectId: text('target_object_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  entityLinkUnique: uniqueIndex('entity_links_unique_idx').on(
    table.workspaceId,
    table.sourceEntityType,
    table.sourceEntityId,
    table.targetObjectType,
    table.targetObjectId,
  ),
  sourceEntityIdx: index('entity_links_source_entity_idx').on(table.sourceEntityType, table.sourceEntityId),
  targetObjectIdx: index('entity_links_target_object_idx').on(table.targetObjectType, table.targetObjectId),
}));

export const executionRuns = pgTable('execution_runs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  planId: text('plan_id').references(() => plans.id, { onDelete: 'set null' }),
  todoId: text('todo_id').references(() => todos.id, { onDelete: 'set null' }),
  taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  workflowDefinitionId: text('workflow_definition_id').references(() => workflowDefinitions.id, { onDelete: 'set null' }),
  agentDefinitionId: text('agent_definition_id').references(() => agentDefinitions.id, { onDelete: 'set null' }),
  mode: text('mode').notNull().default('manual'),
  status: text('status').notNull().default('pending'),
  startedByUserId: text('started_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at', { withTimezone: false }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: false }),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  workspaceIdIdx: index('execution_runs_workspace_id_idx').on(table.workspaceId),
  statusIdx: index('execution_runs_status_idx').on(table.status),
  taskIdIdx: index('execution_runs_task_id_idx').on(table.taskId),
}));

export const executionEvents = pgTable('execution_events', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  runId: text('run_id')
    .notNull()
    .references(() => executionRuns.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  actorType: text('actor_type'),
  actorId: text('actor_id'),
  payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
  sequence: integer('sequence').notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  runIdSequenceUnique: uniqueIndex('execution_events_run_id_sequence_unique').on(table.runId, table.sequence),
  workspaceIdIdx: index('execution_events_workspace_id_idx').on(table.workspaceId),
  runIdIdx: index('execution_events_run_id_idx').on(table.runId),
  eventTypeIdx: index('execution_events_event_type_idx').on(table.eventType),
}));

export type ExtensionToolPermissionRow = typeof extensionToolPermissions.$inferSelect;
export type PlanRow = typeof plans.$inferSelect;
export type TodoRow = typeof todos.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type TodoDependencyRow = typeof todoDependencies.$inferSelect;
export type TaskDependencyRow = typeof taskDependencies.$inferSelect;
export type TaskIoContractRow = typeof taskIoContracts.$inferSelect;
export type GuardrailRow = typeof guardrails.$inferSelect;
export type WorkflowDefinitionRow = typeof workflowDefinitions.$inferSelect;
export type WorkflowDefinitionTaskRow = typeof workflowDefinitionTasks.$inferSelect;
export type AgentDefinitionRow = typeof agentDefinitions.$inferSelect;
export type EntityLinkRow = typeof entityLinks.$inferSelect;
export type ExecutionRunRow = typeof executionRuns.$inferSelect;
export type ExecutionEventRow = typeof executionEvents.$inferSelect;
