import { and, eq } from 'drizzle-orm';
import {
  type LiveDeclarationStorePort,
  type LiveDeclarationWithdrawal,
  type LiveWorkspaceDeclaration,
  validateWorkspaceDeclaration,
} from '../../../../packages/cluster-mesh/src/live-storage/registration';
import { db } from '../../db/client';
import { liveGitDeclarations } from '../../db/control-schema';

export {
  deriveCloneIdentity,
  deriveWorktreeIdentity,
  deriveDeclarationIdentity,
  validateWorkspaceDeclaration,
  validateCloneIdentity,
  validateWorktreeIdentity,
  validateDeclarationRevocation,
  validatePrivatePurgeRequest,
  POLICY_VERSION,
  EXPLICIT_LIVE_CAPABILITY,
  INITIAL_DECLARATION_REVISION,
  INITIAL_BINDING_REVISION,
  IDENTITY_UNCERTAINTY_STATES,
  NON_ACTIVATING_LIFECYCLE_KINDS,
  type DeriveCloneIdentityInput,
  type DeriveWorktreeIdentityInput,
  type DeriveDeclarationIdentityInput,
  type DeclarationIdentityDto,
  type CloneIdentityDto,
  type WorktreeIdentityDto,
  type LiveWorkspaceDeclaration,
  type LiveDeclarationWithdrawal,
  type LiveDeclarationStorePort,
} from '../../../../packages/cluster-mesh/src/live-storage/registration';

export interface LiveDeclarationIdentityAdapter {
  declarationKey(declaration: LiveWorkspaceDeclaration): string;
  lookupKey(tenant: string, declarationId: string, cloneId?: string, worktreeId?: string): string;
  withdrawalKey(withdrawal: LiveDeclarationWithdrawal): string;
}

export const canonicalLiveDeclarationIdentity: LiveDeclarationIdentityAdapter = {
  declarationKey: (d) => `${d.tenant}#${d.declarationId}#${d.cloneId}#${d.worktreeId}`,
  lookupKey: (tenant, declId, cloneId, wtId) =>
    cloneId && wtId ? `${tenant}#${declId}#${cloneId}#${wtId}` : `${tenant}#${declId}`,
  withdrawalKey: (w) => `${w.tenant}#${w.declarationId}#${w.cloneId}#${w.worktreeId}`,
};

export const contractLiveDeclarationIdentity = canonicalLiveDeclarationIdentity;

/**
 * Postgres LiveDeclarationStorePort adapter over control.live_git_declarations.
 *
 * Durability rules (engram plan L6a, S seat):
 * - The declaration document is stored as jsonb payload; save upserts by the
 *   adapter key so a revision replaces the previous committed document.
 * - recordWithdrawal marks the row (status, withdrawal document, reason,
 *   timestamp) and never deletes it: committed history is preserved.
 * - list returns declared declarations only, so replay after projection loss
 *   never resurrects withdrawn work.
 */
export class PostgresLiveDeclarationStore implements LiveDeclarationStorePort {
  constructor(
    private readonly identity: LiveDeclarationIdentityAdapter = contractLiveDeclarationIdentity,
  ) {}

  async save(declaration: LiveWorkspaceDeclaration): Promise<void> {
    const checked = validateWorkspaceDeclaration(declaration);
    if (!checked.ok) {
      throw new Error(`invalid live workspace declaration: ${checked.errors.join('; ')}`);
    }
    const row = {
      declarationKey: this.identity.declarationKey(declaration),
      tenantId: declaration.tenant,
      payload: declaration,
      liveCapability: declaration.liveCapability,
      updatedAt: new Date(),
    };
    await db.insert(liveGitDeclarations).values(row).onConflictDoUpdate({
      target: liveGitDeclarations.declarationKey,
      set: {
        tenantId: row.tenantId,
        payload: row.payload,
        liveCapability: row.liveCapability,
        updatedAt: row.updatedAt,
      },
    });
  }

  async find(tenant: string, declarationId: string, cloneId?: string, worktreeId?: string): Promise<LiveWorkspaceDeclaration | null> {
    if (cloneId && worktreeId) {
      const [row] = await db
        .select({ payload: liveGitDeclarations.payload })
        .from(liveGitDeclarations)
        .where(eq(liveGitDeclarations.declarationKey, this.identity.lookupKey(tenant, declarationId, cloneId, worktreeId)))
        .limit(1);
      return row ? (row.payload as LiveWorkspaceDeclaration) : null;
    }
    const rows = await db
      .select({ payload: liveGitDeclarations.payload })
      .from(liveGitDeclarations)
      .where(eq(liveGitDeclarations.tenantId, tenant));
    const matched = rows.find((r) => {
      const p = r.payload as LiveWorkspaceDeclaration;
      return p.declarationId === declarationId || p.hostFingerprint === declarationId;
    });
    return matched ? (matched.payload as LiveWorkspaceDeclaration) : null;
  }

  async list(tenant?: string): Promise<readonly LiveWorkspaceDeclaration[]> {
    const rows = tenant === undefined
      ? await db
          .select({ payload: liveGitDeclarations.payload })
          .from(liveGitDeclarations)
          .where(eq(liveGitDeclarations.status, 'declared'))
      : await db
          .select({ payload: liveGitDeclarations.payload })
          .from(liveGitDeclarations)
          .where(
            and(
              eq(liveGitDeclarations.tenantId, tenant),
              eq(liveGitDeclarations.status, 'declared'),
            ),
          );
    return rows.map((row) => row.payload as LiveWorkspaceDeclaration);
  }

  async status(tenant: string, declarationId: string, cloneId?: string, worktreeId?: string): Promise<'declared' | 'withdrawn' | 'unknown'> {
    if (cloneId && worktreeId) {
      const [row] = await db
        .select({ status: liveGitDeclarations.status })
        .from(liveGitDeclarations)
        .where(eq(liveGitDeclarations.declarationKey, this.identity.lookupKey(tenant, declarationId, cloneId, worktreeId)))
        .limit(1);
      return row ? (row.status as 'declared' | 'withdrawn') : 'unknown';
    }
    const rows = await db
      .select({ status: liveGitDeclarations.status, payload: liveGitDeclarations.payload })
      .from(liveGitDeclarations)
      .where(eq(liveGitDeclarations.tenantId, tenant));
    const matched = rows.find((r) => {
      const p = r.payload as LiveWorkspaceDeclaration;
      return p.declarationId === declarationId || p.hostFingerprint === declarationId;
    });
    return matched ? (matched.status as 'declared' | 'withdrawn') : 'unknown';
  }

  async recordWithdrawal(withdrawal: LiveDeclarationWithdrawal, withdrawnAt: string): Promise<boolean> {
    // The row is marked, never deleted: committed history is preserved.
    const updated = await db
      .update(liveGitDeclarations)
      .set({
        status: 'withdrawn',
        withdrawal,
        withdrawalReason: withdrawal.reason,
        withdrawnAt: new Date(withdrawnAt),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(liveGitDeclarations.declarationKey, this.identity.withdrawalKey(withdrawal)),
          eq(liveGitDeclarations.status, 'declared'),
        ),
      )
      .returning({ declarationKey: liveGitDeclarations.declarationKey });
    return updated.length > 0;
  }
}
