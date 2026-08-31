/**
 * BR75-EX5 native cross-repository contract proof. Every effect dependency is fake.
 * Replay type + runtime proof:
 * /home/antoinefa/src/h2a/tmp/pty-actuator-adapter/node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext packages/cluster-mesh/tests/a1-integration/a1-hermetic.test.ts && /home/antoinefa/src/h2a/tmp/pty-actuator-adapter/node_modules/.bin/tsx --test packages/cluster-mesh/tests/a1-integration/a1-hermetic.test.ts
 */
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { test } from 'node:test';
import { createH2aPtyActuator, createH2aSessionTargetState,
  type ActuationTarget, type H2aPtyActuatorDeps,
} from '/home/antoinefa/src/h2a/tmp/pty-actuator-adapter/packages/h2a/dist/index.js';
import type { createH2aPtyActuator as CreateH2aPtyActuator,
  createH2aSessionTargetState as CreateH2aSessionTargetState,
} from '/home/antoinefa/src/h2a/tmp/pty-actuator-adapter/packages/h2a/dist/index.js';
import type { ClusterMeshRegistration, PtyActuatorPort, SessionTargetStatePort } from '../../dist/index.js';

type Expect<T extends true> = T;
type H2aPtySatisfiesClusterMesh = Expect<ReturnType<
  typeof CreateH2aPtyActuator> extends PtyActuatorPort ? true : false>;
type H2aTargetStateSatisfiesClusterMesh = Expect<ReturnType<
  typeof CreateH2aSessionTargetState> extends SessionTargetStatePort ? true : false>;

const localRuntimeModules: Record<string, string> = {
  hono: 'file:///home/antoinefa/src/h2a/tmp/pty-actuator-adapter/node_modules/hono/dist/index.js',
  '@sentropic/contracts': new URL('../../../contracts/dist/index.js', import.meta.url).href,
  '@sentropic/events': new URL('../../../events/dist/index.js', import.meta.url).href,
};
type RegisterHooks = (hooks: { resolve(specifier: string, context: object,
  nextResolve: (specifier: string, context: object) => unknown): unknown }) => void;
const registerHooks = (nodeModule as unknown as { registerHooks: RegisterHooks }).registerHooks;
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(localRuntimeModules[specifier] ?? specifier, context);
},
});

const now = new Date('2026-08-31T12:00:00.000Z');
const actuatorRef = 'h2a-pty:v1:a1-session';
const registration: ClusterMeshRegistration = {
  registrationId: 'registration-a1', generationId: 'generation-a1',
  principalId: 'workload-a1', workspaceId: 'workspace-a1',
  custodyHolderPrincipalId: 'workload-a1', custodyEpoch: 1, actuatorRef,
  status: 'active', expiresAt: '2026-09-01T12:00:00.000Z',
  leaseExpiresAt: '2026-09-01T12:00:00.000Z',
};

