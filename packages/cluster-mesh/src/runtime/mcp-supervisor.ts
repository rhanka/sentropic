import type { StoredMcpServer } from '../persistence/ports.js';

export type McpSupervisorRefusal =
  | 'session_server_forbidden'
  | 'missing_registration'
  | 'stale_registration'
  | 'logical_server_exists';

export type McpSupervisorClaim =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: Exclude<McpSupervisorRefusal, 'session_server_forbidden'> };

export interface McpSupervisorStore {
  findMcpServer(generationId: string): Promise<StoredMcpServer | null>;
  claimMcpServer(server: StoredMcpServer, now: string): Promise<McpSupervisorClaim>;
  saveMcpServer(server: StoredMcpServer): Promise<void>;
}

export interface McpSupervisorRegistration {
  readonly serverId: string;
  readonly generationId: string;
  readonly supervisorRef: string;
  readonly leaseExpiresAt: string;
  /** Any session identity is invalid: MCP server ownership is generation-scoped only. */
  readonly sessionRef?: string;
}

export type McpSupervisorResult =
  | { readonly ok: true; readonly server: StoredMcpServer }
  | { readonly ok: false; readonly reason: McpSupervisorRefusal };

export interface McpHandoverCheckpoint {
  readonly previous: StoredMcpServer;
  readonly selected: StoredMcpServer;
}

export function createMcpSupervisor(input: {
  readonly store: McpSupervisorStore;
  readonly now?: () => Date;
}) {
  const now = input.now ?? (() => new Date());

  const register = async (registration: McpSupervisorRegistration): Promise<McpSupervisorResult> => {
    if (registration.sessionRef !== undefined) {
      return { ok: false, reason: 'session_server_forbidden' };
    }
    if (new Date(registration.leaseExpiresAt).getTime() <= now().getTime()) {
      return { ok: false, reason: 'stale_registration' };
    }
    const server: StoredMcpServer = {
      serverId: registration.serverId,
      generationId: registration.generationId,
      supervisorRef: registration.supervisorRef,
      status: 'active',
      leaseExpiresAt: registration.leaseExpiresAt,
    };
    const claimed = await input.store.claimMcpServer(server, now().toISOString());
    return claimed.ok ? { ok: true, server } : claimed;
  };

  const authorize = async (
    generationId: string,
    supervisorRef: string,
  ): Promise<McpSupervisorResult> => {
    const server = await input.store.findMcpServer(generationId);
    if (!server) return { ok: false, reason: 'missing_registration' };
    if (server.status !== 'active' || server.supervisorRef !== supervisorRef) {
      return { ok: false, reason: 'stale_registration' };
    }
    if (new Date(server.leaseExpiresAt).getTime() <= now().getTime()) {
      return { ok: false, reason: 'stale_registration' };
    }
    return { ok: true, server };
  };

  const handover = async (inputHandover: {
    readonly fromGenerationId: string;
    readonly to: McpSupervisorRegistration;
  }): Promise<{ ok: true; checkpoint: McpHandoverCheckpoint } | { ok: false; reason: McpSupervisorRefusal }> => {
    const previous = await input.store.findMcpServer(inputHandover.fromGenerationId);
    if (!previous || previous.status !== 'active') return { ok: false, reason: 'missing_registration' };
    const selected = await register(inputHandover.to);
    if (!selected.ok) return selected;
    await input.store.saveMcpServer({ ...previous, status: 'stopped' });
    return { ok: true, checkpoint: { previous, selected: selected.server } };
  };

  const rollback = async (checkpoint: McpHandoverCheckpoint): Promise<McpSupervisorResult> => {
    if (new Date(checkpoint.previous.leaseExpiresAt).getTime() <= now().getTime()) {
      return { ok: false, reason: 'stale_registration' };
    }
    const selected = await input.store.findMcpServer(checkpoint.selected.generationId);
    if (selected?.serverId === checkpoint.selected.serverId) {
      await input.store.saveMcpServer({ ...selected, status: 'stopped' });
    }
    const restored = { ...checkpoint.previous, status: 'active' as const };
    await input.store.saveMcpServer(restored);
    return { ok: true, server: restored };
  };

  return { register, authorize, handover, rollback };
}
