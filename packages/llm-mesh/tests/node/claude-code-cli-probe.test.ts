import { readFileSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NodeClaudeCodeCliRunner,
  probeClaudeCodeCliCapabilities,
} from '../../src/node/claude-code-cli-runner.js';

const REAL_2_1_330_HELP = readFileSync(new URL('../fixtures/claude-code-2.1.330-help.txt', import.meta.url), 'utf8');
const OLDER_2_1_HELP = REAL_2_1_330_HELP.replace(
  '  --system-prompt <prompt>              System prompt to use for the session\n',
  '  --system-prompt <prompt>              System prompt to use for the session\n'
  + '  --system-prompt-file <file>           Load system prompt from a file\n',
);
const CONFINEMENT_FLAGS = ['--tools', '--strict-mcp-config', '--no-session-persistence'] as const;

const stripOptionBlock = (help: string, flag: string): string => {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startRe = new RegExp(`^  (?:-[a-zA-Z],\\s*)?${escaped}(?:$|[,\\s=])`);
  const out: string[] = [];
  let skipping = false;
  for (const line of help.split('\n')) {
    if (startRe.test(line)) { skipping = true; continue; }
    if (skipping) {
      if (line.startsWith('    ') || line.startsWith('\t')) continue;
      skipping = false;
    }
    out.push(line);
  }
  return out.join('\n');
};

const scrubFlagMentions = (help: string, flag: string): string =>
  help.replace(new RegExp(`${flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9-])`, 'g'), '--redacted');

const FAKE_CLI = String.raw`#!/bin/sh
here="$(dirname "$0")"
printf '%s\n' "$*" >> "$here/calls"
if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then printf 'yes\n' >> "$here/oauth"; else printf 'no\n' >> "$here/oauth"; fi
if [ "$1" = "--version" ]; then cat "$here/version"; exit 0; fi
if [ "$1" = "--help" ]; then cat "$here/help"; exit 0; fi
spf_file=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--system-prompt-file" ]; then spf_file="$arg"; break; fi
  prev="$arg"
done
spf_mode="$(cat "$here/spf-mode" 2>/dev/null)"
if [ -n "$spf_file" ] && [ ! -f "$spf_file" ] && [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
  case "$spf_mode" in
    unknown) printf "error: unknown option '--system-prompt-file'\n" >&2; exit 1 ;;
    silent-zero) exit 0 ;;
    silent-auth) printf "Error: Not logged in\n" >&2; exit 1 ;;
    *) printf 'Error: System prompt file not found: %s\n' "$spf_file" >&2; exit 1 ;;
  esac
fi
cat >/dev/null
printf '%s\n' '{"type":"system","subtype":"init","tools":[],"mcp_servers":[]}'
printf '%s\n' '{"type":"assistant","message":{"type":"message","role":"assistant","content":[{"type":"text","text":"ok"}]}}'
printf '%s\n' '{"type":"result","subtype":"success","is_error":false,"result":"ok","usage":{"input_tokens":1,"output_tokens":1}}'
`;

let dir = '';
let cliPath = '';

const setFixture = async (help: string, version = '2.1.330 (Claude Code)\n', spfMode = 'accept') => {
  await writeFile(join(dir, 'help'), help, 'utf8');
  await writeFile(join(dir, 'version'), version, 'utf8');
  await writeFile(join(dir, 'spf-mode'), spfMode, 'utf8');
};

const probe = (extra: { requireSystemPromptFile?: boolean } = {}) =>
  probeClaudeCodeCliCapabilities({ cliPath, source: 'test', qualificationRef: 'ref-1', ...extra });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'claude-probe-'));
  cliPath = join(dir, 'claude');
  await writeFile(cliPath, FAKE_CLI, 'utf8');
  await chmod(cliPath, 0o755);
  await setFixture(REAL_2_1_330_HELP);
});

afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('claude CLI strict probe and --system-prompt-file verification', () => {
  it('accepts the real Claude Code 2.1.330 help text without --system-prompt-file declared', async () => {
    expect(REAL_2_1_330_HELP).not.toMatch(/^  --system-prompt-file/m);
    expect(REAL_2_1_330_HELP).toContain('--system-prompt[-file]');
    const caps = await probe();
    expect(caps).toEqual({
      protocol: 'claude-code-stream-json-v1', cliVersion: '2.1.330', source: 'test', qualificationRef: 'ref-1',
    });
  });

  it('still accepts an older 2.1 help declaring --system-prompt-file without extra probe spawn', async () => {
    await setFixture(OLDER_2_1_HELP, '2.1.296 (Claude Code)\n', 'unknown');
    expect((await probe()).cliVersion).toBe('2.1.296');
    expect((await probe({ requireSystemPromptFile: true })).cliVersion).toBe('2.1.296');
    const calls = (await readFile(join(dir, 'calls'), 'utf8')).trim().split('\n');
    expect(calls.every((line) => line === '--version' || line === '--help')).toBe(true);
  });

  it.each(CONFINEMENT_FLAGS)('rejects missing confinement flag %s and names only that flag', async (flag) => {
    await setFixture(scrubFlagMentions(stripOptionBlock(REAL_2_1_330_HELP, flag), flag));
    const err = await probe().catch((cause: unknown) => cause as Error);
    expect(err).toMatchObject({ name: 'ClaudeCliRunnerError' });
    expect(err.message).toContain('confinement');
    expect(err.message).toContain(flag);
    for (const other of CONFINEMENT_FLAGS) {
      if (other !== flag) expect(err.message).not.toContain(other);
    }
  });

  it.each(CONFINEMENT_FLAGS)('rejects confinement flag %s when it appears only in prose', async (flag) => {
    const proseOnly = stripOptionBlock(REAL_2_1_330_HELP, flag).replace(
      '  --bare                                Minimal mode:',
      `  --bare                                Minimal mode (mentions ${flag} in prose):`,
    );
    await setFixture(proseOnly);
    await expect(probe()).rejects.toMatchObject({
      name: 'ClaudeCliRunnerError', message: expect.stringContaining(flag),
    });
  });

  it.each([
    ['--tools', '--tools-extra'],
    ['--strict-mcp-config', '--strict-mcp-config-v2'],
    ['--no-session-persistence', '--no-session-persistence-mode'],
  ] as const)('rejects confinement flag %s when only longer prefix %s is declared', async (flag, longer) => {
    const cleaned = scrubFlagMentions(stripOptionBlock(REAL_2_1_330_HELP, flag), flag)
      .replace('  --verbose', `  ${longer}                Extended flag\n  --verbose`);
    await setFixture(cleaned);
    await expect(probe()).rejects.toMatchObject({
      name: 'ClaudeCliRunnerError', message: expect.stringContaining(flag),
    });
  });

  it.each([
    ['--verbose', '--verbose-logging'],
    ['--output-format', '--output-format-v2'],
    ['--model', '--model-id'],
    ['--effort', '--effort-level'],
  ] as const)('rejects required flag %s when prose-only or only longer prefix %s exists', async (flag, longer) => {
    const cleaned = scrubFlagMentions(stripOptionBlock(REAL_2_1_330_HELP, flag), flag)
      .replace('  --bare                                Minimal mode:',
        `  --bare                                Minimal mode (mentions ${flag} in prose):`)
      .replace('  --bare', `  ${longer}                Extended flag\n  --bare`);
    await setFixture(cleaned);
    await expect(probe()).rejects.toMatchObject({
      name: 'ClaudeCliRunnerError', message: expect.stringContaining(flag),
    });
  });

  it('rejects -p when missing or only mentioned in prose / longer prefix', async () => {
    const noP = stripOptionBlock(REAL_2_1_330_HELP, '-p')
      .replace('  --verbose', '  -print                                Not short -p\n  --verbose');
    await setFixture(noP);
    await expect(probe()).rejects.toMatchObject({
      name: 'ClaudeCliRunnerError', message: expect.stringMatching(/headless.*-p/),
    });
  });

  it('rejects stream-json missing from --output-format even when present elsewhere or as longer token', async () => {
    const noStream = REAL_2_1_330_HELP.replace(
      /  --output-format <format>[\s\S]*?(?=\n  --permission-mode)/,
      '  --output-format <format>              Output format: "text", "json", "stream-json-v2"',
    );
    await setFixture(noStream);
    await expect(probe()).rejects.toMatchObject({
      name: 'ClaudeCliRunnerError', message: expect.stringMatching(/stream-json.*--output-format/),
    });
  });

  it('requires positive evidence for --system-prompt-file in probe and runner when configured', async () => {
    expect((await probe({ requireSystemPromptFile: true })).cliVersion).toBe('2.1.330');
    const access = { accessToken: 'canary-tok', expiresAt: Date.now() + 60_000, scopes: ['user:inference'] };
    const req = { modelId: 'claude-opus-5-5', messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }] };
    const okRunner = new NodeClaudeCodeCliRunner({ cliPath, systemPromptFile: '/tmp/sys.md' });
    await writeFile(join(dir, 'calls'), '', 'utf8');
    const collect = async (runner: NodeClaudeCodeCliRunner) => {
      const out: unknown[] = [];
      for await (const event of runner.run({ access, request: req, signal: new AbortController().signal })) out.push(event);
      return out;
    };
    expect(await collect(okRunner)).toEqual([
      { type: 'text_delta', text: 'ok' },
      { type: 'result', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    await collect(okRunner);
    const okCalls = (await readFile(join(dir, 'calls'), 'utf8')).trim().split('\n');
    expect(okCalls.filter((line) => line.includes('claude-probe-nonexistent-system-prompt.txt'))).toHaveLength(1);
    expect(okCalls.filter((line) => line.includes('--system-prompt-file /tmp/sys.md'))).toHaveLength(2);

    for (const mode of ['unknown', 'silent-zero', 'silent-auth'] as const) {
      await setFixture(REAL_2_1_330_HELP, '2.1.330 (Claude Code)\n', mode);
      await expect(probe({ requireSystemPromptFile: true })).rejects.toMatchObject({
        name: 'ClaudeCliRunnerError', message: expect.stringContaining('--system-prompt-file'),
      });
      await writeFile(join(dir, 'oauth'), '', 'utf8');
      const badRunner = new NodeClaudeCodeCliRunner({ cliPath, systemPromptFile: '/tmp/sys.md' });
      await expect(collect(badRunner)).rejects.toMatchObject({
        name: 'ClaudeCliRunnerError', message: expect.stringContaining('--system-prompt-file'),
      });
      expect(await readFile(join(dir, 'oauth'), 'utf8')).not.toContain('yes');
    }
  });
});
