import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryRoutePlanner, type PreparedRouteAttempt } from '@sentropic/llm-mesh';
import {
  GuardEngine, createGatewayRouter, redactSecretMatches, type RouteFlowDeps,
} from '@sentropic/llm-gateway';
import {
  SECRETLINT_MAX_YAML_BYTES, SECRETLINT_PRESET_RULE_COUNT, SecretPatternYamlError,
  createSecretlintScannerAdapter, loadSecretPatterns, parseSecretPatternsYaml,
} from '../../src/services/llm-runtime/secretlint-scanner-adapter';

const ALPHA = 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
const rep = (n: number): string => Array.from({ length: n }, (_, i) => ALPHA[i % ALPHA.length]).join('');
const FAKE_ORG_TOKEN = ['stp', '_', 'A1b2C3d4'.repeat(4)].join('');
const FAKE_AWS = ['AWS_SECRET_ACCESS_KEY', '=', rep(40)].join('');
const FAKE_GH = ['ghp', '_', rep(36)].join('');
const FAKE_GL = ['glpat', '-', rep(20)].join('');
const FAKE_SLACK = ['xoxb', '-', '123456789012', '-', '1234567890123', '-', rep(24)].join('');
const FAKE_TAILSCALE = ['tskey', '-auth-', rep(12), '-', rep(24)].join('');
const FAKE_ANTHROPIC = ['sk-ant-', 'api03-', rep(93), 'AA'].join('');
const FAKE_PEM = ['-----BEGIN ', 'PRIVATE KEY-----\n', 'MI', rep(120), '\n-----END ', 'PRIVATE KEY-----'].join('');
const FAKE_KUBE_TOKEN = ['FAKE-KUBE-TOK-', rep(28)].join('');
const BUDGET_CONFIG = {
  mode: 'personal-passthrough' as const,
  crossUserPoolEnabled: false,
  callerAuth: {
    verify: async () => ({
      ok: true as const,
      cost: {
        tenantId: 't1', workspaceId: 'w1', principalId: 'u1',
        ownerScopeRef: 'w1:u1', source: 'test', correlationId: 'c1',
      },
    }),
  },
  pool: { listEligibleAccounts: async () => [], select: async () => null, snapshotModels: async () => [] },
  authResolver: { resolve: async () => ({ kind: 'api-key' as const, apiKey: 'unused' }) },
  dispatch: { dispatch: async () => { throw new Error('unused'); }, dispatchStream: () => { throw new Error('unused'); } },
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
      generate: async (req: unknown) => {
        dispatchSpy(req);
        return { id: 'r1', providerId, modelId: model, message: { role: 'assistant', content: 'ok' }, text: 'ok', toolCalls: [], finishReason: 'stop' };
      },
      stream: async () => (async function* () {})(),
      markCommitted: async () => undefined, complete: async () => undefined,
      releaseCancelled: async () => undefined, recordOutcome: async () => undefined,
    }) as unknown as PreparedRouteAttempt,
  },
});

