import { requireAuth, type AuthUser } from '../../middleware/auth';
import { ResourceError } from '../../services/resource-plane/contract';
import type {
  EditArgs,
  GrepArgs,
  InvokeArgs,
  ListArgs,
  ReadArgs,
  ResourcePrincipal,
} from '../../services/resource-plane/contract';
import { getResourceDispatcher } from '../../services/resource-plane';
import type { ResourceRef } from '../../services/resource-plane/ref';
import { resolveTenant } from '../../services/tenancy/resolve-tenant';
import { getWorkspaceRole, getWorkspaceType } from '../../services/workspace-access';
import type {
  ResourceHttpPrincipal,
  ResourceProjectionPort,
  ResourcesNamespacePorts,
} from './resources';

const resolvePrincipal: ResourcesNamespacePorts['principal']['resolve'] = async (context) => {
  const user = context.get('user') as AuthUser | undefined;
  if (!user?.userId || !user.workspaceId) return null;
  const [role, workspaceType, tenant] = await Promise.all([
    getWorkspaceRole(user.userId, user.workspaceId),
    getWorkspaceType(user.workspaceId),
    resolveTenant({ workspaceId: user.workspaceId }),
  ]);
  if (!role || !workspaceType || 'error' in tenant) return null;
  return {
    userId: user.userId,
    scope: { tenantId: tenant.tenantId, workspaceId: user.workspaceId },
    context: {
      userId: user.userId,
      role,
      workspaceType,
      roles: [role],
      permissions: [],
      permissionMode: 'allowlist',
      allowedTools: [],
    },
  };
};

const resolveRef = async (
  target: Parameters<ResourceProjectionPort['dispatch']>[0]['target'],
  principal: ResourceHttpPrincipal,
): Promise<ResourceRef> => {
  if (target.ref) return { ...target.ref, scope: principal.scope };
  const resolved = await getResourceDispatcher().resolvePath(target.path!, principal);
  if (!resolved) throw new ResourceError('not_found', 'resource path not found');
  return resolved;
};

export const productResourceProjection: ResourceProjectionPort = {
  async dispatch(input) {
    const dispatcher = getResourceDispatcher();
    const principal: ResourcePrincipal = input.principal;
    if (input.verb === 'list' && input.target.path === '/') {
      return dispatcher.listRoot(principal);
    }
    const ref = await resolveRef(input.target, input.principal);
    switch (input.verb) {
      case 'list':
        return dispatcher.list(ref, input.args as ListArgs, principal);
      case 'stat':
        return dispatcher.stat(ref, principal);
      case 'read':
        return dispatcher.read(ref, input.args as ReadArgs, principal);
      case 'grep':
        return dispatcher.grep(ref, input.args as unknown as GrepArgs, principal);
      case 'edit':
        return dispatcher.edit(ref, input.args as unknown as EditArgs, principal);
      case 'invoke':
        return dispatcher.invoke(ref, input.args as unknown as InvokeArgs, principal);
    }
  },
};

export const productResourcesPorts: ResourcesNamespacePorts = {
  resources: productResourceProjection,
  principal: { resolve: resolvePrincipal },
  authenticate: requireAuth,
};
