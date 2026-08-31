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
import { idempotencyDigest } from '../src/digest.js';
import { ElicitationManager, type ElicitationRecord } from '../src/elicitation.js';
import { PersistentElicitationStore } from '../src/stores.js';
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
  tenant?: string;
  connectorInstanceId?: string;
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
      tenantRef: over.tenant ?? 'tenant-a',
      authTime: new Date(T).toISOString(),
    },
    surface: 'chat',
    mcpSessionId: over.sessionId ?? 'sess-1',
    connectorInstanceId: over.connectorInstanceId ?? CONN,
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

// Drive an elicitation to `resumed`, optionally bound to a FOREIGN
// capability/session/principal (to probe G1 gate non-fungibility). Defaults bind
// to the default durable envelope (export_widgets / sess-1 / user-1).
const driveElicitation = (
  m: ElicitationManager,
  id: string,
  over: { capabilityRef?: string; sessionRef?: string; sub?: string } = {},
): void => {
  const sub = over.sub ?? 'user-1';
  m.create({
    id,
    mode: 'confirm',
    sessionRef: over.sessionRef ?? 'sess-1',
    capabilityRef: over.capabilityRef ?? 'export_widgets',
    actor: { sub },
    ttlSeconds: 300,
    auditId: 'audit-1',
  });
  m.render(id);
  m.answer(id, { sub, isHuman: true });
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

  it('G4: a secret-looking idempotencyKey never appears raw in a durable-call audit', () => {
    // The key is caller-controlled and NOT registered with any redactor, so only
    // the G4 digest (not redaction) can keep it out of the audit dump.
    const audit = new InMemoryAuditSink(new SecretRedactor());
    const adapter = new DurableCallAdapter({ audit, now: () => T });
    const SECRET_KEY = 'sk-durable-idem-7f3a9c2e1b';
    const id = adapter.launch({ envelope: envelope({ idempotencyKey: SECRET_KEY }) }).call.id;
    adapter.start(id);
    adapter.cancel(id, 'cleanup');

    expect(audit.dump()).not.toContain(SECRET_KEY); // raw key never leaks (G4)
    const launch = audit.events.find((e) => e.kind === 'durable.launch');
    expect(launch?.detail?.idempotencyKey).toBeUndefined();
    expect(launch?.detail?.idempotencyKeyDigest).toBe(idempotencyDigest(SECRET_KEY));
  });
});

