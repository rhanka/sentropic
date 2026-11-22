import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createHostApp } from '../src/app';
import {
  SECRETLINT_MAX_YAML_BYTES, SECRETLINT_PRESET_RULE_COUNT, SecretPatternYamlError,
  createSecretlintScannerAdapter, loadSecretPatterns, parseSecretPatternsYaml,
} from '../src/secretlint-scanner-adapter';
import { scanCustomPatterns } from '../src/secretlint-yaml-patterns';
import { AUTHORIZATION, fixtureDependencies, testConfig } from './fixtures';

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

describe('L1.3d standalone host secretlint adapter', () => {
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
    const dir = mkdtempSync(join(tmpdir(), 'l13d-host-'));
    try {
      const validFile = join(dir, 'patterns.yaml');
      writeFileSync(validFile, [
        'patterns:',
        '  - id: org-token',
        '    pattern: "stp_[A-Za-z0-9]{32}"',
        '  - id: bad-regex',
        '    pattern: "([unclosed"',
        '  - id: 42',
        '    pattern: "ignored"',
      ].join('\n'));
      expect(loadSecretPatterns(validFile)).toEqual([{ id: 'org-token', pattern: 'stp_[A-Za-z0-9]{32}' }]);
      expect(parseSecretPatternsYaml('- id: list-tok\n  pattern: "tok_[0-9]{8}"\n  flags: "i"\n'))
        .toEqual([{ id: 'list-tok', pattern: 'tok_[0-9]{8}', flags: 'i' }]);

      const unsafeFile = join(dir, 'unsafe.yaml');
      writeFileSync(unsafeFile, `patterns:\n  - id: exploit\n    pattern: !!js/function "function(){ return '${FAKE_ORG_TOKEN}'; }"`);
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

      const uniquePattern = [{ id: 'cache-probe', pattern: 'cache_probe_[0-9]{6}' }];
      const OrigRegExp = globalThis.RegExp;
      let compileCount = 0;
      globalThis.RegExp = new Proxy(OrigRegExp, {
        construct(target, args, newTarget) {
          compileCount += 1;
          return Reflect.construct(target, args, newTarget);
        },
      });
      try {
        expect(scanCustomPatterns('cache_probe_123456', uniquePattern)).toHaveLength(1);
        expect(compileCount).toBe(1);
        expect(scanCustomPatterns('cache_probe_654321', uniquePattern)).toHaveLength(1);
        expect(compileCount).toBe(1);
      } finally {
        globalThis.RegExp = OrigRegExp;
      }

      const bounded = createSecretlintScannerAdapter({ maxScanChars: 80 });
      expect(bounded.scan(`${'x'.repeat(120)} ${FAKE_AWS}`)).toEqual([]);
      expect(bounded.scan(`${FAKE_AWS} ${'x'.repeat(120)}`).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges preset, YAML, and KUBECONFIG_PATTERNS into strictly disjoint ranges', () => {
    const yamlPatterns = parseSecretPatternsYaml(`patterns:\n  - id: overlap-org\n    pattern: "pfx_${FAKE_ORG_TOKEN.slice(0, 10)}[A-Za-z0-9_]+"`);
    const adapter = createSecretlintScannerAdapter({ customPatterns: yamlPatterns });
    const text = `token: pfx_${FAKE_ORG_TOKEN}\ntoken: ${FAKE_KUBE_TOKEN}\n${FAKE_AWS}`;
    const matches = adapter.scan(text);
    expect(matches.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i + 1 < matches.length; i += 1) expect(matches[i]!.end).toBeLessThanOrEqual(matches[i + 1]!.start);
    expect(adapter.scan(`token: ${FAKE_KUBE_TOKEN}`, { includeDefaultPatterns: false })).toEqual([]);
  });

  it('wires secretlint into createHostApp: refuses YAML mask_in_flight inside P across all 3 wires and keeps default byte-identical', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'l13d-wire-'));
    try {
      const patternsFilePath = join(dir, 'patterns.yaml');
      writeFileSync(patternsFilePath, 'patterns:\n  - id: org-token\n    pattern: "stp_[A-Za-z0-9]{32}"\n');

      // Default host (no secretlint/guard) preserves payload byte-identically.
      const defaultSpy = vi.fn(async (_s: unknown, _w: unknown, _t: unknown, _req: unknown) => ({
        id: 'r0', providerId: 'openai' as const, modelId: 'gpt-fixture',
        message: { role: 'assistant' as const, content: 'ok' }, text: 'ok',
        toolCalls: [], finishReason: 'stop' as const, usage: { inputTokens: 1, outputTokens: 1 },
      }));
      const defaultHost = await createHostApp({ config: testConfig(), dependencies: fixtureDependencies(undefined, defaultSpy).dependencies });
      const defaultRes = await defaultHost.app.request('/v1/chat/completions', {
        method: 'POST', headers: { authorization: AUTHORIZATION, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-fixture', messages: [{ role: 'developer', content: `dev ${FAKE_ORG_TOKEN}` }, { role: 'user', content: 'hi' }] }),
      });
      expect(defaultRes.status).toBe(200);
      expect(JSON.stringify(defaultSpy.mock.calls[0]![3])).toContain(FAKE_ORG_TOKEN);

      const cases = [
        { path: '/v1/messages',
          bad: { model: 'gpt-fixture', max_tokens: 32, system: `sys ${FAKE_ORG_TOKEN}`, messages: [{ role: 'user', content: 'hi' }] },
          ok: { model: 'gpt-fixture', max_tokens: 32, system: 'clean', messages: [{ role: 'user', content: `tok ${FAKE_ORG_TOKEN}` }] } },
        { path: '/v1/chat/completions',
          bad: { model: 'gpt-fixture', messages: [{ role: 'developer', content: `dev ${FAKE_ORG_TOKEN}` }, { role: 'user', content: 'hi' }] },
          ok: { model: 'gpt-fixture', messages: [{ role: 'developer', content: 'clean' }, { role: 'user', content: `tok ${FAKE_ORG_TOKEN}` }] } },
        { path: '/v1/responses',
          bad: { model: 'gpt-fixture', instructions: `inst ${FAKE_ORG_TOKEN}`, input: [{ role: 'user', content: 'hi' }] },
          ok: { model: 'gpt-fixture', instructions: 'clean', input: [{ role: 'user', content: `tok ${FAKE_ORG_TOKEN}` }] } },
      ] as const;
      for (const tc of cases) {
        const generateSpy = vi.fn(async (_s: unknown, _w: unknown, _t: unknown, _req: unknown) => ({
          id: 'r1', providerId: 'openai' as const, modelId: 'gpt-fixture',
          message: { role: 'assistant' as const, content: 'ok' }, text: 'ok',
          toolCalls: [], finishReason: 'stop' as const, usage: { inputTokens: 1, outputTokens: 1 },
        }));
        const base = fixtureDependencies(undefined, generateSpy).dependencies;
        const host = await createHostApp({
          config: testConfig(),
          dependencies: { ...base, secretlint: { patternsFilePath, detectorActions: { 'custom:org-token': 'mask_in_flight' } } },
        });
        const badRes = await host.app.request(tc.path, {
          method: 'POST', headers: { authorization: AUTHORIZATION, 'content-type': 'application/json' },
          body: JSON.stringify(tc.bad),
        });
        expect(badRes.status).toBe(400);
        expect(badRes.headers.get('x-should-retry')).toBe('false');
        expect(generateSpy).not.toHaveBeenCalled();

        const okRes = await host.app.request(tc.path, {
          method: 'POST', headers: { authorization: AUTHORIZATION, 'content-type': 'application/json' },
          body: JSON.stringify(tc.ok),
        });
        expect(okRes.status).toBe(200);
        expect(generateSpy).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(generateSpy.mock.calls[0]![3])).not.toContain(FAKE_ORG_TOKEN);
        expect(JSON.stringify(generateSpy.mock.calls[0]![3])).toContain('<<SECRET:custom_org-token:');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
