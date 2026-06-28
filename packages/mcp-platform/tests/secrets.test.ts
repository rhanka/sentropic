/**
 * Slice 2 — secret-lifecycle / no-leak probes (§4.5, §6.4, §11 Secrets).
 *
 * Covers: audited just-in-time accessor, fail-closed status lookup, and the
 * "no secret in logs/prompts/traces/fixtures" guarantee.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryAuditSink, REDACTION_TOKEN, SecretRedactor } from '../src/audit.js';
import { MockSecretStore, SecretAccessError, createStpConnectorContext } from '../src/context.js';

const SECRET = 'sk-super-secret-value-9f3a';

function setup() {
  const redactor = new SecretRedactor();
  const audit = new InMemoryAuditSink(redactor);
  const store = new MockSecretStore(redactor);
  const key = { principalSub: 'user-1', tenantRef: 'tenant-a', connectorInstanceId: 'conn-1', name: 'fakeAccessToken' };
  store.put(key, SECRET);
  const ctx = createStpConnectorContext({
    requestId: 'req-1',
    correlationId: 'corr-1',
    auditId: 'audit-1',
    principal: { sub: 'user-1', claims: {}, scopes: ['widgets:read'], tenantRef: 'tenant-a', authTime: new Date().toISOString() },
    surface: 'chat',
    mcpSessionId: 'sess-1',
    connectorInstanceId: 'conn-1',
    consentRefs: ['grant-1'],
    grantRefs: ['grant-1'],
    secretStore: store,
    audit,
  });
  return { redactor, audit, store, ctx, key };
}

describe('secret accessor & redaction', () => {
  it('returns the value to connector code but never echoes it in audit/logs', async () => {
    const { ctx, audit } = setup();
    const value = await ctx.getSecret('fakeAccessToken');
    expect(value).toBe(SECRET);

    // Attempt to leak the secret via the (redacting) logger and an audit event.
    (ctx.logger as { log: (...p: unknown[]) => void }).log('connector used token', value);
    await ctx.audit.emit({ kind: 'debug', auditId: 'audit-1', at: new Date().toISOString(), detail: { token: value } });

    const dump = audit.dump();
    expect(dump).not.toContain(SECRET);
    expect(dump).toContain('[REDACTED]');
  });

  it('audits the access by NAME only (granted), never the value', async () => {
    const { ctx, audit } = setup();
    await ctx.getSecret('fakeAccessToken');
    const access = audit.events.find((e) => e.kind === 'secret.access');
    expect(access?.detail?.name).toBe('fakeAccessToken');
    expect(access?.detail?.result).toBe('granted');
    expect(JSON.stringify(access)).not.toContain(SECRET);
  });

  it('fails closed and audits a denial when the secret is revoked', async () => {
    const { ctx, store, key, audit } = setup();
    store.transition(key, 'revoked');
    await expect(ctx.getSecret('fakeAccessToken')).rejects.toBeInstanceOf(SecretAccessError);
    const denied = audit.events.find((e) => e.kind === 'secret.access' && e.detail?.result === 'denied');
    expect(denied?.detail?.state).toBe('revoked');
  });

  it('G3: redaction stays monotonic after revoke — value unresolvable but still redacted', () => {
    const { store, key, audit, redactor } = setup();
    store.transition(key, 'revoked');

    // (a) the LIVE value is dropped → resolve fails closed (cannot be used again)
    expect(() => store.resolve(key)).toThrow(SecretAccessError);

    // (b) redaction is MONOTONIC: the old value is STILL redacted post-revoke, so
    // an already-emitted / late log line never un-redacts (NOT redactor.forget).
    audit.log('post-revoke leak attempt', SECRET);
    expect(audit.dump()).not.toContain(SECRET);
    expect(redactor.redactString(SECRET)).toBe(REDACTION_TOKEN);
  });

  it('status lookup discloses state only (never the value) and is fail-closed when missing', () => {
    const { store, key } = setup();
    expect(store.statusFor(key).state).toBe('active');
    const status = store.statusFor({ ...key, name: 'unknown' });
    expect(status.state).toBe('revoked'); // missing → fail-closed (not active)
    expect(JSON.stringify(store.statusFor(key))).not.toContain(SECRET);
  });
});
