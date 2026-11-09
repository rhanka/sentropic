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
  init-tools)
    printf '%s\n' '{"type":"system","subtype":"init","tools":[{"name":"Bash"}],"mcp_servers":[]}'
    printf '%s\n' '{"type":"assistant","message":{"type":"message","role":"assistant","content":[{"type":"text","text":"Hello"}]}}'
    printf '%s\n' '{"type":"result","subtype":"success","is_error":false,"result":"Hello","usage":{"input_tokens":3,"output_tokens":2}}'
    ;;
  init-mcp)
    printf '%s\n' '{"type":"system","subtype":"init","tools":[],"mcp_servers":[{"name":"evil"}]}'
    printf '%s\n' '{"type":"assistant","message":{"type":"message","role":"assistant","content":[{"type":"text","text":"Hello"}]}}'
    printf '%s\n' '{"type":"result","subtype":"success","is_error":false,"result":"Hello","usage":{"input_tokens":3,"output_tokens":2}}'
    ;;
  quota5h)
    printf '%s\n' "Error: You've hit your 5-hour limit. Please try again in 30 minutes." >&2
    exit 1
    ;;
  quota-retry)
    printf '%s\n' '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Rate limit exceeded, please retry in 2 minutes"}'
    exit 1
    ;;
  numeric-429)
    printf '%s\n' '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"done","usage":{"input_tokens":429,"output_tokens":429}}'
    exit 1
    ;;
  fail)
    printf '%s\n' 'boom' >&2
    exit 3
    ;;
  noresult)
    printf '%s\n' '{"type":"system","subtype":"init","tools":[],"mcp_servers":[]}'
    ;;
  noeol)
    printf '%s' '{"type":"result","subtype":"success","is_error":false,"result":"Héllo wörld","usage":{"input_tokens":3,"output_tokens":2}}'
    ;;
  longline)
    printf '%s\n' '{"type":"system","subtype":"init","tools":[],"mcp_servers":[]}'
    head -c 1200000 /dev/zero | tr '\0' 'A'
    exit 0
    ;;
  flood)
    printf '%s\n' '{"type":"system","subtype":"init","tools":[],"mcp_servers":[]}'
    yes '{"type":"noise","n":1}' | head -c 40000000
    exit 0
    ;;
  slow)
    SLEEP_PID=""
    trap 'if [ -n "$SLEEP_PID" ]; then kill $SLEEP_PID 2>/dev/null; fi; touch "$dump/killed"; exit 0' TERM
    sleep 30 & SLEEP_PID=$!
    wait $SLEEP_PID
    ;;
  noisy-orphan)
    trap '' TERM
    (while true; do date +%s%N >> "$dump/heartbeat"; sleep 0.2; done) &
    sleep 30 &
    wait
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
    expect(await readDump('argv')).toBe(['-p', '--verbose', '--output-format', 'stream-json',
      '--model', 'claude-opus-5-5', '--effort', 'medium',
      '--tools', '', '--strict-mcp-config', '--no-session-persistence'].join('\n') + '\n');
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
    expect(await readDump('argv')).toBe(['-p', '--verbose', '--output-format', 'stream-json',
      '--model', 'claude-opus-5-5', '--effort', 'medium',
      '--tools', '', '--strict-mcp-config', '--no-session-persistence',
      '--system-prompt-file', '/tmp/fake-system.md'].join('\n') + '\n');
    const env = await readDump('env');
    expect(env).toContain(`oauth_value=${TOKEN}`);
    expect(env).toContain('anthropic_key=absent');
    const argv = await readDump('argv');
    expect(argv).not.toContain(TOKEN);
    expect(argv).not.toContain(OTHER_TOKEN);
  });

  it('should pass only an allowlist env with the seat token to the child', async () => {
    process.env.ANTHROPIC_API_KEY = OTHER_TOKEN;
    process.env.ANTHROPIC_AUTH_TOKEN = 'parent-auth-canary';
    process.env.ANTHROPIC_BASE_URL = 'https://parent.example.invalid';
    process.env.AWS_SECRET_ACCESS_KEY = 'parent-aws-canary';
    process.env.GOOGLE_API_KEY = 'parent-google-canary';
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'parent-oauth-canary';
    const runner = new NodeClaudeCodeCliRunner();
    await collect(runner.run({ access, request: request(), signal: never }));
    await waitFor('env');
    const env = await readDump('env');
    expect(env).toContain(`oauth_value=${TOKEN}`);
    expect(env).toContain('path_set=yes');
    expect(env).not.toContain('parent');
    expect(env).not.toContain(OTHER_TOKEN);
    expect(env).not.toMatch(/^leak_/m);
  });

  it('should run the CLI inside an isolated sandbox cwd', async () => {
    const runner = new NodeClaudeCodeCliRunner();
    await collect(runner.run({ access, request: request(), signal: never }));
    await waitFor('cwd');
    const env = await readDump('env');
    const home = /home=(.*)/.exec(env)?.[1];
    const config = /config=(.*)/.exec(env)?.[1];
    expect(home).toBeDefined();
    expect(config).toBe(home);
    expect(await readDump('cwd')).toBe(`${home}\n`);
    expect(home).toContain('claude-seat-');
    expect(home).not.toBe(process.cwd());
  });

  it('should refuse an already-aborted signal without spawning', async () => {
    const runner = new NodeClaudeCodeCliRunner();
    const controller = new AbortController();
    controller.abort();
    await expect(collect(runner.run({ access, request: request(), signal: controller.signal })))
      .rejects.toMatchObject({ name: 'AbortError' });
    await expect(readDump('argv')).rejects.toThrow();
  });

  it.each(['init-tools', 'init-mcp'])('should fail closed on a non-empty %s inventory', async (mode) => {
    await setMode(mode);
    const runner = new NodeClaudeCodeCliRunner();
    await expect(collect(runner.run({ access, request: request(), signal: never })))
      .rejects.toMatchObject({ name: 'ClaudeCliRunnerError', message: expect.stringContaining('inventory') });
  });

  it('should accept a final line without a trailing newline', async () => {
    await setMode('noeol');
    const runner = new NodeClaudeCodeCliRunner();
    const events = await collect(runner.run({ access, request: request(), signal: never }));
    expect(events).toEqual([
      { type: 'text_delta', text: 'Héllo wörld' },
      { type: 'result', finishReason: 'stop', usage: { inputTokens: 3, outputTokens: 2 } },
    ]);
  });

  it('should refuse an oversized CLI output line', async () => {
    await setMode('longline');
    const runner = new NodeClaudeCodeCliRunner();
    await expect(collect(runner.run({ access, request: request(), signal: never })))
      .rejects.toMatchObject({ name: 'ClaudeCliRunnerError', message: expect.stringContaining('output line') });
  });

  it('should refuse an oversized whole-run CLI output', async () => {
    await setMode('flood');
    const runner = new NodeClaudeCodeCliRunner();
    const error = await collect(runner.run({ access, request: request(), signal: never })).then(
      () => { throw new Error('should have thrown'); },
      (cause: unknown) => cause,
    );
    expect(error).toMatchObject({ name: 'ClaudeCliRunnerError', message: expect.stringContaining('oversized') });
    expect((error as Error).message).not.toContain('output line');
  });

  it('should normalize assistant tool blocks and terminal usage', async () => {
    await setMode('tool');
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

  it('should reap a SIGTERM-ignoring tree on timeout', async () => {
    await setMode('noisy-orphan');
    const runner = new NodeClaudeCodeCliRunner({ timeoutMs: 500 });
    await expect(collect(runner.run({ access, request: request(), signal: never })))
      .rejects.toMatchObject({ name: 'ClaudeCliRunnerError', message: expect.stringContaining('timed out') });
    await waitFor('heartbeat');
    const countBeats = async (): Promise<number> =>
      (await readDump('heartbeat')).split('\n').filter((line) => line.length > 0).length;
    const before = await countBeats();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(await countBeats()).toBe(before);
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

  it('should not mistake usage counters for quota signals', async () => {
    await setMode('numeric-429');
    const runner = new NodeClaudeCodeCliRunner();
    const error = await collect(runner.run({ access, request: request(), signal: never })).then(
      () => { throw new Error('should have thrown'); },
      (cause: unknown) => cause,
    );
    expect(error).not.toBeInstanceOf(ClaudeCliQuotaError);
    expect(error).toMatchObject({ name: 'ClaudeCliRunnerError' });
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

  it('should reject a CLI older than the qualified line', async () => {
    await setMode('old-version');
    await expect(probeClaudeCodeCliCapabilities({
      source: 'fake-source', qualificationRef: 'fake-receipt',
    })).rejects.toMatchObject({ name: 'ClaudeCliRunnerError', message: expect.stringContaining('2.1') });
  });

  it('should reject a CLI missing confinement flags', async () => {
    await setMode('help-stripped');
    await expect(probeClaudeCodeCliCapabilities({
      source: 'fake-source', qualificationRef: 'fake-receipt',
    })).rejects.toMatchObject({ name: 'ClaudeCliRunnerError', message: expect.stringContaining('confinement') });
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
