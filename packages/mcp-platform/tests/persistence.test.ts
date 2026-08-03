/**
 * Slice 3 — §11 persistence probe matrix (the review-identified gap).
 *
 * Explicit pass/fail assertions for: restart lookup survives reload; expiry
 * (session + consent) denied after reload; revoked-session denial after reload;
 * consent revocation persists; secret-status non-active persists fail-closed
 * (and NO secret value crosses the durable boundary); elicitation
 * resume-after-restart + the resumed gate stays bound to capability/session/
 * principal post-reload (no replay). §6.3 / §6.4 / §5.1, §11.
 *
 * MOCK-ONLY: tmp-file JSON store under the OS tmp dir; no real DB/network.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileRecordStore } from '../src/persistence.js';
import {
  PersistentConsentStore,
  PersistentElicitationStore,
  PersistentEnrollmentStore,
  PersistentSecretStatusStore,
  PersistentSessionStore,
} from '../src/stores.js';
import { InMemoryConsentRegistry, InMemoryTenantRegistry, authorizeRequest } from '../src/authz.js';
import { ElicitationManager } from '../src/elicitation.js';
import { MockSecretStore } from '../src/context.js';
import { createStpConnectorContext } from '../src/context.js';
import { SecretRedactor, InMemoryAuditSink } from '../src/audit.js';
import { assertMutationGate } from '../src/experimental/mutation-gate.js';
import { MockOidcIssuer } from '../src/mock/oidc.js';
import { fakeManifest } from '../src/mock/fake-connector.js';
import type {
  ConnectorEnrollment,
  ConsentGrant,
  McpSession,
  SecretStatus,
} from '../src/runtime.js';
import type { ElicitationRecord } from '../src/elicitation.js';
import type { AppCapability } from '../src/manifest.js';
import type { AppToolInvocation } from '../src/runtime.js';

const T = 2_000_000_000_000; // fixed clock (ms)
const CONN = 'conn-1';
const createWidget = fakeManifest.tools[0];

const paths: string[] = [];
const tmpPath = (): string => {
  const p = join(tmpdir(), 'sentropic-mcp-platform-test', `p-${randomUUID()}.json`);
  paths.push(p);
  return p;
};
afterEach(() => {
  for (const p of paths.splice(0)) new FileRecordStore(p).destroy();
});

const session = (over: Partial<McpSession> = {}): McpSession => ({
  id: 'sess-1',
  clientId: 'client-1',
  surface: 'chat',
  principalSub: 'user-1',
  tenantRef: 'tenant-a',
  consentRefs: [],
  authTime: new Date(T).toISOString(),
  state: 'active',
  createdAt: new Date(T).toISOString(),
  ...over,
});

const grant = (over: Partial<ConsentGrant> = {}): ConsentGrant => ({
  id: 'grant-1',
  principalSub: 'user-1',
  tenantRef: 'tenant-a',
  connectorInstanceId: CONN,
  scopes: ['widgets:read', 'widgets:write'],
  state: 'active',
  grantedAt: new Date(T).toISOString(),
  ...over,
});

describe('§11 Session persistence (§6.3)', () => {
  it('restart lookup: an active session resolves after a simulated restart', () => {
    const path = tmpPath();
    new PersistentSessionStore(new FileRecordStore<McpSession>(path)).put(session());
    const restarted = new PersistentSessionStore(new FileRecordStore<McpSession>(path));
    expect(restarted.get('sess-1')?.principalSub).toBe('user-1');
    expect(restarted.resolveActive('sess-1', T)).toBeDefined();
  });

  it('expiry: an expired session is denied fail-closed after reload', () => {
    const path = tmpPath();
    new PersistentSessionStore(new FileRecordStore<McpSession>(path)).put(
      session({ expiresAt: new Date(T - 1000).toISOString() }),
    );
    const restarted = new PersistentSessionStore(new FileRecordStore<McpSession>(path));
    expect(restarted.get('sess-1')).toBeDefined(); // record present…
    expect(restarted.resolveActive('sess-1', T)).toBeUndefined(); // …but fail-closed
  });

  it('revoked-session denial persists across restart', () => {
    const path = tmpPath();
    const store = new PersistentSessionStore(new FileRecordStore<McpSession>(path));
    store.put(session());
    store.setState('sess-1', 'revoked');
    const restarted = new PersistentSessionStore(new FileRecordStore<McpSession>(path));
    expect(restarted.get('sess-1')?.state).toBe('revoked');
    expect(restarted.resolveActive('sess-1', T)).toBeUndefined();
  });
});

describe('§11 Consent persistence (§6.3)', () => {
  it('consent revocation persists across restart (deny after reload)', () => {
    const path = tmpPath();
    const reg = new InMemoryConsentRegistry({ store: new PersistentConsentStore(new FileRecordStore<ConsentGrant>(path)), now: () => T });
    reg.grant(grant());
    expect(reg.consentState('user-1', 'tenant-a', CONN, ['widgets:read'])).toBe('active');
    reg.setState('grant-1', 'revoked');

    const restarted = new InMemoryConsentRegistry({ store: new PersistentConsentStore(new FileRecordStore<ConsentGrant>(path)), now: () => T });
    expect(restarted.consentState('user-1', 'tenant-a', CONN, ['widgets:read'])).toBe('revoked');
  });

  it('expired consent is denied fail-closed after reload', () => {
    const path = tmpPath();
    new InMemoryConsentRegistry({ store: new PersistentConsentStore(new FileRecordStore<ConsentGrant>(path)) }).grant(
      grant({ expiresAt: new Date(T - 1000).toISOString() }),
    );
    const restarted = new InMemoryConsentRegistry({ store: new PersistentConsentStore(new FileRecordStore<ConsentGrant>(path)), now: () => T });
    expect(restarted.consentState('user-1', 'tenant-a', CONN, ['widgets:read'])).toBe('revoked');
  });
});

describe('§11 Enrollment persistence (§6.3, fix F1 across restart)', () => {
  it('a revoked enrollment persists → authorizeRequest denies no_enrollment after restart', async () => {
    const path = tmpPath();
    const tenants = new InMemoryTenantRegistry({ store: new PersistentEnrollmentStore(new FileRecordStore<ConnectorEnrollment>(path)) });
    tenants.enroll('user-1', CONN, 'tenant-a');
    tenants.setEnrollmentState('user-1', CONN, 'tenant-a', 'revoked');

    const restartedTenants = new InMemoryTenantRegistry({ store: new PersistentEnrollmentStore(new FileRecordStore<ConnectorEnrollment>(path)) });
    await expect(restartedTenants.authorizedTenants('user-1', CONN)).resolves.toEqual([]); // fail-closed

    const issuer = new MockOidcIssuer();
    const consents = new InMemoryConsentRegistry();
    consents.grant(grant());
    const caps = new Map<string, AppCapability>([[fakeManifest.resources[0].name, fakeManifest.resources[0]]]);
    const token = issuer.issue({ sub: 'user-1', aud: 'https://rs.mcp.test', scope: ['widgets:read'], tid: 'tenant-a', now: T }).token;
    const r = await authorizeRequest(
      { token, capabilityRef: 'list_widgets', connectorInstanceId: CONN, now: T },
      { issuer, resourceAudience: 'https://rs.mcp.test', expectedIssuer: issuer.issuer, capabilities: caps, tenantResolver: restartedTenants, consentResolver: consents },
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('no_enrollment');
  });
});

describe('§11 Secret-status persistence (§6.4)', () => {
  const SECRET = 'sk-restart-secret-7c1f';
  const key = { principalSub: 'user-1', tenantRef: 'tenant-a', connectorInstanceId: CONN, name: 'fakeAccessToken' };

  it('a non-active secret status persists fail-closed across restart', () => {
    const path = tmpPath();
    const store = new MockSecretStore(new SecretRedactor(), new PersistentSecretStatusStore(new FileRecordStore<SecretStatus>(path)));
    store.put(key, SECRET);
    store.transition(key, 'revoked');

    const restarted = new MockSecretStore(new SecretRedactor(), new PersistentSecretStatusStore(new FileRecordStore<SecretStatus>(path)));
    expect(restarted.statusFor(key).state).toBe('revoked');
    expect(() => restarted.resolve(key)).toThrow(); // fail-closed
  });

  it('the durable medium NEVER contains the secret value (status only, §5.2(b))', () => {
    const path = tmpPath();
    const store = new MockSecretStore(new SecretRedactor(), new PersistentSecretStatusStore(new FileRecordStore<SecretStatus>(path)));
    store.put(key, SECRET);
    expect(new FileRecordStore<SecretStatus>(path).snapshot()).not.toContain(SECRET);
  });

  it('an active status persists but the value does NOT (re-enrollment required post-restart)', () => {
    const path = tmpPath();
    new MockSecretStore(new SecretRedactor(), new PersistentSecretStatusStore(new FileRecordStore<SecretStatus>(path))).put(key, SECRET);
    const restarted = new MockSecretStore(new SecretRedactor(), new PersistentSecretStatusStore(new FileRecordStore<SecretStatus>(path)));
    expect(restarted.statusFor(key).state).toBe('active'); // status survived
    expect(() => restarted.resolve(key)).toThrow(); // value did not → fail-closed
    restarted.put(key, SECRET); // re-enroll value
    expect(restarted.resolve(key)).toBe(SECRET);
  });
});

describe('§11 Elicitation resume-after-restart (§5.1)', () => {
  const drive = (m: ElicitationManager, id: string): void => {
    m.create({ id, mode: 'confirm', sessionRef: 'sess-1', capabilityRef: 'create_widget', actor: { sub: 'user-1' }, ttlSeconds: 300, auditId: 'audit-1' });
    m.render(id);
    m.answer(id, { sub: 'user-1', isHuman: true });
    m.validate(id);
  };

  function ctxFor(sub: string, sessionId: string): AppToolInvocation['ctx'] {
    const redactor = new SecretRedactor();
    return createStpConnectorContext({
      requestId: 'req-1', correlationId: 'corr-1', auditId: 'audit-1',
      principal: { sub, claims: {}, scopes: ['widgets:write'], tenantRef: 'tenant-a', authTime: new Date(T).toISOString() },
      surface: 'chat', mcpSessionId: sessionId, connectorInstanceId: CONN, consentRefs: [], grantRefs: [],
      secretStore: new MockSecretStore(redactor), audit: new InMemoryAuditSink(redactor),
    });
  }

  it('a validated elicitation resumes to `resumed` after a restart', () => {
    const path = tmpPath();
    const m1 = new ElicitationManager({ store: new PersistentElicitationStore(new FileRecordStore<ElicitationRecord>(path)) });
    drive(m1, 'el-1');

    const m2 = new ElicitationManager({ store: new PersistentElicitationStore(new FileRecordStore<ElicitationRecord>(path)) });
    expect(m2.get('el-1')?.state).toBe('validated'); // survived restart
    m2.resume('el-1');
    expect(m2.get('el-1')?.state).toBe('resumed');
    expect(m2.isGateReleased('el-1')).toBe(true);
  });

  it('a `resumed` gate stays bound to capability/session/principal post-reload (no replay)', () => {
    const path = tmpPath();
    const m1 = new ElicitationManager({ store: new PersistentElicitationStore(new FileRecordStore<ElicitationRecord>(path)) });
    drive(m1, 'el-1');
    m1.resume('el-1');

    const m2 = new ElicitationManager({ store: new PersistentElicitationStore(new FileRecordStore<ElicitationRecord>(path)) });
    const base = { capabilityRef: 'create_widget', input: { label: 'x' }, idempotencyKey: 'idem-1', elicitationRef: 'el-1' };

    const ok: AppToolInvocation = { ...base, ctx: ctxFor('user-1', 'sess-1') };
    expect(assertMutationGate(createWidget, ok, m2)).toEqual({ ok: true });

    const foreignSession: AppToolInvocation = { ...base, ctx: ctxFor('user-1', 'sess-OTHER') };
    expect(assertMutationGate(createWidget, foreignSession, m2).ok).toBe(false);

    const foreignPrincipal: AppToolInvocation = { ...base, ctx: ctxFor('attacker-9', 'sess-1') };
    expect(assertMutationGate(createWidget, foreignPrincipal, m2).ok).toBe(false);
  });
});
