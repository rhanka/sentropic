import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHarnessCli } from '../../src/cli/run.js';

const document = {
  id: 'sentbase',
  forbiddenPathDefaults: ['Cargo.toml', '.githooks/**', 'LICENSE'],
  allowedPathDefaults: ['src/**', 'web/**'],
  conditionalPathDefaults: ['Cargo.lock'],
  exceptionIdPattern: '^EXC-\\d+$',
  conditionalRequiresException: true,
  branchMatch: 'exact',
  branchMd: {
    file: 'BRANCH.md', allowedHeading: 'Allowed Paths', forbiddenHeading: 'Forbidden Paths',
    conditionalHeading: 'Conditional Paths', planHeading: 'Plan / Todo',
  },
  commitMessage: { requiredPattern: '^(feat|fix): ', forbiddenPatterns: ['Co-Authored-By:'] },
};

function capture(...argv: string[]) {
  const lines: string[] = [];
  const code = runHarnessCli(argv, (line) => lines.push(line));
  return { code, text: lines.join('\n') };
}

describe('repository-owned profiles through the CLI', () => {
  let repo: string;
  let cwd: string;
  beforeEach(() => {
    cwd = process.cwd();
    repo = mkdtempSync(join(tmpdir(), 'harness-profile-'));
    mkdirSync(join(repo, '.git'));
    writeFileSync(join(repo, 'harness.profile.json'), JSON.stringify(document));
    process.chdir(repo);
  });
  afterEach(() => { process.chdir(cwd); rmSync(repo, { recursive: true, force: true }); });

  it('loads an explicit profile file and enforces its three path buckets', () => {
    for (const path of ['Cargo.toml', '.githooks/pre-commit', 'LICENSE']) {
      expect(capture('check', 'scope', '--profile-file', 'harness.profile.json', '--staged-files', path).text)
        .toContain(`forbidden path touched: ${path}`);
    }
    expect(capture('check', 'scope', '--staged-files', 'src/lib.rs,web/index.ts').text).toContain('PASS C2 (sentbase)');
    expect(capture('check', 'scope', '--staged-files', 'Cargo.lock').text).toContain('without a matching exception');
    writeFileSync('BRANCH.md', '# Feature: x\n## Feedback Loop\n- EXC-1\n');
    expect(capture('check', 'scope', '--staged-files', 'Cargo.lock').text).toContain('PASS C2');
  });

  it('discovers only at the repository root, including from a nested directory', () => {
    mkdirSync('web');
    writeFileSync('web/harness.profile.json', 'invalid');
    process.chdir(join(repo, 'web'));
    expect(capture('check', 'scope', '--staged-files', 'LICENSE').text).toContain('FAIL C2 (sentbase)');
  });

  it('gives explicit profile precedence over file and discovery, and file over discovery', () => {
    writeFileSync('other.json', JSON.stringify({ ...document, id: 'other' }));
    expect(capture('check', 'scope', '--profile-file', 'other.json').text).toContain('(other)');
    writeFileSync('harness.profile.json', 'invalid');
    expect(capture('check', 'scope', '--profile', 'stub', '--profile-file', 'missing.json').text).toContain('(stub)');
    expect(capture('check', 'scope', '--profile-file', 'other.json').text).toContain('(other)');
  });

  it.each(['check', 'verify', 'audit', 'init'])('shares profile resolution with %s', (verb) => {
    const result = capture(verb, ...(verb === 'check' ? ['scope'] : []), '--json');
    expect(result.code).toBe(0);
    if (verb === 'init') expect(JSON.parse(result.text)).toEqual(document);
  });

  it('enforces configured commit-message guards when a message is supplied', () => {
    expect(capture('check', 'scope', '--commit-message', 'feat: add API').text).toContain('PASS C2');
    expect(capture('check', 'scope', '--commit-message', 'oops').text).toContain('FAIL C2');
    expect(capture('check', 'scope', '--commit-message', 'feat: add API\n\nCo-Authored-By: x').text).toContain('FAIL C2');
  });

  it.each([
    ['--profile-file', 'missing.json', 'PROFILE_READ'],
    ['--profile', 'unknown', 'UNKNOWN_PROFILE'],
    ['--profile', '', 'INVALID_PROFILE'],
    ['--profile-file', '', 'INVALID_PROFILE'],
  ])('reports %s %s as a typed configuration error', (flag, value, code) => {
    const result = capture('check', 'scope', flag, value);
    expect(result.code).toBe(2);
    expect(result.text).toContain(code);
  });

  it('fails closed on a malformed discovered profile', () => {
    writeFileSync('harness.profile.json', '{');
    const result = capture('check', 'scope');
    expect(result.code).toBe(2);
    expect(result.text).toContain('PROFILE_JSON');
  });

  it('rejects unknown keys without silently using sentropic', () => {
    writeFileSync('harness.profile.json', JSON.stringify({ ...document, forbidenPaths: [] }));
    const result = capture('check', 'scope');
    expect(result.code).toBe(2);
    expect(result.text).toMatch(/UNKNOWN_KEY.*forbidenPaths/);
  });
});