describe('G1 — durable elicitation gate is non-fungible (bound like F6)', () => {
  // Build a fresh durable call parked in waiting(elicitation) at `ref`.
  const waitingCall = (elic: ElicitationManager, ref: string): { adapter: DurableCallAdapter; id: string } => {
    const adapter = newAdapter({ elicitations: elic });
    const id = adapter.launch({ envelope: envelope({ idempotencyKey: `idem-${ref}`, elicitationRef: ref }) }).call.id;
    adapter.start(id);
    adapter.wait(id, 'elicitation');
    return { adapter, id };
  };

  it('a foreign-capability / foreign-session / foreign-principal resumed ref does NOT clear the wait; a matching ref does', () => {
    // foreign capability
    let elic = new ElicitationManager();
    driveElicitation(elic, 'el-cap', { capabilityRef: 'delete_widgets' });
    let s = waitingCall(elic, 'el-cap');
    expect(s.adapter.resume(s.id).call.state).toBe('waiting'); // not cleared

    // foreign session
    elic = new ElicitationManager();
    driveElicitation(elic, 'el-sess', { sessionRef: 'sess-OTHER' });
    s = waitingCall(elic, 'el-sess');
    expect(s.adapter.resume(s.id).call.state).toBe('waiting');

    // foreign principal
    elic = new ElicitationManager();
    driveElicitation(elic, 'el-sub', { sub: 'attacker-9' });
    s = waitingCall(elic, 'el-sub');
    expect(s.adapter.resume(s.id).call.state).toBe('waiting');

    // matching capability + session + principal → wait clears
    elic = new ElicitationManager();
    driveElicitation(elic, 'el-ok', {});
    s = waitingCall(elic, 'el-ok');
    expect(s.adapter.resume(s.id).call.state).toBe('running');
  });

  it('binding holds across a FileRecordStore restart (foreign denied, then matching clears)', () => {
    const dcPath = tmpPath();
    const elPath = tmpPath();

    const a1 = newAdapter({ store: new PersistentDurableCallStore(new FileRecordStore<McpDurableCall>(dcPath)) });
    const id = a1.launch({ envelope: envelope({ idempotencyKey: 'idem-g1r', elicitationRef: 'el-g1r' }) }).call.id;
    a1.start(id);
    a1.wait(id, 'elicitation');

    // restart: a FOREIGN-principal resumed gate sits at the same elicitationRef
    const elicForeign = new ElicitationManager({
      store: new PersistentElicitationStore(new FileRecordStore<ElicitationRecord>(elPath)),
    });
    driveElicitation(elicForeign, 'el-g1r', { sub: 'attacker-9' });
    const a2 = newAdapter({
      store: new PersistentDurableCallStore(new FileRecordStore<McpDurableCall>(dcPath)),
      elicitations: elicForeign,
    });
    expect(a2.status(id)?.call.state).toBe('waiting'); // survived restart
    expect(a2.resume(id).call.state).toBe('waiting'); // foreign gate denied across restart

    // another restart: the gate at el-g1r is now correctly bound → clears
    const elicOk = new ElicitationManager({
      store: new PersistentElicitationStore(new FileRecordStore<ElicitationRecord>(elPath)),
    });
    driveElicitation(elicOk, 'el-g1r', {}); // overwrites the foreign record with a matching one
    const a3 = newAdapter({
      store: new PersistentDurableCallStore(new FileRecordStore<McpDurableCall>(dcPath)),
      elicitations: elicOk,
    });
    expect(a3.resume(id).call.state).toBe('running');
  });
});

describe('G2 — idempotency is scoped to the launch context', () => {
  it('the same key from a DIFFERENT principal/session/tenant/capability/connector creates a DISTINCT call', () => {
    const store = new PersistentDurableCallStore();
    const adapter = newAdapter({ store });
    const KEY = 'idem-shared';

    const base = adapter.launch({ envelope: envelope({ idempotencyKey: KEY }) }); // user-1/sess-1/tenant-a/export_widgets/conn-1
    const foreignPrincipal = adapter.launch({ envelope: envelope({ idempotencyKey: KEY, sub: 'user-2' }) });
    const foreignSession = adapter.launch({ envelope: envelope({ idempotencyKey: KEY, sessionId: 'sess-2' }) });
    const foreignTenant = adapter.launch({ envelope: envelope({ idempotencyKey: KEY, tenant: 'tenant-b' }) });
    const foreignCapability = adapter.launch({ envelope: envelope({ idempotencyKey: KEY, capabilityRef: 'import_widgets' }) });
    const foreignConnector = adapter.launch({ envelope: envelope({ idempotencyKey: KEY, connectorInstanceId: 'conn-2' }) });

    const ids = new Set(
      [base, foreignPrincipal, foreignSession, foreignTenant, foreignCapability, foreignConnector].map((r) => r.call.id),
    );
    expect(ids.size).toBe(6); // never returns another context's call
    expect(store.all()).toHaveLength(6);
  });

  it('the same key in the SAME full context is idempotent (returns the same call)', () => {
    const store = new PersistentDurableCallStore();
    const adapter = newAdapter({ store });
    const ctx = { idempotencyKey: 'idem-same', sub: 'user-7', sessionId: 'sess-7', tenant: 'tenant-z', connectorInstanceId: 'conn-7' };
    const a = adapter.launch({ envelope: envelope(ctx) });
    const b = adapter.launch({ envelope: envelope(ctx) });
    const c = adapter.launch({ envelope: envelope(ctx) });
    expect(b.call.id).toBe(a.call.id);
    expect(c.call.id).toBe(a.call.id);
    expect(store.all()).toHaveLength(1); // no duplicate
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
