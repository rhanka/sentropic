// A4 composition bundle 1.2.0, domain atomic_workspace_deletion (P5):
// standalone atomic deletion of one workspace. One write UOW attempt,
// all-or-rollback; no durable operation journal (the command is safely
// retryable and nothing is enqueued before commit). Connector grants are
// captured per workspace row owner and enqueued as pending deliveries.

import type {
  ConnectorRevocationCustodyPortV1,
  IdentityRunOptionsV1,
  IdentityTransactionV1,
  IdentityUnitOfWorkV1,
} from './custody.js';
import type { IdentityCleanupReceiptV1, IdentityExternalRevocationDraftV1 } from './custody-operations.js';
import type { IdentityClock } from './types.js';

export interface WorkspaceDeletionCommandV1 {
  readonly operationId: string;
  readonly workspaceId: string;
  readonly actorId: string;
}

export interface WorkspaceBusinessDeletionReceiptV1 {
  readonly deletedByTable: Readonly<Record<string, number>>;
  readonly detachedByTable: Readonly<Record<string, number>>;
}

export interface WorkspaceDeletionReceiptV1 {
  readonly contractVersion: '1.2.0';
  readonly operationId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly deliveryIds: readonly string[];
  readonly business: WorkspaceBusinessDeletionReceiptV1;
  readonly cleanup: IdentityCleanupReceiptV1;
  readonly at: string;
}

/** Host business preconditions (e.g. hidden state) re-read on the host tx. */
export interface WorkspaceDeletionAuthorizationPortV1<H> {
  assertAllowed(command: WorkspaceDeletionCommandV1, tx: IdentityTransactionV1<H>): Promise<void>;
}

/** Business participant bound to the exact active host transaction. */
export interface WorkspaceBusinessDeletionPortV1<H> {
  deleteWorkspaceRows(workspaceId: string, tx: IdentityTransactionV1<H>): Promise<WorkspaceBusinessDeletionReceiptV1>;
  assertNoWorkspaceOrphans(workspaceId: string, tx: IdentityTransactionV1<H>): Promise<void>;
}

/** Connector custody plane scoped to one workspace (all row owners). */
export interface WorkspaceDeletionPlanePortV1<H> {
  readonly placement: 'present' | 'absent';
  listConnectorOwners(command: WorkspaceDeletionCommandV1, tx: IdentityTransactionV1<H>): Promise<readonly string[]>;
  apply(command: WorkspaceDeletionCommandV1, tx: IdentityTransactionV1<H>): Promise<readonly IdentityExternalRevocationDraftV1[]>;
  assertDeliveryInScope(command: WorkspaceDeletionCommandV1, draft: IdentityExternalRevocationDraftV1, tx: IdentityTransactionV1<H>): Promise<void>;
  assertAbsent(command: WorkspaceDeletionCommandV1, tx: IdentityTransactionV1<H>): Promise<void>;
}

export interface AtomicWorkspaceDeletionV1 {
  deleteWorkspace(command: WorkspaceDeletionCommandV1): Promise<WorkspaceDeletionReceiptV1>;
}

export interface WorkspaceDeletionInputV1<H> {
  readonly unitOfWork: IdentityUnitOfWorkV1<H>;
  readonly business: WorkspaceBusinessDeletionPortV1<H>;
  readonly authorization: WorkspaceDeletionAuthorizationPortV1<H>;
  readonly connectorPlane: WorkspaceDeletionPlanePortV1<H>;
  /** Required (non-null) when connectorPlane.placement === 'present'. */
  readonly connectorCustody: ConnectorRevocationCustodyPortV1<H> | null;
  readonly clock: IdentityClock;
  readonly transactionOptions: { readonly deletion: IdentityRunOptionsV1 };
}