describe('L1.3d API secretlint host adapter', () => {
  it('loads all 28 preset-recommend rules, matches lintSource parity, never echoes secrets, and ignores secretlint-disable', async () => {
    expect(SECRETLINT_PRESET_RULE_COUNT).toBe(28);
    const adapter = createSecretlintScannerAdapter();
    const samples = [
      `// secretlint-disable\n${FAKE_AWS}`,
      `gh=${FAKE_GH} gl=${FAKE_GL}`,
      `slack=${FAKE_SLACK} ts=${FAKE_TAILSCALE}`,
      `ant=${FAKE_ANTHROPIC}\n${FAKE_PEM}`,
    ].join('\n');
    const syncMatches = adapter.scan(samples, { includeDefaultPatterns: false });
    const asyncMatches = await adapter.scanAsync(samples, { includeDefaultPatterns: false });
    expect(syncMatches).toEqual(asyncMatches);
    const ruleIds = new Set(syncMatches.map((m) => m.ruleId));
    for (const expected of [
      '@secretlint/secretlint-rule-aws', '@secretlint/secretlint-rule-github',
      '@secretlint/secretlint-rule-gitlab', '@secretlint/secretlint-rule-slack',
      '@secretlint/secretlint-rule-tailscale', '@secretlint/secretlint-rule-anthropic',
      '@secretlint/secretlint-rule-privatekey',
    ]) expect(ruleIds.has(expected)).toBe(true);
    for (const m of [...syncMatches, ...asyncMatches]) {
      for (const secret of [FAKE_AWS, FAKE_GH, FAKE_GL, FAKE_SLACK, FAKE_TAILSCALE, FAKE_ANTHROPIC, FAKE_PEM]) {
        expect(m.message).not.toContain(secret);
      }
    }
  });

  it('parses YAML patterns via safeLoad JSON_SCHEMA, skips invalid entries, rejects !!js/function, and bounds input sizes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'l13d-api-'));
    try {
      const validFile = join(dir, 'patterns.yaml');
      writeFileSync(validFile, [
        'patterns:',
        '  - id: org-token',
        '    pattern: "stp_[A-Za-z0-9]{32}"',
        '  - id: bad-regex',
        '    pattern: "([unclosed"',
        '  - id: 123',
        '    pattern: "ignored"',
      ].join('\n'));
      expect(loadSecretPatterns(validFile)).toEqual([{ id: 'org-token', pattern: 'stp_[A-Za-z0-9]{32}' }]);
      expect(parseSecretPatternsYaml('- id: list-tok\n  pattern: "tok_[0-9]{8}"\n  flags: "i"\n'))
        .toEqual([{ id: 'list-tok', pattern: 'tok_[0-9]{8}', flags: 'i' }]);

      const unsafeYaml = `patterns:\n  - id: exploit\n    pattern: !!js/function "function(){ return '${FAKE_ORG_TOKEN}'; }"`;
      const unsafeFile = join(dir, 'unsafe.yaml');
      writeFileSync(unsafeFile, unsafeYaml);
      let caught: unknown;
      try { loadSecretPatterns(unsafeFile); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(SecretPatternYamlError);
      expect((caught as Error).message).not.toContain(FAKE_ORG_TOKEN);
      expect(() => parseSecretPatternsYaml('a'.repeat(SECRETLINT_MAX_YAML_BYTES + 1))).toThrow(SecretPatternYamlError);
      expect(() => parseSecretPatternsYaml('a'.repeat(SECRETLINT_MAX_YAML_BYTES + 1), Number.NaN)).toThrow(SecretPatternYamlError);
      expect(() => parseSecretPatternsYaml('a'.repeat(SECRETLINT_MAX_YAML_BYTES + 1), Number.POSITIVE_INFINITY)).toThrow(SecretPatternYamlError);
      const hugeFile = join(dir, 'huge.yaml');
      writeFileSync(hugeFile, 'a'.repeat(SECRETLINT_MAX_YAML_BYTES + 1));
      expect(() => loadSecretPatterns(hugeFile, Number.NaN)).toThrow(SecretPatternYamlError);
      expect(() => loadSecretPatterns(dir)).toThrow(/not a regular file/);

      const bounded = createSecretlintScannerAdapter({ maxScanChars: 80 });
      const padded = `${'x'.repeat(120)} ${FAKE_AWS}`;
      expect(bounded.scan(padded)).toEqual([]);
      expect(bounded.scan(`${FAKE_AWS} ${'x'.repeat(120)}`).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges preset, YAML, and KUBECONFIG_PATTERNS into strictly disjoint ranges without corrupting redaction', () => {
    const yamlPatterns = parseSecretPatternsYaml(`patterns:\n  - id: overlap-org\n    pattern: "pfx_${FAKE_ORG_TOKEN.slice(0, 10)}[A-Za-z0-9_]+"`);
    const adapter = createSecretlintScannerAdapter({ customPatterns: yamlPatterns });
    const text = `token: pfx_${FAKE_ORG_TOKEN}\ntoken: ${FAKE_KUBE_TOKEN}\n${FAKE_AWS}`;
    const matches = adapter.scan(text);
    for (let i = 0; i + 1 < matches.length; i += 1) expect(matches[i]!.end).toBeLessThanOrEqual(matches[i + 1]!.start);
    const masked = redactSecretMatches(text, matches);
    for (const raw of [FAKE_ORG_TOKEN, FAKE_KUBE_TOKEN, FAKE_AWS]) expect(masked).not.toContain(raw);
    expect(masked).toContain('<<SECRET:');
  });

  it('refuses YAML mask_in_flight matches inside P across all 3 wires (400, zero dispatch) and preserves audit_mask_copy byte-identity', async () => {
    const customPatterns = parseSecretPatternsYaml('patterns:\n  - id: org-token\n    pattern: "stp_[A-Za-z0-9]{32}"');
    const scanner = createSecretlintScannerAdapter({ customPatterns });
    const auditGuard = new GuardEngine({ secretScanner: scanner });
    const cleanPayload = { messages: [{ role: 'user', content: `${FAKE_AWS} org=${FAKE_ORG_TOKEN}` }] };
    const auditRes = auditGuard.inspectRequest(cleanPayload);
    expect(auditRes.inFlightPayload).toBe(cleanPayload);
    expect(JSON.stringify(auditRes.maskedCapture.payload)).not.toContain(FAKE_AWS);
    expect(JSON.stringify(auditRes.maskedCapture.payload)).not.toContain(FAKE_ORG_TOKEN);

    const guard = new GuardEngine({ secretScanner: scanner, detectorActions: { 'custom:org-token': 'mask_in_flight' } });
    const cases = [
      { path: '/v1/messages', model: 'claude-sonnet-5', provider: 'anthropic',
        bad: { model: 'claude-sonnet-5', system: `sys ${FAKE_ORG_TOKEN}`, messages: [{ role: 'user', content: 'hi' }] },
        ok: { model: 'claude-sonnet-5', system: 'clean', messages: [{ role: 'user', content: `tok ${FAKE_ORG_TOKEN}` }] } },
      { path: '/v1/chat/completions', model: 'gpt-5.6-terra', provider: 'openai',
        bad: { model: 'gpt-5.6-terra', messages: [{ role: 'developer', content: `dev ${FAKE_ORG_TOKEN}` }, { role: 'user', content: 'hi' }] },
        ok: { model: 'gpt-5.6-terra', messages: [{ role: 'developer', content: 'clean' }, { role: 'user', content: `tok ${FAKE_ORG_TOKEN}` }] } },
      { path: '/v1/responses', model: 'gpt-5.6-terra', provider: 'openai',
        bad: { model: 'gpt-5.6-terra', instructions: `inst ${FAKE_ORG_TOKEN}`, input: [{ role: 'user', content: 'hi' }] },
        ok: { model: 'gpt-5.6-terra', instructions: 'clean', input: [{ role: 'user', content: `tok ${FAKE_ORG_TOKEN}` }] } },
    ] as const;
    for (const tc of cases) {
      const dispatchSpy = vi.fn();
      const refused: { receiptId: string; detail?: unknown }[] = [];
      const requestAudit: RouteFlowDeps['requestAudit'] = {
        admit: async () => ({ receiptId: 'rcpt-l13d' }),
        refuse: async (receiptId, detail) => { refused.push({ receiptId, detail }); },
      };
      const app = createGatewayRouter({ config: BUDGET_CONFIG, routePlanner: plannerFor(dispatchSpy, tc.model, tc.provider), routeMetering: { settleRoute() {} }, requestAudit, guard });
      const badRes = await app.request(tc.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(tc.bad) });
      expect(badRes.status).toBe(400);
      expect(badRes.headers.get('x-should-retry')).toBe('false');
      expect(dispatchSpy).not.toHaveBeenCalled();
      expect(refused[0]?.detail).toMatchObject({ integrity: 'protected_identification_violation' });
      const okRes = await app.request(tc.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(tc.ok) });
      expect(okRes.status).toBe(200);
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(dispatchSpy.mock.calls[0]![0])).not.toContain(FAKE_ORG_TOKEN);
    }
  });
});
