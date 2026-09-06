export type LockRouteObjectType = 'organization' | 'folder' | 'initiative' | 'usecase';
export type LockAccessLevel = 'access' | 'editor' | 'admin';

export interface LockPrincipal {
  readonly userId: string;
  readonly workspaceId: string;
  readonly email?: string | null;
  readonly displayName?: string | null;
}

export interface LockScope {
  readonly workspaceId: string;
  readonly objectType: LockRouteObjectType;
  readonly objectId: string;
}

export interface LocksDomainPort {
  read(scope: LockScope): Promise<unknown | null>;
  acquire(input: LockScope & { userId: string; ttlMs?: number }): Promise<{
    lock: unknown;
    acquired: boolean;
  }>;
  release(input: LockScope & { userId: string }): Promise<{ released: boolean }>;
  requestUnlock(input: LockScope & { userId: string; message?: string }): Promise<{
    requested: boolean;
    lock: unknown | null;
  }>;
  acceptUnlock(input: LockScope & { userId: string }): Promise<{
    accepted: boolean;
    lock: unknown | null;
  }>;
  forceUnlock(input: LockScope & { userId: string }): Promise<{ forced: boolean }>;
}

export interface LockPresenceSnapshot {
  readonly users: readonly {
    readonly userId: string;
    readonly email: string | null;
    readonly displayName: string | null;
  }[];
  readonly total: number;
}

export interface LocksPresencePort {
  list(scope: LockScope): Promise<LockPresenceSnapshot>;
  record(input: LockScope & { user: LockPrincipal }): Promise<LockPresenceSnapshot>;
  remove(input: LockScope & { userId: string }): Promise<LockPresenceSnapshot>;
}

export interface LocksAuthorizationPort {
  permits(principal: LockPrincipal, required: LockAccessLevel): Promise<boolean>;
}

export interface LocksStreamPort {
  clearForUser(userId: string): Promise<void>;
  readLock(scope: Omit<LockScope, 'objectType'> & { objectType: string }): Promise<unknown | null>;
  readPresence(scope: Omit<LockScope, 'objectType'> & { objectType: string }): Promise<LockPresenceSnapshot>;
}

export interface LocksNamespacePorts {
  readonly locks: LocksDomainPort;
  readonly presence: LocksPresencePort;
  readonly authorization: LocksAuthorizationPort;
  readonly stream: LocksStreamPort;
}
