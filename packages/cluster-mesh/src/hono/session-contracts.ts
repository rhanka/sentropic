import type { Handler } from 'hono';
import type { ClusterMeshRuntimeStore } from '../persistence/ports.js';
import type { ClusterMeshRuntime } from '../runtime/generation.js';

export interface SessionRouteHandlers {
  readonly current: Handler;
  readonly refresh: Handler;
  readonly extensionToken: Handler;
  readonly logout: Handler;
  readonly logoutAll: Handler;
  readonly list: Handler;
}

export interface DeviceRouteHandlers {
  readonly issue: Handler;
  readonly poll: Handler;
  readonly approve: Handler;
}

export interface SessionPathProjection {
  readonly session: string;
  readonly device: string;
  readonly control: string;
}

export interface SessionAuthorSelectionPort {
  ensureAuthor(): Promise<{
    readonly ok: boolean;
    readonly reason?: 'cutover_unavailable' | 'wrong_author';
  }>;
}

export interface SessionTargetStatePort {
  inspect(actuatorRef: string): Promise<'alive' | 'dead' | 'parked' | 'unknown'>;
}

export interface SessionControlPorts {
  readonly runtime: ClusterMeshRuntime;
  readonly store: Pick<
    ClusterMeshRuntimeStore,
    'enqueueCommand' | 'markRegistrationLost' | 'updateCommand'
  >;
  readonly targets: SessionTargetStatePort;
  readonly author: SessionAuthorSelectionPort;
  readonly now?: () => Date;
}
