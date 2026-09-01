import { ADMIN_WORKSPACE_ID } from '../../db/schema';
import { getWorkspaceRole } from '../../services/workspace-access';
import type {
  StreamPrincipal,
  StreamsCommentsPort,
  StreamsWorkspacesPort,
} from './streams-ports';

const canObserve = async (
  principal: StreamPrincipal,
  payload: Readonly<Record<string, unknown>>,
): Promise<boolean> => {
  const workspaceId = typeof payload.workspace_id === 'string' ? payload.workspace_id : null;
  if (!workspaceId) return false;
  if (payload.user_id === principal.userId) return true;
  const userIds = Array.isArray(payload.user_ids)
    ? payload.user_ids.filter((id): id is string => typeof id === 'string')
    : [];
  if (userIds.includes(principal.userId)) return true;
  return !!await getWorkspaceRole(principal.userId, workspaceId);
};

export const productStreamsWorkspacesPort: StreamsWorkspacesPort = {
  async resolveTarget({ principal, requestedWorkspaceId }) {
    if (!requestedWorkspaceId || principal.role !== 'admin_app') return principal.workspaceId;
    if (requestedWorkspaceId === ADMIN_WORKSPACE_ID) return requestedWorkspaceId;
    if (!await getWorkspaceRole(principal.userId, requestedWorkspaceId)) {
      throw new Error('Workspace not accessible');
    }
    return requestedWorkspaceId;
  },
  canObserve: ({ principal, payload }) => canObserve(principal, payload),
};

export const productStreamsCommentsPort: StreamsCommentsPort = {
  canObserve: ({ principal, payload }) => canObserve(principal, payload),
};
