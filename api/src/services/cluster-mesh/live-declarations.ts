import { and, eq, sql } from 'drizzle-orm';
import {
  type LiveDeclarationStorePort,
  type LiveDeclarationWithdrawal,
  type LiveWorkspaceDeclaration,
  type LiveProductBindingAuthorizationPort,
  canonicalIdKey,
  INITIAL_DECLARATION_REVISION,
  validateWorkspaceDeclaration,
} from '../../../../packages/cluster-mesh/src/live-storage/registration';
import { db } from '../../db/client';
import { liveGitDeclarations } from '../../db/control-schema';
export {
  DatabaseCodeWorkspaceBindingAuthorizer,
  defaultCodeWorkspaceBindingAuthorizer,
} from '../../routes/namespaces/code-git-ports';
import { defaultCodeWorkspaceBindingAuthorizer } from '../../routes/namespaces/code-git-ports';

export {
  canonicalIdKey,
  createLiveDeclaration,
  reviseLiveDeclaration,
  revokeLiveDeclaration,
  createLiveDeclarationRegistration,
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
  type LiveProductBindingAuthorizationPort,
  type LiveProductBindingAuthorizationInput,
} from '../../../../packages/cluster-mesh/src/live-storage/registration';

export interface LiveDeclarationIdentityAdapter {
  declarationKey(declaration: LiveWorkspaceDeclaration): string;
  lookupKey(tenant: string, declarationId: string, cloneId: string, worktreeId: string): string;
  withdrawalKey(withdrawal: LiveDeclarationWithdrawal): string;
}

export const canonicalLiveDeclarationIdentity: LiveDeclarationIdentityAdapter = {
  declarationKey: (d) => canonicalIdKey('declaration', [d.tenant, d.declarationId, d.cloneId, d.worktreeId]),
  lookupKey: (tenant, declId, cloneId, wtId) => canonicalIdKey('declaration', [tenant, declId, cloneId, wtId]),
  withdrawalKey: (w) => canonicalIdKey('declaration', [w.tenant, w.declarationId, w.cloneId, w.worktreeId]),
};

export const contractLiveDeclarationIdentity = canonicalLiveDeclarationIdentity;

/**
 * Postgres LiveDeclarationStorePort adapter over control.live_git_declarations.
 *
 * Durability and race-protection rules (engram plan L6a, S seat, M1/M2/M4/M5/B1):
 * - Identity derivation uses canonicalIdKey('declaration', [tenant, declarationId, cloneId, worktreeId]).
 * - Product declarations with serverWorkspaceId must pass binding authorization before persistence.
 * - Initial declaration revision (1) uses onConflictDoNothing() to prevent concurrent declare races.
 * - Subsequent declaration revisions (>1) use compare-and-swap on the previous declaration revision.
 * - find and status require the complete (tenant, declarationId, cloneId, worktreeId) tuple without legacy fallback.
 * - recordWithdrawal marks the row (status, withdrawal document, reason, timestamp) and never deletes it.
 * - list returns declared declarations only, so replay after projection loss never resurrects withdrawn work.
 */
export class PostgresLiveDeclarationStore implements LiveDeclarationStorePort {
  constructor(
    private readonly identity: LiveDeclarationIdentityAdapter = contractLiveDeclarationIdentity,
    private readonly bindingAuthorizer: LiveProductBindingAuthorizationPort = defaultCodeWorkspaceBindingAuthorizer,
  ) {}

  async save(declaration: LiveWorkspaceDeclaration): Promise<void> {
    const checked = validateWorkspaceDeclaration(declaration);
    if (!checked.ok) {
      throw new Error(`invalid live workspace declaration: ${checked.errors.join('; ')}`);
    }

    if (declaration.serverWorkspaceId && this.bindingAuthorizer) {
      await this.bindingAuthorizer.authorizeProductBinding({
        tenant: declaration.tenant,
        principal: declaration.principal,
        serverWorkspaceId: declaration.serverWorkspaceId,
        serverIssuer: declaration.serverIssuer!,
        bindingRevision: declaration.bindingRevision!,
      });
    }

    const row = {
      declarationKey: this.identity.declarationKey(declaration),
      tenantId: declaration.tenant,
      payload: declaration,
      liveCapability: declaration.liveCapability,
      updatedAt: new Date(),
    };

    const rev = declaration.declarationRevision;
    if (rev === INITIAL_DECLARATION_REVISION) {
      const inserted = await db.insert(liveGitDeclarations).values(row).onConflictDoNothing()
        .returning({ declarationKey: liveGitDeclarations.declarationKey });
      if (inserted.length === 0) {
        throw new Error(`live declaration already exists for ${declaration.tenant}/${declaration.declarationId}`);
      }
    } else {
      const updated = await db.update(liveGitDeclarations).set({
        tenantId: row.tenantId, payload: row.payload, liveCapability: row.liveCapability, updatedAt: row.updatedAt,
      }).where(and(
        eq(liveGitDeclarations.declarationKey, row.declarationKey),
        eq(liveGitDeclarations.status, 'declared'),
        sql`(${liveGitDeclarations.payload}->>'declarationRevision')::int = ${rev - 1}`,
      )).returning({ declarationKey: liveGitDeclarations.declarationKey });
      if (updated.length === 0) {
        throw new Error(`revision conflict: declaration has been modified or does not exist (expected revision ${rev - 1})`);
      }
    }
  }

  async find(tenant: string, declarationId: string, cloneId: string, worktreeId: string): Promise<LiveWorkspaceDeclaration | null> {
    const [row] = await db
      .select({ payload: liveGitDeclarations.payload })
      .from(liveGitDeclarations)
      .where(eq(liveGitDeclarations.declarationKey, this.identity.lookupKey(tenant, declarationId, cloneId, worktreeId)))
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

  async status(tenant: string, declarationId: string, cloneId: string, worktreeId: string): Promise<'declared' | 'withdrawn' | 'unknown'> {
    const [row] = await db
      .select({ status: liveGitDeclarations.status })
      .from(liveGitDeclarations)
      .where(eq(liveGitDeclarations.declarationKey, this.identity.lookupKey(tenant, declarationId, cloneId, worktreeId)))
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
