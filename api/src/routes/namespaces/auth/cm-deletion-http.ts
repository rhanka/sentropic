import { randomUUID } from 'node:crypto';
import { AccountTransitionError, AdminUserProtectedError, IdentityNotFoundError,
  SelfActionForbiddenError, type PersonDeletionReceiptV2 } from '@sentropic/cluster-mesh';
import type { Context } from 'hono';
import { CmIdentityForbiddenError } from '../../../services/identity/cm-deletion-authorization';

/** The operation id is an idempotency key, never a permission to read another operation. */
export async function runCmAccountDeletionHttp(c: Context,
  operation: (operationId: string) => Promise<PersonDeletionReceiptV2>): Promise<Response> {
  const operationId = c.req.header('idempotency-key') ?? randomUUID();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(operationId)) return c.json({ error: 'Invalid operation id' }, 400);
  c.header('identity-operation-id', operationId);
  try {
    const receipt = await operation(operationId);
    if (receipt.transaction === 'rolled_back') return c.json({ success: false,
      complete: false, operationId, resultCode: receipt.resultCode }, 503);
    return c.json({ success: true, complete: receipt.complete, operationId,
      status: receipt.complete ? 'complete' : 'delivery_pending', receipt }, receipt.complete ? 200 : 202);
  } catch (error) {
    if (error instanceof IdentityNotFoundError) return c.json({ error: 'User not found' }, 404);
    if (error instanceof AccountTransitionError) return c.json({ error: 'User must be disabled before deletion' }, 409);
    if (error instanceof AdminUserProtectedError || error instanceof SelfActionForbiddenError
      || error instanceof CmIdentityForbiddenError) return c.json({ error: 'Identity action is forbidden' }, 403);
    // Unknown commit outcomes retain the same operation id for trusted recovery.
    return c.json({ error: 'Identity deletion unavailable', operationId, complete: false }, 503);
  }
}
