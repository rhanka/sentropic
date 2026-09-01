import {
  clearPresenceForUser,
  listPresence,
  recordPresence,
  removePresence,
} from '../../services/lock-presence';
import {
  acceptUnlock,
  acquireLock,
  clearLocksForUser,
  forceUnlock,
  getActiveLock,
  releaseLock,
  requestUnlock,
  type LockObjectType,
} from '../../services/lock-service';
import {
  requireWorkspaceAccess,
  requireWorkspaceAdmin,
  requireWorkspaceEditor,
} from '../../services/workspace-access';
import type {
  LockAccessLevel,
  LockPrincipal,
  LockRouteObjectType,
  LockScope,
  LocksNamespacePorts,
} from './locks-ports';

const domainScope = <T extends LockScope>(input: T): Omit<T, 'objectType'> & {
  objectType: LockObjectType;
} => ({ ...input, objectType: input.objectType as LockObjectType });

const authorizer = (level: LockAccessLevel) => ({
  access: requireWorkspaceAccess,
  editor: requireWorkspaceEditor,
  admin: requireWorkspaceAdmin,
})[level];

const isRouteObjectType = (value: string): value is LockRouteObjectType =>
  ['organization', 'folder', 'initiative', 'usecase'].includes(value);

export const productLocksPorts: LocksNamespacePorts = {
  locks: {
    read: (scope) => getActiveLock(scope.workspaceId, scope.objectType as LockObjectType, scope.objectId),
    acquire: (input) => acquireLock(domainScope(input)),
    release: (input) => releaseLock(domainScope(input)),
    requestUnlock: (input) => requestUnlock(domainScope(input)),
    acceptUnlock: (input) => acceptUnlock(domainScope(input)),
    forceUnlock: (input) => forceUnlock(domainScope(input)),
  },
  presence: {
    list: async (scope) => listPresence(domainScope(scope)),
    record: (input) => recordPresence({
      ...domainScope(input),
      user: {
        userId: input.user.userId,
        email: input.user.email ?? null,
        displayName: input.user.displayName ?? null,
      },
    }),
    remove: (input) => removePresence(domainScope(input)),
  },
  authorization: {
    async permits(principal: LockPrincipal, required: LockAccessLevel) {
      try {
        await authorizer(required)(principal.userId, principal.workspaceId);
        return true;
      } catch {
        return false;
      }
    },
  },
  stream: {
    async clearForUser(userId) {
      await Promise.all([clearLocksForUser(userId), clearPresenceForUser(userId)]);
    },
    readLock: (scope) => isRouteObjectType(scope.objectType)
      ? getActiveLock(scope.workspaceId, scope.objectType as LockObjectType, scope.objectId)
      : Promise.resolve(null),
    readPresence: async (scope) => isRouteObjectType(scope.objectType)
      ? listPresence(domainScope({ ...scope, objectType: scope.objectType }))
      : { users: [], total: 0 },
  },
};
