import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLAUDE_CODE_OAUTH_ENV_VAR,
  NodeClaudeCodeCliRunner,
  createClaudeSeatAnthropicClient,
  probeClaudeCodeCliCapabilities,
} from '../../src/node/claude-code-cli-runner.js';
import {
  appendCappedTail,
  diagnoseClaudeCodeQuota,
  extractQuotaText,
  renderClaudeCodeCliPrompt,
} from '../../src/node/claude-code-cli-wire.js';
import { ClaudeCliQuotaError } from '../../src/transport/claude-code-runtime-client.js';
import type { ClaudeCodeCliRequest } from '../../src/transport/claude-code-runtime-client.js';

const TOKEN = 'fake-oauth-token-canary';
const OTHER_TOKEN = 'parent-key-canary';

const request = (modelId = 'claude-opus-5-5'): ClaudeCodeCliRequest => ({
  modelId,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Summarize this page' }] }],
});
const access = { accessToken: TOKEN, expiresAt: Date.now() + 3_600_000, scopes: ['user:inference'] };
const never = new AbortController().signal;

const FAKE = String.raw`#!/bin/sh
here="$(dirname "$0")"
dump="$here/dump"
mkdir -p "$dump"
mode="$(cat "$here/mode" 2>/dev/null)"
if [ -z "$mode" ]; then mode=record; fi
{
  for a in "$@"; do printf '%s\n' "$a"; done
} > "$dump/argv"
{
  if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then printf 'oauth_set=yes\noauth_value=%s\n' "$CLAUDE_CODE_OAUTH_TOKEN"; else printf 'oauth_set=no\n'; fi
  if [ -n "$ANTHROPIC_API_KEY" ]; then printf 'anthropic_key=present\n'; else printf 'anthropic_key=absent\n'; fi
  for v in ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN GOOGLE_API_KEY GEMINI_API_KEY; do
    eval "val=\${$v:-}"
    if [ -n "$val" ]; then printf 'leak_%s=present\n' "$v"; fi
  done
  printf 'home=%s\n' "$HOME"
  printf 'config=%s\n' "$CLAUDE_CONFIG_DIR"
  if [ -n "$PATH" ]; then printf 'path_set=yes\n'; else printf 'path_set=no\n'; fi
} > "$dump/env"
if [ "$1" = "--version" ]; then
  case "$mode" in
    old-version) printf '%s\n' '1.9.0 (Claude Code)' ;;
    *) printf '%s\n' '2.1.296 (Claude Code)' ;;
  esac
  exit 0
fi
if [ "$1" = "--help" ]; then
  case "$mode" in
    help-stripped)
      printf '%s\n' '--verbose' '--output-format' '--model' '--effort' '--tools' '--no-session-persistence' '--system-prompt-file' ;;
    *)
      printf '%s\n' '--verbose' '--output-format' '--model' '--effort' '--system-prompt-file' '--tools' '--strict-mcp-config' '--no-session-persistence' ;;
  esac
  exit 0
fi
pwd > "$dump/cwd"
cat > "$dump/stdin"
case "$mode" in
  record)
    printf '%s\n' '{"type":"system","subtype":"init","tools":[],"mcp_servers":[]}'
    printf '%s\n' 'not-json noise'
    printf '%s\n' '{"type":"assistant","message":{"type":"message","role":"assistant","content":[{"type":"text","text":"Hello"}]}}'
    printf '%s\n' '{"type":"result","subtype":"success","is_error":false,"result":"Hello","usage":{"input_tokens":3,"output_tokens":2}}'
    ;;
  tool)
    printf '%s\n' '{"type":"assistant","message":{"type":"message","role":"assistant","content":[{"type":"text","text":"Looking"},{"type":"tool_use","id":"call-1","name":"lookup","input":{"q":"test"}}],"stop_reason":"tool_use"}}'
    printf '%s\n' '{"type":"result","subtype":"success","is_error":false,"result":"done","usage":{"input_tokens":8,"output_tokens":4}}'
    ;;
  quota5h)
    printf '%s\n' "Error: You've hit your 5-hour limit. Please try again in 30 minutes." >&2
    exit 1
    ;;
  quota-retry)
    printf '%s\n' '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Rate limit exceeded, please retry in 2 minutes"}'
    exit 1
    ;;
  fail)
    printf '%s\n' 'boom' >&2
    exit 3
    ;;
  noresult)
    printf '%s\n' '{"type":"system","subtype":"init"}'
    ;;
  slow)
    sleep 30 & SLEEP_PID=$!
    wait $SLEEP_PID
    ;;
  version)
    printf '%s\n' '2.1.296 (Claude Code)'
    ;;
esac
`;

