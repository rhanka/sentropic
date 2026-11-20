import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryRoutePlanner, type PreparedRouteAttempt } from '@sentropic/llm-mesh';
import {
  GuardEngine, KUBECONFIG_PATTERNS, PureSecretScanner, createGatewayRouter, dedupeRanges,
  formatSecretRedactionTag, redactSecretMatches, scanCustom, scanSecrets,
  type CustomSecretPattern, type SecretMatch, type SecretScannerPort,
} from '../src/index.js';
import type { RouteFlowDeps } from '../src/route-flow-core.js';
import { budgetConfig } from './fixtures/budget.js';

const ALPHA = 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
const rep = (n: number): string => Array.from({ length: n }, (_, i) => ALPHA[i % ALPHA.length]).join('');
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');
const sha16 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);
const FAKE_ORG_TOKEN = ['stp', '_', 'A1b2C3d4'.repeat(4)].join('');
const ORG_PATTERN: CustomSecretPattern = { id: 'org-token', pattern: 'stp_[A-Za-z0-9]{32}' };

const buildFakeKubeconfig = () => {
  const keyData = b64(`-----BEGIN FAKE PRIVATE KEY-----\n${rep(160)}`);
  const certData = b64(`-----BEGIN FAKE CERTIFICATE-----\n${rep(160)}`);
  const caData = b64(`-----BEGIN FAKE CA-----\n${rep(160)}`);
  const token = `FAKE-TOKEN-${rep(40)}`;
  const pemOnly = b64(`-----BEGIN FAKE BLOCK-----\n${rep(90)}`);
  const yaml = [
    'apiVersion: v1', 'kind: Config', 'clusters:', '- cluster:',
    `    certificate-authority-data: ${caData}`, '    server: https://fake.example.invalid:6443', '  name: fake',
    'users:', '- user:', `    client-certificate-data: ${certData}`, `    client-key-data: ${keyData}`,
    `    token: ${token}`, '  name: fake-admin',
  ].join('\n');
  return { yaml, blob: b64(yaml), keyData, certData, caData, token, pemOnly };
};

const plannerFor = (dispatchSpy: (req: unknown) => void, model: string, providerId: string) => new InMemoryRoutePlanner({
  directory: {
    listEligible: async () => [{
      accountRef: 'acct-1', diagnosticAccountRef: 'diag-1', targetProviderId: providerId,
      transportProviderId: providerId === 'openai' ? 'codex' : 'claude-code',
      supportedModelIds: [model], enrollmentCompletedAt: '2026-10-01T00:00:00Z', readiness: 'ready', revision: '1',
    }],
    prepareAttempt: async () => ({
      attemptRef: 'att-1',
      generate: async (req: unknown) => { dispatchSpy(req); return { id: 'r1', providerId, modelId: model, message: { role: 'assistant', content: 'ok' }, text: 'ok', toolCalls: [], finishReason: 'stop' }; },
      stream: async () => (async function* () {})(),
      markCommitted: async () => undefined, complete: async () => undefined,
      releaseCancelled: async () => undefined, recordOutcome: async () => undefined,
    }) as unknown as PreparedRouteAttempt,
  },
});

