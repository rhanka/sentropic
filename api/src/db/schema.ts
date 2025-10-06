import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const companies = sqliteTable('companies', {
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
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`)
});

export const folders = sqliteTable('folders', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  companyId: text('company_id').references(() => companies.id),
  matrixConfig: text('matrix_config'),
  status: text('status').default('completed'), // 'generating', 'completed'
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`)
});

export const useCases = sqliteTable('use_cases', {
  id: text('id').primaryKey(),
  folderId: text('folder_id')
    .notNull()
    .references(() => folders.id, { onDelete: 'cascade' }),
  companyId: text('company_id').references(() => companies.id),
  name: text('name').notNull(),
  description: text('description'),
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
  sources: text('sources'),
  relatedData: text('related_data'),
  references: text('references'),
  valueScores: text('value_scores'),
  complexityScores: text('complexity_scores'),
  totalValueScore: integer('total_value_score'),
  totalComplexityScore: integer('total_complexity_score'),
  status: text('status').default('completed'), // 'draft', 'generating', 'detailing', 'completed'
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`)
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  description: text('description'),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`)
});

export const businessConfig = sqliteTable('business_config', {
  id: text('id').primaryKey(),
  sectors: text('sectors'),
  processes: text('processes')
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  provider: text('provider'),
  profile: text('profile'),
  userId: text('user_id'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text('expires_at')
});

export const jobQueue = sqliteTable('job_queue', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'use_case_list' | 'use_case_detail'
  status: text('status').notNull().default('pending'), // 'pending' | 'processing' | 'completed' | 'failed'
  data: text('data').notNull(), // JSON string
  result: text('result'), // JSON string
  error: text('error'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  startedAt: text('started_at'),
  completedAt: text('completed_at')
});

export type CompanyRow = typeof companies.$inferSelect;
export type FolderRow = typeof folders.$inferSelect;
export type UseCaseRow = typeof useCases.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
export type BusinessConfigRow = typeof businessConfig.$inferSelect;
export type JobQueueRow = typeof jobQueue.$inferSelect;
