import { Hono } from 'hono';
import { db } from '../../../db/client';
import {
  chatSessions,
  chatGenerationTraces,
  chatStreamEvents,
  organizations,
  contextModificationHistory,
  emailVerificationCodes,
  folders,
  magicLinks,
  initiatives,
  userSessions,
  users,
  webauthnChallenges,
  webauthnCredentials,
  workspaces,
} from '../../../db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import {
  captureConnectorGrantsForTeardown,
  recordConnectorGrantTombstones,
  revokeCapturedConnectorGrants,
} from '../../../services/connector-grant-teardown';

export const accountRouter = new Hono();

accountRouter.get('/', async (c) => {
  const { userId, workspaceId, role } = c.get('user');

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      accountStatus: users.accountStatus,
      approvalDueAt: users.approvalDueAt,
      approvedAt: users.approvedAt,
      approvedByUserId: users.approvedByUserId,
      disabledAt: users.disabledAt,
      disabledReason: users.disabledReason,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const [ws] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      ownerUserId: workspaces.ownerUserId,
      createdAt: workspaces.createdAt,
      updatedAt: workspaces.updatedAt,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  return c.json({
    user,
    workspace: ws,
    // role can be dynamically downgraded (approval expired => guest)
    effectiveRole: role,
  });
});

accountRouter.post('/deactivate', async (c) => {
  const { userId } = c.get('user');
  const now = new Date();

  await db
    .update(users)
    .set({
      accountStatus: 'disabled_by_user',
      disabledAt: now,
      disabledReason: 'user_deactivated',
      updatedAt: now,
    })
    .where(eq(users.id, userId));

  // Revoke sessions immediately
  await db.delete(userSessions).where(eq(userSessions.userId, userId));

  return c.json({ success: true });
});

/**
 * DELETE /me
 * Immediate account suppression: delete user + workspace + all owned data.
 */
accountRouter.delete('/', async (c) => {
  const { userId, workspaceId } = c.get('user');

  // Capture the external grants BEFORE anything is deleted: `document_connector_accounts` cascades
  // from both `users` and `workspaces`, a cascade runs no application code, and once the rows are
  // gone the encrypted refresh tokens are gone with them — leaving grants live at Google that
  // nothing can ever revoke. See services/connector-grant-teardown.ts for the full ordering.
  const capturedGrants = await captureConnectorGrantsForTeardown({ userId, workspaceId });

  await db.transaction(async (tx) => {
    // Tombstone inside the same transaction, so the record and the destruction are atomic.
    await recordConnectorGrantTombstones(tx, capturedGrants);

    // Collect object IDs for stream cleanup + history cleanup
    const organizationRows = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.workspaceId, workspaceId));
    const folderRows = await tx
      .select({ id: folders.id })
      .from(folders)
      .where(eq(folders.workspaceId, workspaceId));
    const initiativeRows = await tx
      .select({ id: initiatives.id })
      .from(initiatives)
      .where(eq(initiatives.workspaceId, workspaceId));

    const organizationIds = organizationRows.map((r) => r.id);
    const folderIds = folderRows.map((r) => r.id);
    const initiativeIds = initiativeRows.map((r) => r.id);

    // Stream events for structured generations (organization_/folder_/initiative_)
    const streamIds: string[] = [];
    for (const id of organizationIds) streamIds.push(`organization_${id}`);
    for (const id of folderIds) streamIds.push(`folder_${id}`);
    for (const id of initiativeIds) streamIds.push(`initiative_${id}`);
    if (streamIds.length) {
      await tx.delete(chatStreamEvents).where(inArray(chatStreamEvents.streamId, streamIds));
    }

    // Context modification history linked to these objects
    if (organizationIds.length) {
      await tx
        .delete(contextModificationHistory)
        .where(
          and(
            eq(contextModificationHistory.contextType, 'organization'),
            inArray(contextModificationHistory.contextId, organizationIds)
          )
        );
    }
    if (folderIds.length) {
      await tx
        .delete(contextModificationHistory)
        .where(and(eq(contextModificationHistory.contextType, 'folder'), inArray(contextModificationHistory.contextId, folderIds)));
    }
    if (initiativeIds.length) {
      await tx
        .delete(contextModificationHistory)
        .where(and(eq(contextModificationHistory.contextType, 'initiative'), inArray(contextModificationHistory.contextId, initiativeIds)));
    }

    // Delete business objects (workspace scoped)
    await tx.delete(initiatives).where(eq(initiatives.workspaceId, workspaceId));
    await tx.delete(folders).where(eq(folders.workspaceId, workspaceId));
    await tx.delete(organizations).where(eq(organizations.workspaceId, workspaceId));

    // Auth artifacts
    await tx.delete(userSessions).where(eq(userSessions.userId, userId));
    await tx.delete(webauthnCredentials).where(eq(webauthnCredentials.userId, userId));
    await tx.delete(webauthnChallenges).where(eq(webauthnChallenges.userId, userId));

    // Email/magic link artifacts (best effort)
    const [u] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (u?.email) {
      await tx.delete(emailVerificationCodes).where(eq(emailVerificationCodes.email, u.email));
      await tx.delete(magicLinks).where(eq(magicLinks.email, u.email));
    }

    // IMPORTANT: This workspace can be referenced by:
    // - chat_sessions.workspace_id (including admin-owned sessions scoped to this workspace)
    // - chat_generation_traces.workspace_id
    // The FK is NO ACTION, so we must detach these references before deleting the workspace.
    await tx.update(chatSessions).set({ workspaceId: null }).where(eq(chatSessions.workspaceId, workspaceId));
    await tx.update(chatGenerationTraces).set({ workspaceId: null }).where(eq(chatGenerationTraces.workspaceId, workspaceId));

    // Delete chat sessions owned by this user (cascade deletes chat_messages/contexts)
    await tx.delete(chatSessions).where(eq(chatSessions.userId, userId));

    // Delete workspace owned by this user
    await tx.delete(workspaces).where(and(eq(workspaces.id, workspaceId), eq(workspaces.ownerUserId, userId)));

    // Finally delete user
    await tx.delete(users).where(eq(users.id, userId));
  });

  // Only after a successful commit. Revoking earlier would kill the grant of an account that a
  // rolled-back transaction leaves alive.
  await revokeCapturedConnectorGrants(capturedGrants);

  return c.json({ success: true });
});