describe('L1.3c vendored pure-TS agent-stats secret scanner core', () => {
  it('detects all 6 runtime-assembled KUBECONFIG_PATTERNS, preserves YAML keys, and skips prose or disabled defaults', () => {
    expect(KUBECONFIG_PATTERNS.map((p) => p.id)).toEqual([
      'kubeconfig-blob', 'kubeconfig-client-key-data', 'kubeconfig-client-certificate-data',
      'kubeconfig-certificate-authority-data', 'kubeconfig-token', 'kubeconfig-pem-material',
    ]);
    const kc = buildFakeKubeconfig();
    const text = `dump:\n${kc.yaml}\npem:${kc.pemOnly}\nblob:${kc.blob}\nwrapped:${kc.blob.replace(/.{76}/g, '$&\n')}`;
    const matches = scanSecrets(text);
    const ids = new Set(matches.map((m) => m.ruleId));
    for (const id of KUBECONFIG_PATTERNS.map((p) => `custom:${p.id}`)) expect(ids.has(id)).toBe(true);
    const masked = redactSecretMatches(text, matches);
    for (const raw of [kc.keyData, kc.certData, kc.caData, kc.token, kc.pemOnly, kc.blob]) expect(masked).not.toContain(raw);
    expect(masked).toContain('client-key-data:');
    expect(masked).toContain(`<<SECRET:custom_kubeconfig-token:${sha16(kc.token)}>>`);
    expect(scanSecrets('deployed the cluster config cleanly today')).toEqual([]);
    expect(scanSecrets(kc.yaml, { includeDefaultPatterns: false })).toEqual([]);
  });

  it('enforces global flag in scanCustom, skips invalid regexes, and merges partial overlaps in dedupeRanges without corruption', () => {
    const hits = scanCustom(`${FAKE_ORG_TOKEN} and ${FAKE_ORG_TOKEN} plus ORG_AbCdEfGh`, [
      ORG_PATTERN, { id: 'case-tok', pattern: 'org_[a-z]{8}', flags: 'i' }, { id: 'broken-re', pattern: '([unterminated' },
    ]);
    expect(hits.filter((m) => m.ruleId === 'custom:org-token')).toHaveLength(2);
    expect(hits.filter((m) => m.ruleId === 'custom:case-tok')).toHaveLength(1);
    const sample = '0123456789abcdefghij';
    const overlapping: SecretMatch[] = [
      { start: 8, end: 18, ruleId: 'rule/second', message: 'second' },
      { start: 2, end: 12, ruleId: 'rule:first', message: 'first' },
    ];
    expect(dedupeRanges(overlapping)).toEqual([{ start: 2, end: 18, ruleId: 'rule:first', message: 'first' }]);
    const expectedTag = formatSecretRedactionTag('rule:first', sample.slice(2, 18));
    expect(expectedTag).toBe(`<<SECRET:rule_first:${sha16('23456789abcdefgh')}>>`);
    expect(redactSecretMatches(sample, overlapping)).toBe(`01${expectedTag}ij`);
    const chained = dedupeRanges([
      { start: 2, end: 12, ruleId: 'r1', message: '1' }, { start: 8, end: 18, ruleId: 'r2', message: '2' },
      { start: 15, end: 22, ruleId: 'r3', message: '3' }, { start: 22, end: 26, ruleId: 'r4', message: '4' },
    ]);
    expect(chained.map((m) => [m.start, m.end, m.ruleId])).toEqual([[2, 22, 'r1'], [22, 26, 'r4']]);
    for (let i = 0; i + 1 < chained.length; i += 1) expect(chained[i]!.end).toBeLessThanOrEqual(chained[i + 1]!.start);
  });

  it('supports injectable SecretScannerPort and keeps default audit_mask_copy in-flight payloads byte-identical', () => {
    const customScanner: SecretScannerPort = {
      scan: (t) => (t.includes('0123456789abcdefghij')
        ? [{ start: 2, end: 12, ruleId: 'ext:overlapA', message: 'a' }, { start: 8, end: 18, ruleId: 'ext:overlapB', message: 'b' }]
        : []),
    };
    const payload = { messages: [{ role: 'user', content: '0123456789abcdefghij alice@example.org' }] };
    const res = new GuardEngine({ secretScanner: customScanner }).inspectRequest(payload);
    expect(res.verdict).toBe('masked');
    expect(res.inFlightPayload).toBe(payload);
    expect(JSON.stringify(res.inFlightPayload)).toBe(JSON.stringify(payload));
    expect((res.maskedCapture.payload as { messages: { content: string }[] }).messages[0]!.content)
      .toBe(`01<<SECRET:ext_overlapA:${sha16('23456789abcdefgh')}>>ij [REDACTED:EMAIL]`);

    const orgBody = { messages: [{ role: 'user', content: `MY_TOKEN=${FAKE_ORG_TOKEN}` }] };
    const orgRes = new GuardEngine({ secretScanner: new PureSecretScanner({ customPatterns: [ORG_PATTERN] }) }).inspectRequest(orgBody);
    expect(orgRes.inFlightPayload).toBe(orgBody);
    expect((orgRes.maskedCapture.payload as { messages: { content: string }[] }).messages[0]!.content)
      .toBe(`MY_TOKEN=<<SECRET:custom_org-token:${sha16(FAKE_ORG_TOKEN)}>>`);
  });

  it('refuses CustomSecretPattern mask_in_flight inside P across all 3 wires (400, zero dispatch) while masking non-P user turns', async () => {
    const guard = new GuardEngine({ customPatterns: [ORG_PATTERN], detectorActions: { 'custom:org-token': 'mask_in_flight' } });
    const cases = [
      { path: '/v1/messages', model: 'claude-sonnet-5', provider: 'anthropic',
        bad: { model: 'claude-sonnet-5', system: `sys ${FAKE_ORG_TOKEN}`, messages: [{ role: 'user', content: 'hi' }] },
        ok: { model: 'claude-sonnet-5', system: 'clean-sys', messages: [{ role: 'user', content: `tok ${FAKE_ORG_TOKEN}` }] } },
      { path: '/v1/chat/completions', model: 'gpt-5.6-terra', provider: 'openai',
        bad: { model: 'gpt-5.6-terra', messages: [{ role: 'developer', content: `dev ${FAKE_ORG_TOKEN}` }, { role: 'user', content: 'hi' }] },
        ok: { model: 'gpt-5.6-terra', messages: [{ role: 'developer', content: 'clean-dev' }, { role: 'user', content: `tok ${FAKE_ORG_TOKEN}` }] } },
      { path: '/v1/responses', model: 'gpt-5.6-terra', provider: 'openai',
        bad: { model: 'gpt-5.6-terra', instructions: `inst ${FAKE_ORG_TOKEN}`, input: [{ role: 'user', content: 'hi' }] },
        ok: { model: 'gpt-5.6-terra', instructions: 'clean-inst', input: [{ role: 'user', content: `tok ${FAKE_ORG_TOKEN}` }] } },
    ] as const;
    for (const tc of cases) {
      const dispatchSpy = vi.fn();
      const refused: { receiptId: string; detail?: unknown }[] = [];
      const requestAudit: RouteFlowDeps['requestAudit'] = {
        admit: async () => ({ receiptId: 'rcpt-l13c' }),
        refuse: async (receiptId, detail) => { refused.push({ receiptId, detail }); },
      };
      const app = createGatewayRouter({ config: budgetConfig, routePlanner: plannerFor(dispatchSpy, tc.model, tc.provider), routeMetering: { settleRoute() {} }, requestAudit, guard });
      const badRes = await app.request(tc.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(tc.bad) });
      expect(badRes.status).toBe(400);
      expect(badRes.headers.get('x-should-retry')).toBe('false');
      expect(dispatchSpy).not.toHaveBeenCalled();
      expect(refused[0]?.detail).toMatchObject({ integrity: 'protected_identification_violation' });
      const okRes = await app.request(tc.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(tc.ok) });
      expect(okRes.status).toBe(200);
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      const sent = JSON.stringify(dispatchSpy.mock.calls[0]![0]);
      expect(sent).not.toContain(FAKE_ORG_TOKEN);
      expect(sent).toContain(`<<SECRET:custom_org-token:${sha16(FAKE_ORG_TOKEN)}>>`);
    }
  });

  it('strips sticky y flag in scanCustom and scans large slash-heavy texts without quadratic pii.email backtracking', () => {
    const stickyHits = scanCustom('prefix ORG_AbCdEfGh middle ORG_XyZaBcDe', [
      { id: 'sticky-tok', pattern: 'org_[a-z]{8}', flags: 'iy' },
    ]);
    expect(stickyHits.map((m) => m.ruleId)).toEqual(['custom:sticky-tok', 'custom:sticky-tok']);
    expect(stickyHits[0]!.start).toBe(7);

    const engine = new GuardEngine();
    const bigNoAt = '/a'.repeat(100_000);
    const t0 = performance.now();
    const noAtRes = engine.scanText(bigNoAt);
    const noAtMs = performance.now() - t0;
    expect(noAtRes.findings).toEqual([]);
    expect(noAtMs).toBeLessThan(50);

    const bigWithEmail = `${bigNoAt} alice@example.org`;
    const t1 = performance.now();
    const withEmailRes = engine.scanText(bigWithEmail);
    const withEmailMs = performance.now() - t1;
    expect(withEmailRes.maskedText.endsWith(' [REDACTED:EMAIL]')).toBe(true);
    expect(withEmailMs).toBeLessThan(50);
  });

  it('preserves #1053 built-in detector delimiters when scanner matches occur inside .env, Cookie, X-Api-Key, URI, or PEM blocks', () => {
    const engine = new GuardEngine({ customPatterns: [ORG_PATTERN] });
    const fakeAws = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
    const ls0tChunk = `LS0t${rep(44)}`;
    const pemWithLs0t = [
      '-----BEGIN PRIVATE KEY-----',
      `MIIEvgIBADAN${ls0tChunk}`,
      'SECOND_LINE_PKCS8_SECRET_MATERIAL_99',
      '-----END PRIVATE KEY-----',
    ].join('\n');
    const text = [
      `DATABASE_PASSWORD="pfx_env_${FAKE_ORG_TOKEN}_sfx_env"`,
      `APP_SECRET="pfx_pem_${ls0tChunk}_sfx_pem"`,
      `DB_PASSWD="pfx_aws_${fakeAws}_sfx_aws"`,
      `Cookie: tok=${FAKE_ORG_TOKEN}; sid=synth_cookie_2; csrf=synth_csrf_3`,
      `X-Api-Key: pfx_hdr_${FAKE_ORG_TOKEN}_tail_hdr`,
      `postgres://svc:pfx_uri_${FAKE_ORG_TOKEN}_tail_uri@db.local/app`,
      pemWithLs0t,
    ].join('\n');
    const res = engine.inspectRequest({ messages: [{ role: 'user', content: text }] });
    const masked = String((res.maskedCapture.payload as { messages: { content: string }[] }).messages[0]!.content);
    for (const leaked of [
      'pfx_env_', '_sfx_env', 'pfx_pem_', '_sfx_pem', 'pfx_aws_', '_sfx_aws',
      'synth_cookie_2', 'synth_csrf_3', 'pfx_hdr_', '_tail_hdr', 'pfx_uri_', '_tail_uri',
      'SECOND_LINE_PKCS8_SECRET_MATERIAL_99', FAKE_ORG_TOKEN, ls0tChunk, fakeAws,
    ]) {
      expect(masked).not.toContain(leaked);
    }
    const exactQuoted = engine.scanText(`MY_TOKEN="${FAKE_ORG_TOKEN}"`).maskedText;
    expect(exactQuoted).toBe(`MY_TOKEN="<<SECRET:custom_org-token:${sha16(FAKE_ORG_TOKEN)}>>"`);
  });
});
