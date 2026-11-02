import type { BusinessDeletionPlanV1, PersonDeletionCommandV2 } from '@sentropic/cluster-mesh';
import { ADMIN_WORKSPACE_ID } from '../../db/schema';
import type { CmIdentityTransaction } from './cm-transaction';

/** Only the existing business ownership reference can authorize workspace destruction. */
export async function prepareCmBusinessDeletion(command: PersonDeletionCommandV2, tx: CmIdentityTransaction): Promise<BusinessDeletionPlanV1> {
  const owned = await tx.hostTransaction.query<{ id: string }>(
    'SELECT id FROM public.workspaces WHERE owner_user_id = $1 AND id <> $2 ORDER BY id COLLATE "C"',
    [command.userId, ADMIN_WORKSPACE_ID]);
  const workspaceIdsToDelete = owned.rows.map(row => row.id);
  const referenced = await tx.hostTransaction.query<{ workspace_id: string }>(`SELECT workspace_id FROM (
    SELECT workspace_id FROM cm_identity.cm_workspace_members WHERE user_id = $1
    UNION SELECT id FROM public.workspaces WHERE owner_user_id = $1
    UNION SELECT workspace_id FROM public.chat_sessions WHERE user_id = $1 AND workspace_id IS NOT NULL
    UNION SELECT workspace_id FROM public.document_connector_accounts WHERE user_id = $1
    UNION SELECT workspace_id FROM public.llm_account_leases WHERE user_id = $1 AND workspace_id IS NOT NULL
    UNION SELECT workspace_id FROM public.llm_provider_accounts WHERE owner_user_id = $1 AND workspace_id IS NOT NULL
    UNION SELECT workspace_id FROM public.extension_tool_permissions WHERE user_id = $1
    UNION SELECT workspace_id FROM public.plans WHERE owner_user_id = $1 OR created_by_user_id = $1
    UNION SELECT workspace_id FROM public.todos WHERE owner_user_id = $1 OR created_by_user_id = $1
    UNION SELECT workspace_id FROM public.tasks WHERE assignee_user_id = $1 OR created_by_user_id = $1
    UNION SELECT workspace_id FROM public.comments WHERE created_by = $1 OR assigned_to = $1
    UNION SELECT workspace_id FROM public.agent_definitions WHERE created_by_user_id = $1
    UNION SELECT workspace_id FROM public.workflow_definitions WHERE created_by_user_id = $1
    UNION SELECT workspace_id FROM public.guardrails WHERE created_by_user_id = $1
    ) AS related ORDER BY workspace_id COLLATE "C"`, [command.userId]);
  return { userId: command.userId, workspaceIdsToDelete,
    retainedWorkspaceIds: referenced.rows.map(row => row.workspace_id).filter(id => !workspaceIdsToDelete.includes(id)) };
}
