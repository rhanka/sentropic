import {
  CLI_PATHS as CLUSTER_MESH_CLI_PATHS,
  createCliNamespaceModule,
  type CliCommandIntentAdapter,
  type CliSessionDelegatePort,
} from '@sentropic/cluster-mesh';
import { randomUUID } from 'node:crypto';

import { env } from '../../config/env';
import { requireAuth } from '../../middleware/auth';
import {
  clusterMeshAdapter,
  liveClusterMeshQualification,
} from '../../services/cluster-mesh-adapter';

const control = clusterMeshAdapter.sessionControl!;
if (!control) throw new Error('cluster mesh session control is not configured');

export const CLI_PATHS = CLUSTER_MESH_CLI_PATHS;
export const CLI_ENABLED = control.ptyEvidence === 'adapter_available';

export const h2aCliIntentAdapter: CliCommandIntentAdapter = {
  runnerId: 'h2a',
  source: '@sentropic/h2a',
  parseIntent(argv) {
    if (argv.length === 0 || argv.some((value) => value.length === 0 || value.includes('\0'))) return null;
    return { runnerId: 'h2a', source: '@sentropic/h2a', argv };
  },
};

export const productCliSessionDelegate: CliSessionDelegatePort = {
  kind: 'session-control-http',
  delegate(input) {
    return fetch(`http://localhost:${env.PORT}/api/v1${input.path}`, {
      method: input.method,
      headers: input.headers,
      body: JSON.stringify(input.body),
    });
  },
};

// BR75-SG1 keeps this module unmounted. Package adapters only parse intents;
// they cannot activate process, PTY, or session authority on their own.
export const productCliModule = createCliNamespaceModule({
  enabled: CLI_ENABLED,
  generationId: control.runtime.generation.generationId,
  authenticate: requireAuth,
  adapters: [h2aCliIntentAdapter],
  session: productCliSessionDelegate,
});

export async function runLiveCliQualification() {
  const live = liveClusterMeshQualification;
  if (!live) throw new Error('live CLI qualification is unavailable');
  await live.ensureRegistration();
  const invocationId = `cli-qualification-${randomUUID()}`;
  const requestHeaders = {
    'content-type': 'application/json',
    'x-cluster-mesh-invocation-id': invocationId,
    'x-correlation-id': invocationId,
    'x-cluster-mesh-evidence': live.evidence,
  };
  const verified = await control.runtime.context.verify({
    invocationId,
    correlationId: invocationId,
    generationId: control.runtime.generation.generationId,
    method: 'POST',
    path: '/cli/delegations/drive',
    authorizationEvidenceRef: live.evidence,
  });
  let parses = 0;
  let sessionDelegations = 0;
  const countedAdapter: CliCommandIntentAdapter = {
    ...h2aCliIntentAdapter,
    parseIntent(argv) { parses += 1; return h2aCliIntentAdapter.parseIntent(argv); },
  };
  const countedSession: CliSessionDelegatePort = {
    ...productCliSessionDelegate,
    delegate(input) { sessionDelegations += 1; return productCliSessionDelegate.delegate(input); },
  };
  const module = (context: typeof control.runtime.context) => createCliNamespaceModule({
    enabled: true,
    generationId: control.runtime.generation.generationId,
    adapters: [countedAdapter],
    session: countedSession,
  }).createRouter({ context, receipts: control.runtime.receiptPort });
  const body = {
    runnerId: 'h2a',
    argv: ['status'],
    commandId: `cli-delegation-${randomUUID()}`,
    targetRegistrationId: live.registration.registrationId,
    idempotencyKey: `cli-delegation-${randomUUID()}`,
  };
  const missing = await module({
    verify: async () => ({ ...verified, registration: undefined }),
  }).request('/delegations/drive', {
    method: 'POST', headers: requestHeaders, body: JSON.stringify(body),
  });
  const missingEvidence = { status: missing.status, parses, sessionDelegations };
  const delegated = await module(control.runtime.context).request('/delegations/drive', {
    method: 'POST', headers: requestHeaders, body: JSON.stringify(body),
  });
  const delegatedBody = await delegated.json() as { effectRef?: string };
  const survivingLegacyHttpPaths: string[] = [];
  for (const path of ['/command', '/commands', '/terminal', '/shell']) {
    const response = await fetch(`http://localhost:${env.PORT}/api/v1${path}`, { method: 'POST' });
    if (response.status !== 404) survivingLegacyHttpPaths.push(path);
  }
  return {
    missingRegistration: missingEvidence,
    delegated: {
      status: delegated.status,
      action: 'drive' as const,
      path: '/auth/session/control/drive',
      receiptRef: delegatedBody.effectRef,
      sessionDelegations,
    },
    survivingLegacyHttpPaths,
  };
}