let dir = '';
let dump = '';
let savedPath: string | undefined;
let savedToken: string | undefined;
let savedExtra: Record<string, string | undefined> = {};

const EXTRA_ENV = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'] as const;

const collect = async (source: AsyncIterable<unknown>) => {
  const events: unknown[] = [];
  for await (const event of source) events.push(event);
  return events;
};

const readDump = async (name: string): Promise<string> => {
  const { readFile } = await import('node:fs/promises');
  return readFile(join(dump, name), 'utf8');
};

const setMode = async (mode: string): Promise<void> => {
  await writeFile(join(dir, 'mode'), mode, 'utf8');
};

const waitFor = async (name: string, timeoutMs = 10_000): Promise<void> => {
  const start = Date.now();
  for (;;) {
    try { await readDump(name); return; } catch { /* not yet */ }
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${name}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fake-claude-'));
  dump = join(dir, 'dump');
  await writeFile(join(dir, 'claude'), FAKE, 'utf8');
  await chmod(join(dir, 'claude'), 0o755);
  await setMode('record');
  savedPath = process.env.PATH;
  savedToken = process.env.ANTHROPIC_API_KEY;
  savedExtra = {};
  for (const name of EXTRA_ENV) {
    savedExtra[name] = process.env[name];
    delete process.env[name];
  }
  process.env.PATH = `${dir}:${savedPath ?? ''}`;
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  process.env.PATH = savedPath;
  if (savedToken === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedToken;
  for (const name of EXTRA_ENV) {
    const saved = savedExtra[name];
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
});

describe('node claude CLI runner', () => {
  it('should spawn the CLI headless with model, effort and stream-json flags', async () => {
    const runner = new NodeClaudeCodeCliRunner();
    const events = await collect(runner.run({ access, request: request(), signal: never }));
    await waitFor('argv');
    expect((await readDump('argv')).split('\n').filter(Boolean)).toEqual([
      '-p', '--output-format', 'stream-json', '--model', 'claude-opus-5-5', '--effort', 'medium',
    ]);
    expect(events).toEqual([
      { type: 'text_delta', text: 'Hello' },
      { type: 'result', finishReason: 'stop', usage: { inputTokens: 3, outputTokens: 2 } },
    ]);
  });

  it('should send the projected prompt over stdin and the seat token only in the child env', async () => {
    process.env.ANTHROPIC_API_KEY = OTHER_TOKEN;
    const runner = new NodeClaudeCodeCliRunner({ systemPromptFile: '/tmp/fake-system.md' });
    await collect(runner.run({ access, request: request(), signal: never }));
    await waitFor('stdin');
    expect(await readDump('stdin')).toBe('user: Summarize this page\n');
    expect((await readDump('argv')).split('\n').filter(Boolean)).toEqual([
      '-p', '--output-format', 'stream-json', '--model', 'claude-opus-5-5', '--effort', 'medium',
      '--system-prompt-file', '/tmp/fake-system.md',
    ]);
    const env = await readDump('env');
    expect(env).toContain(`oauth_value=${TOKEN}`);
    expect(env).toContain('anthropic_key=absent');
    const argv = await readDump('argv');
    expect(argv).not.toContain(TOKEN);
    expect(argv).not.toContain(OTHER_TOKEN);
  });

  it('should normalize assistant tool blocks and terminal usage', async () => {
    process.env.FAKE_CLAUDE_MODE = 'tool';
    const runner = new NodeClaudeCodeCliRunner();
    const events = await collect(runner.run({ access, request: request(), signal: never }));
    expect(events).toEqual([
      { type: 'text_delta', text: 'Looking' },
      { type: 'tool_use', id: 'call-1', name: 'lookup', input: { q: 'test' } },
      { type: 'result', finishReason: 'tool_calls', usage: { inputTokens: 8, outputTokens: 4 } },
    ]);
  });

  it('should map the 5-hour session limit to the typed quota failure', async () => {
    await setMode('quota5h');
    const runner = new NodeClaudeCodeCliRunner();
    const error = await collect(runner.run({ access, request: request(), signal: never })).then(
      () => { throw new Error('should have thrown'); },
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(ClaudeCliQuotaError);
    expect(error).toMatchObject({ code: 'claude_cli_rate_limited', status: 429, retryable: true, retryReason: 'rate_limit' });
    expect(String(error)).not.toContain(TOKEN);
  });

  it('should read the retry delay from quota prose', async () => {
    await setMode('quota-retry');
    const runner = new NodeClaudeCodeCliRunner();
    const error = await collect(runner.run({ access, request: request(), signal: never })).then(
      () => { throw new Error('should have thrown'); },
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(ClaudeCliQuotaError);
    expect(error).toMatchObject({ retryAfterMs: 120_000 });
  });

  it('should surface non-quota exits as plain runner errors', async () => {
    await setMode('fail');
    const runner = new NodeClaudeCodeCliRunner();
    await expect(collect(runner.run({ access, request: request(), signal: never })))
      .rejects.toMatchObject({ name: 'ClaudeCliRunnerError' });
  });

  it('should surface a clean exit without a result as a plain runner error', async () => {
    await setMode('noresult');
    const runner = new NodeClaudeCodeCliRunner();
    await expect(collect(runner.run({ access, request: request(), signal: never })))
      .rejects.toMatchObject({ name: 'ClaudeCliRunnerError' });
  });

  it('should kill the child on abort and report AbortError', async () => {
    await setMode('slow');
    const runner = new NodeClaudeCodeCliRunner();
    const controller = new AbortController();
    const pending = collect(runner.run({ access, request: request(), signal: controller.signal }));
    await waitFor('argv');
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor('killed');
  });

  it('should time out a silent child', async () => {
    await setMode('slow');
    const runner = new NodeClaudeCodeCliRunner({ timeoutMs: 300 });
    await expect(collect(runner.run({ access, request: request(), signal: never })))
      .rejects.toMatchObject({ name: 'ClaudeCliRunnerError', message: expect.stringContaining('timed out') });
  });

  it('should refuse invalid options before spawning', async () => {
    expect(() => new NodeClaudeCodeCliRunner({ effort: 'med ium' })).toThrow(/effort/);
    expect(() => new NodeClaudeCodeCliRunner({ timeoutMs: 0 })).toThrow(/timeout/);
    const runner = new NodeClaudeCodeCliRunner();
    await expect(collect(runner.run({ access, request: request('--bad id'), signal: never })))
      .rejects.toMatchObject({ name: 'ClaudeCliRunnerError' });
  });

  it('should diagnose quota prose without matching benign text', () => {
    expect(diagnoseClaudeCodeQuota('done')).toEqual({ quota: false });
    expect(diagnoseClaudeCodeQuota("You've hit your 5-hour limit")).toEqual({ quota: true });
  });

  it('should ignore numeric telemetry when extracting quota text', () => {
    expect(extractQuotaText({
      type: 'result', result: 'done', usage: { input_tokens: 429, output_tokens: 429 },
    })).toBe('done');
    expect(extractQuotaText({ type: 'result', usage: { input_tokens: 429 } })).toBeUndefined();
    expect(extractQuotaText({ type: 'result', code: 429 })).toBe('429');
    expect(extractQuotaText(null)).toBeUndefined();
  });

  it('should cap stderr tails in bytes with a zero cap keeping nothing', () => {
    const tail = appendCappedTail(Buffer.from('abc'), Buffer.from([0xc3, 0xa9]), 4);
    expect([...tail]).toEqual([...Buffer.from('bcé')]);
    expect(appendCappedTail(Buffer.from('abc'), Buffer.from('d'), 0).length).toBe(0);
  });
  it('should render prompts deterministically', () => {
    expect(renderClaudeCodeCliPrompt(request())).toBe('user: Summarize this page\n');
  });

  it('should probe capabilities from the CLI version without a token', async () => {
    const capabilities = await probeClaudeCodeCliCapabilities({
      source: 'fake-source', qualificationRef: 'fake-receipt',
    });
    expect(capabilities).toEqual({
      protocol: 'claude-code-stream-json-v1',
      cliVersion: '2.1.296',
      source: 'fake-source',
      qualificationRef: 'fake-receipt',
    });
    const env = await readDump('env');
    expect(env).toContain('oauth_set=no');
  });

  it('should build the consumer anthropic client through the factory', () => {
    const client = createClaudeSeatAnthropicClient({
      capabilities: { protocol: 'claude-code-stream-json-v1',
        cliVersion: 'fake-version', source: 'fake-source', qualificationRef: 'fake-receipt' },
      effort: 'medium',
    });
    expect(client).toBeDefined();
    expect(typeof client.stream).toBe('function');
    expect(typeof client.generate).toBe('function');
  });
});
