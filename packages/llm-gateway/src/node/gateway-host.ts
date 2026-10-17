import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { GatewaySessionService } from '../session-service.js';
import { GatewayStateError } from '../ports/gateway-state.js';
import { createGatewayRouter } from '../router/index.js';
import { ControlServer } from './control-server.js';
import { startControlSocket } from './control-socket.js';
import { FileGatewayStateStore } from './gateway-state-store.js';
import { createNodeGatewayServer, closeNodeServer, listenNodeServer } from './http-server.js';
import { createSessionAuth } from './session-auth.js';
import type { GatewayHostHandle, HostReadiness, StartGatewayHostOptions } from './host-types.js';
export { resolveGatewayStateDir } from './state-directory.js';
export type { GatewayHostHandle, HostReadiness, MeshBinding, StartGatewayHostOptions } from './host-types.js';

/** One durable issuer/router/control implementation for every Node consumer. */
export const startGatewayHost = async (options: StartGatewayHostOptions): Promise<GatewayHostHandle> => {
  const { stateDir, mesh } = options;
  const ownerScopeRef = mesh.ownerScopeRef;
  if (!isAbsolute(stateDir) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(ownerScopeRef)
    || !['127.0.0.1', '::1', 'localhost'].includes(options.listen.host) || process.platform === 'win32') {
    throw new GatewayStateError('private gateway host binding is unavailable', 'STORE-FAILED');
  }
  const socket = options.controlSocket ?? join(stateDir, 'control.sock');
  if (!isAbsolute(socket) || dirname(resolve(socket)) !== resolve(stateDir)) throw new GatewayStateError('controlSocket must be inside stateDir', 'STORE-FAILED');
  const store = new FileGatewayStateStore({ stateDir, keyring: mesh.keyring });
  const releaseWriter = await store.claimWriter();
  const service = new GatewaySessionService(store);
  let draining = false; let stopped = false; let recovered = false; let controlReady = false;
  let server: Server | undefined; let active = 0; let drained: (() => void) | undefined; let drainPromise: Promise<void> | undefined;
  const readiness = async (): Promise<HostReadiness> => {
    let keyring = false; let state = false;
    if (!stopped) {
      try { await mesh.unlockKeyring(); keyring = true; } catch { /* locked */ }
      try {
        await store.load();
        if (!recovered) { await service.reconcilePending(); recovered = true; }
        state = true;
      } catch { /* Static not-ready; corrupt state is never replaced. */ }
    }
    const checks = { keyring, state, control: controlReady && !stopped, dataPlane: Boolean(server?.listening) && !draining };
    return { ready: Object.values(checks).every(Boolean), checks };
  };
  const requireReady = async () => {
    if (!(await readiness()).ready) throw new GatewayStateError('gateway host not ready', 'STORE-FAILED');
  };
  const controlToken = randomBytes(32).toString('base64url');
  const control = new ControlServer({ service, ownerScopeRef,
    controlToken, beforeAcquire: requireReady });
  let closeControl: (() => Promise<void>) | undefined;
  let endpoint = '';
  try {
    const router = createGatewayRouter({ ...mesh.gateway,
      config: { ...mesh.gateway.config, callerAuth: createSessionAuth({ service, ownerScopeRef,
        ready: async () => (await readiness()).ready, resolveOwner: (caller, context) => mesh.resolveOwner(caller, context) }) },
      readiness: { isReady: async () => (await readiness()).ready },
      requestAudit: { admit: async ({ cost, requestId, model }) => {
        const receipt = await service.recordAttempt({ ownerScopeRef, sessionRef: cost.gatewaySessionRef!, requestId, model });
        return { receiptId: receipt.receiptId };
      }, refuse: async (receiptId) => {
        const current = await service.readReceipt({ ownerScopeRef, receiptId });
        if (current.settlement === 'pending') await service.settleReceipt({ ownerScopeRef, receiptId, outcome: 'error' });
      } },
      routeMetering: { settleRoute: async (context) => {
        await mesh.gateway.routeMetering.settleRoute(context);
        if (context.cost.gatewayReceiptId) await service.settleReceipt({ ownerScopeRef,
          receiptId: context.cost.gatewayReceiptId, outcome: context.outcome === 'success' ? 'stop' : context.outcome === 'cancelled' ? 'cancelled' : 'error' });
      } },
    });
    server = createNodeGatewayServer((request) => router.fetch(request), () => endpoint, (delta) => {
      active += delta; if (active === 0) { drained?.(); drained = undefined; }
    });
    closeControl = await startControlSocket(socket, control, controlToken);
    controlReady = true;
    endpoint = await listenNodeServer(server, options.listen);
    await readiness();
    return { endpoint, controlSocket: socket, readiness,
      drain: async () => { draining = true; if (active > 0) await (drainPromise ??= new Promise<void>((resolve) => { drained = resolve; })); },
      stop: async () => {
        if (stopped) return; stopped = true; draining = true;
        try {
          server!.closeAllConnections();
          await Promise.all([closeControl!(), closeNodeServer(server!)]);
          await service.reconcilePending();
        } finally { await releaseWriter(); }
      },
    };
  } catch (error) {
    try { if (server?.listening) await closeNodeServer(server); await closeControl?.(); }
    finally { await releaseWriter(); }
    throw error;
  }
};
