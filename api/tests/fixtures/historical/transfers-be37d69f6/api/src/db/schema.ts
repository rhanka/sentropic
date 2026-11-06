import { pgSchema, text } from 'drizzle-orm/pg-core';
export {
  comments,
  contextDocuments,
  folders,
  organizations,
  initiatives,
  workspaces,
} from '../../../../../../../src/db/schema';

// Test-only bridge: the pinned historical reader/writer executes against the canonical CM table.
// No legacy table is recreated and the byte-pinned route remains unchanged.
export const workspaceMemberships = pgSchema('cm_identity').table('cm_workspace_members', {
  workspaceId: text('workspace_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role').notNull(),
});