test('should prove the A1 session contract with injected fakes only', async () => {
  const clusterMeshSource = '../../src/index.js';
  const {
    createClusterMeshRuntime, createRegistrationGate, createSessionNamespaceModule,
  } = await import(clusterMeshSource) as typeof import('../../dist/index.js');
  let storedRegistration: ClusterMeshRegistration | null = null;
  let targetState: 'alive' | 'dead' = 'alive';
  let phase: 'A' | 'B' = 'A';
  let driveCalls = 0, wakeCalls = 0, relaunchCalls = 0;
  let lostRegistrationId: string | undefined;
  const receipts: Array<{ stage: string; effectRef?: string; invocationId?: string; reason?: string }> = [];
  const resolutions: Array<{ consumer: 'pty' | 'targets'; ref: string; registered: boolean }> = [];
  const target: ActuationTarget = {
    kind: 'tmux', target: 'a1-session:0.1', instance: 'a1-session',
    launchContext: { cwd: '/hermetic-fixture', command: 'agent start', resumeCommand: 'agent resume',
      tmux: { session: 'a1-session', window: '0', pane: '1' } },
  };
  const drivers = {
    drive: { async drive() { driveCalls += 1; phase = 'B'; return true; } },
    wake: { async drive() { wakeCalls += 1; return true; } },
  };
  const relauncher = { async relance() { relaunchCalls += 1; return true; } };
  const relaunchers = { 'native-terminal': relauncher, tmux: relauncher, opaque: relauncher };
  const fakeDeps = (consumer: 'pty' | 'targets'): H2aPtyActuatorDeps => ({
    resolveActuationTarget(ref, observedRegistration) {
      resolutions.push({ consumer, ref, registered: observedRegistration !== undefined }); return target;
    },
    async probeAliveness() { return targetState; },
    drivers, relaunchers, now: () => now.getTime(),
  });
  const pty: PtyActuatorPort = createH2aPtyActuator(fakeDeps('pty'));
  const targets: SessionTargetStatePort = createH2aSessionTargetState(fakeDeps('targets'));
  const context = (invocationId: string) => ({
    invocationId, correlationId: invocationId, generationId: 'generation-a1',
    principal: { principalId: 'workload-a1', kind: 'workload' as const, verifierId: 'fake' },
    workspace: { bindingId: 'binding-a1', workspaceId: 'workspace-a1', revision: '1' },
    scopes: ['session:drive'], policyRevision: '1', issuedAt: now.toISOString(),
    registration: { registrationId: registration.registrationId,
      generationId: registration.generationId, workspaceId: registration.workspaceId,
      actuatorRef, custodyEpoch: 1, expiresAt: registration.expiresAt },
    custody: { custodyId: 'custody-a1', holderPrincipalId: 'workload-a1', epoch: 1 },
  });
  const runtime = createClusterMeshRuntime({
    generationId: 'generation-a1', config: { capacity: { poolSize: 4 } },
    context: { async verify(request: { invocationId: string }) { return context(request.invocationId); } },
    registration: createRegistrationGate({ generationId: 'generation-a1',
      registrations: { async find() { return storedRegistration; } }, pty, now: () => now }),
    receipts: { async append(receipt: { stage: string; effectRef?: string }) { receipts.push(receipt); } },
    now: () => now,
  });
  const store = {
    async enqueueCommand() { return true; },
    async updateCommand() { return true; },
    async markRegistrationLost(id: string, lostAt: string) {
      lostRegistrationId = id; storedRegistration = { ...registration, status: 'lost', lostAt };
      return true;
    },
  };
  const ok = (c: { json(value: unknown): Response }) => c.json({ ok: true });
  const module = createSessionNamespaceModule({
    handlers: { current: ok, refresh: ok, extensionToken: ok, logout: ok, logoutAll: ok, list: ok },
    devices: { issue: ok, poll: ok, approve: ok },
    projection: { session: '/', device: '/device', control: '/control' },
    control: { runtime, store, targets,
      author: { async ensureAuthor() { return { ok: true }; } }, now: () => now },
  });
  const app = module.createRouter({ context: runtime.context, receipts: runtime.receiptPort });
  const act = (action: 'drive' | 'wake' | 'relaunch', commandId: string) =>
    app.request(`/control/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandId, targetRegistrationId: registration.registrationId,
        idempotencyKey: `key-${commandId}` }),
    });

  const missing = await act('drive', 'command-missing');
  assert.deepEqual([missing.status, await missing.json()], [409, { error: 'missing_registration' }]);
  storedRegistration = registration;
  const driven = await act('drive', 'command-drive');
  const drivenBody = await driven.json() as { status: string; effectRef: string };
  assert.deepEqual([driven.status, drivenBody.status], [200, 'acted']);
  assert.equal(phase, 'B');
  assert.match(drivenBody.effectRef, /^h2a-pty:acted:drive:/);
  assert.ok(!receipts.some((receipt) => receipt.invocationId === 'command-drive' && receipt.reason === 'missing_registration'));
  assert.ok(receipts.some((receipt) =>
    receipt.stage === 'acted' && receipt.effectRef === drivenBody.effectRef));

  const relaunched = await act('relaunch', 'command-relaunch');
  const relaunchBody = await relaunched.json() as { status: string; actedTargets: string[] };
  assert.deepEqual([relaunched.status, relaunchBody.status], [200, 'acted']);
  assert.deepEqual(relaunchBody.actedTargets, ['a1-session:0.1']);
  assert.equal(relaunchCalls, 1);

  targetState = 'dead';
  const lost = await act('wake', 'command-dead');
  assert.deepEqual([lost.status, await lost.json()], [409, { error: 'actuator_unavailable' }]);
  assert.equal(lostRegistrationId, registration.registrationId);
  assert.equal(storedRegistration.status, 'lost');
  assert.equal(driveCalls, 1);
  assert.equal(wakeCalls, 0);
  assert.ok(resolutions.some(({ consumer, registered }) => consumer === 'pty' && registered));
  assert.ok(resolutions.some(({ consumer }) => consumer === 'targets'));
  assert.ok(resolutions.every(({ ref }) => ref === actuatorRef));
});
