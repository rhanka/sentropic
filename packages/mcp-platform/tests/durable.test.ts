/**
 * Slice 7 — §11 "Long call lifecycle" probe matrix for the mock durable-call /
 * workflow adapter.
 *
 * Explicit pass/fail assertions for the canonical DurableCall lifecycle (§8 ->
 * Hermes §3.2): queue -> run -> wait(elicitation) -> resume -> succeed; cancel
 * from waiting; failure path; idempotent re-launch returns the same id; a
 * mid-flight call survives a restart (reload) and resumes; a waiting-on-consent
 * call cannot succeed until consent is present; no token/secret value ever appears
 * in a durable-call audit. Plus the long-tool wiring (returns a DurableCallRef).
 *
 * MOCK-ONLY: tmp-file JSON store under the OS tmp dir; no real workflow engine,
 * queue, network or DB.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileRecordStore } from '../src/persistence.js';
import { DurableCallAdapter, PersistentDurableCallStore } from '../src/durable.js';
import { ElicitationManager } from '../src/elicitation.js';
import { InMemoryAuditSink, SecretRedactor } from '../src/audit.js';
import { createStpConnectorContext, MockSecretStore } from '../src/context.js';
import { createFakeConnector, fakeManifest } from '../src/mock/fake-connector.js';
import type { AppToolInvocation, McpDurableCall } from '../src/runtime.js';

const T = 2_000_000_000_000; // fixed clock (ms)
const CONN = 'conn-1';

const paths: string[] = [];
const tmpPath = (): string => {
  const p = join(tmpdir(), 'sentropic-mcp-platform-test', `dc-${randomUUID()}.json`);
  paths.push(p);
  return p;
};
afterEach(() => {
  for (const p of paths.splice(0)) new FileRecordStore(p).destroy();
});

type EnvOver = {
  idempotencyKey?: string;
  elicitationRef?: string;
  sub?: string;
  sessionId?: string;
  capabilityRef?: string;
};

const envelope = (over: EnvOver = {}): AppToolInvocation => {
  const redactor = new SecretRedactor();
  const ctx = createStpConnectorContext({
    requestId: 'req-1',
    correlationId: 'corr-1',
    auditId: 'audit-1',
    principal: {
      sub: over.sub ?? 'user-1',
      claims: {},
      scopes: ['widgets:read'],
      tenantRef: 'tenant-a',
      authTime: new Date(T).toISOString(),
    },
    surface: 'chat',
    mcpSessionId: over.sessionId ?? 'sess-1',
    connectorInstanceId: CONN,
    consentRefs: ['consent-1'],
    grantRefs: [],
    secretStore: new MockSecretStore(redactor),
    audit: new InMemoryAuditSink(redactor),
  });
  return {
    capabilityRef: over.capabilityRef ?? 'export_widgets',
    input: { format: 'csv' },
    ctx,
    idempotencyKey: over.idempotencyKey,
    elicitationRef: over.elicitationRef,
  };
};

const newAdapter = (over: Partial<ConstructorParameters<typeof DurableCallAdapter>[0]> = {}) =>
  new DurableCallAdapter({ audit: new InMemoryAuditSink(new SecretRedactor()), now: () => T, ...over });

const driveElicitationToResumed = (m: ElicitationManager, id: string): void => {
  m.create({ id, mode: 'confirm', sessionRef: 'sess-1', capabilityRef: 'export_widgets', actor: { sub: 'user-1' }, ttlSeconds: 300, auditId: 'audit-1' });
  m.render(id);
  m.answer(id, { sub: 'user-1', isHuman: true });
  m.validate(id);
  m.resume(id);
};

describe('§11 DurableCall — long call lifecycle (§8)', () => {
  it('queued -> running -> waiting(elicitation) -> resume -> succeeded', () => {
    const elic = new ElicitationManager();
    const adapter = newAdapter({ elicitations: elic });
    const id = adapter.launch({ envelope: envelope({ idempotencyKey: 'idem-1', elicitationRef: 'el-1' }) }).call.id;

    expect(adapter.status(id)?.call.state).toBe('queued');
    expect(adapter.start(id).call.state).toBe('running');

    const w = adapter.wait(id, 'elicitation');
    expect(w.call.state).toBe('waiting');
    expect(w.waitingFor).toBe('elicitation'); // canonical `waiting` qualified (§8)

    // gate not yet released → resume is blocked, the call stays waiting (fail-closed)
    expect(adapter.resume(id).call.state).toBe('waiting');

    driveElicitationToResumed(elic, 'el-1');
    const resumed = adapter.resume(id, { checkpointRef: 'cp-1' });
    expect(resumed.call.state).toBe('running');
    expect(resumed.waitingFor).toBeUndefined();
    expect(resumed.call.checkpointRef).toBe('cp-1');

    const done = adapter.succeed(id, 'evidence-1');
    expect(done.call.state).toBe('succeeded');
    expect(done.call.evidenceRefs).toContain('evidence-1');
  });

  it('cancel from waiting records the reason and is terminal', () => {
    const adapter = newAdapter();
    const id = adapter.launch({ envelope: envelope() }).call.id;
    adapter.start(id);
    adapter.wait(id, 'external-workflow');

    const c = adapter.cancel(id, 'user-aborted');
    expect(c.call.state).toBe('cancelled');
    expect(c.refs.cancellationReason).toBe('user-aborted');

    // terminal: further transitions are no-ops (state unchanged)
    expect(adapter.start(id).call.state).toBe('cancelled');
    expect(adapter.succeed(id).call.state).toBe('cancelled');
    expect(adapter.resume(id).call.state).toBe('cancelled');
  });

  it('failure path: a running call transitions to failed and can no longer succeed', () => {
    const adapter = newAdapter();
    const id = adapter.launch({ envelope: envelope() }).call.id;
    adapter.start(id);

    expect(adapter.fail(id, 'connector_error').call.state).toBe('failed');
    expect(adapter.succeed(id).call.state).toBe('failed'); // fail-closed terminal
  });

  it('idempotent re-launch with the same idempotencyKey returns the SAME call (no duplicate)', () => {
    const store = new PersistentDurableCallStore();
    const adapter = newAdapter({ store });
    const a = adapter.launch({ envelope: envelope({ idempotencyKey: 'idem-9' }) });
    const b = adapter.launch({ envelope: envelope({ idempotencyKey: 'idem-9' }) });

    expect(b.call.id).toBe(a.call.id);
    expect(store.all()).toHaveLength(1); // no duplicate created
  });

  it('a mid-flight durable call survives a restart (reload) and resumes', () => {
    const path = tmpPath();
    const a1 = newAdapter({ store: new PersistentDurableCallStore(new FileRecordStore<McpDurableCall>(path)) });
    const id = a1.launch({ envelope: envelope({ idempotencyKey: 'idem-r', elicitationRef: 'el-r' }) }).call.id;
    a1.start(id);
    a1.wait(id, 'elicitation');

    // simulated restart: brand-new adapter at the SAME medium; gate now released
    const elic2 = new ElicitationManager();
    driveElicitationToResumed(elic2, 'el-r');
    const a2 = newAdapter({
      store: new PersistentDurableCallStore(new FileRecordStore<McpDurableCall>(path)),
      elicitations: elic2,
    });

    expect(a2.status(id)?.call.state).toBe('waiting'); // survived restart
    expect(a2.status(id)?.waitingFor).toBe('elicitation');
    expect(a2.resume(id).call.state).toBe('running');
    expect(a2.succeed(id).call.state).toBe('succeeded');
  });

  it('a waiting-on-consent call cannot succeed until consent is present', () => {
    let consentPresent = false;
    const adapter = newAdapter({
      isWaitCleared: (rec) => (rec.waitingFor === 'consent' ? consentPresent : false),
    });
    const id = adapter.launch({ envelope: envelope() }).call.id;
    adapter.start(id);
    adapter.wait(id, 'consent');

    // consent absent → resume blocked, succeed impossible (only reachable from running)
    expect(adapter.resume(id).call.state).toBe('waiting');
    expect(adapter.succeed(id).call.state).toBe('waiting');

    // consent arrives → resume clears the wait, then it can succeed
    consentPresent = true;
    expect(adapter.resume(id).call.state).toBe('running');
    expect(adapter.succeed(id).call.state).toBe('succeeded');
  });

  it('no token/secret value ever appears in a durable-call audit event', () => {
    const SECRET = 'sk-durable-secret-abc123';
    const redactor = new SecretRedactor();
    redactor.register(SECRET);
    const audit = new InMemoryAuditSink(redactor);
    const adapter = new DurableCallAdapter({ audit, now: () => T });

    const id = adapter.launch({ envelope: envelope({ idempotencyKey: 'idem-s' }) }).call.id;
    adapter.start(id);
    adapter.wait(id, 'freshness');
    adapter.cancel(id, 'cleanup');

    expect(audit.dump()).not.toContain(SECRET); // no secret leakage (§5.2(b) / §11)
    // and the lifecycle WAS audited (we assert against real events, not absence)
    expect(audit.events.map((e) => e.kind)).toEqual(
      expect.arrayContaining(['durable.launch', 'durable.start', 'durable.wait', 'durable.cancel']),
    );
  });
});

describe('§8 long-running tool wiring', () => {
  it('the manifest declares the long tool as long-running + workflow-backed (§4.2 durability)', () => {
    expect(fakeManifest.durability.longRunningTools).toContain('export_widgets');
    expect(fakeManifest.durability.workflowBackedTools).toContain('export_widgets');
    expect(fakeManifest.tools.map((t) => t.name)).toContain('export_widgets');
  });

  it('a long-running tool returns a DurableCallRef instead of an inline result (§8)', async () => {
    const adapter = newAdapter();
    const connector = createFakeConnector({ launchDurable: (req) => adapter.launch({ envelope: req }).call.id });

    const ref = await connector.invokeTool(envelope({ capabilityRef: 'export_widgets', idempotencyKey: 'idem-c' }));
    expect(typeof ref).toBe('string'); // DurableCallRef, not an AppToolResult
    expect(adapter.status(ref as string)?.call.state).toBe('queued');
    expect(adapter.status(ref as string)?.call.capabilityRef).toBe('export_widgets');

    // a short tool still returns an inline result object
    const inline = await connector.invokeTool(envelope({ capabilityRef: 'create_widget' }));
    expect(typeof inline).toBe('object');
  });

  it('a long-running tool fails closed when no durable backend is wired', async () => {
    const connector = createFakeConnector(); // no launchDurable
    const res = await connector.invokeTool(envelope({ capabilityRef: 'export_widgets' }));
    expect(typeof res).toBe('object');
    expect((res as { ok: boolean }).ok).toBe(false);
  });
});
