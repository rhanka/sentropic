import { and, eq } from 'drizzle-orm';
import type {
  LiveDeclarationStorePort,
  LiveDeclarationWithdrawal,
  LiveWorkspaceDeclaration,
} from '@sentropic/cluster-mesh/live-storage/registration';
import { db } from '../../db/client';
import { liveGitDeclarations } from '../../db/control-schema';

/**
 * Thin identity adapter typed against the engram-live L6a contract (mirrored
 * by the @sentropic/cluster-mesh live-storage registration DTOs).
 *
 * The contract identity fields are under revision: revocation will target a
 * unique declarationId attached to cloneId/worktreeId, with explicit
 * identity-uncertainty states and one canonical id derivation exported by the
 * contract. Until the revised contract lands, every identity derivation this
 * store needs goes through this adapter; swapping the identity model changes
 * this adapter only — not the control table, the migration or the port.
 */
export interface LiveDeclarationIdentityAdapter {
  /** Canonical durable key of one declaration (control row primary key). */
  declarationKey(declaration: LiveWorkspaceDeclaration): string;
  /** Same key as declarationKey, derived from a (tenant, hostFingerprint) lookup. */
  lookupKey(tenant: string, hostFingerprint: string): string;
  /** Key of the declaration a withdrawal targets. */
  withdrawalKey(withdrawal: LiveDeclarationWithdrawal): string;
}

export const contractLiveDeclarationIdentity: LiveDeclarationIdentityAdapter = {
  declarationKey: (declaration) => `${declaration.tenant}\0${declaration.hostFingerprint}`,
  lookupKey: (tenant, hostFingerprint) => `${tenant}\0${hostFingerprint}`,
  withdrawalKey: (withdrawal) => `${withdrawal.tenant}\0${withdrawal.hostFingerprint}`,
};

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
    if (declaration.liveCapability !== 'live') {
      throw new Error("live_git_declarations accepts the explicit 'live' capability only");
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

  async find(tenant: string, hostFingerprint: string): Promise<LiveWorkspaceDeclaration | null> {
    const [row] = await db
      .select({ payload: liveGitDeclarations.payload })
      .from(liveGitDeclarations)
      .where(eq(liveGitDeclarations.declarationKey, this.identity.lookupKey(tenant, hostFingerprint)))
      .limit(1);
    return row ? (row.payload as LiveWorkspaceDeclaration) : null;
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

  async status(tenant: string, hostFingerprint: string): Promise<'declared' | 'withdrawn' | 'unknown'> {
    const [row] = await db
      .select({ status: liveGitDeclarations.status })
      .from(liveGitDeclarations)
      .where(eq(liveGitDeclarations.declarationKey, this.identity.lookupKey(tenant, hostFingerprint)))
      .limit(1);
    return row ? (row.status as 'declared' | 'withdrawn') : 'unknown';
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
