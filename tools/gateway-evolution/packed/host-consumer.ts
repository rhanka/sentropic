import { startGatewayHost, resolveGatewayStateDir, type MeshBinding } from '@sentropic/llm-gateway/node';
import { createGatewayControlClient } from '@sentropic/llm-gateway/node/control-client';
import type { LaunchRoutingContract } from '@sentropic/llm-mesh';
declare const mesh: MeshBinding;
declare const routingContract: LaunchRoutingContract;
// Compiled against installed declarations only; never executes a provider or reads credentials.
const consumer = async () => {
  const host = await startGatewayHost({ mesh, stateDir: resolveGatewayStateDir({ ownerScopeRef: mesh.ownerScopeRef }), listen: { host: '127.0.0.1', port: 0 } });
  const control = createGatewayControlClient({ controlSocket: host.controlSocket });
  const issued = await control.acquireSession({ ownerScopeRef: mesh.ownerScopeRef, workspaceRef: 'w', clientSessionRef: 'c', routingContract });
  const key: string | undefined = issued.key;
  await control.listSessions({ ownerScopeRef: mesh.ownerScopeRef });
  await control.revokeSession({ ownerScopeRef: mesh.ownerScopeRef, sessionRef: issued.sessionRef });
  await host.readiness(); await host.drain(); await host.stop();
  return key;
};
void consumer;
