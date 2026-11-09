// @sentropic/llm-mesh/node/claude-code-cli-runner.ts
//
// Concrete Node host for the Claude Code runtime client. Spawns the `claude`
// CLI headless (`-p --verbose --output-format stream-json --model --effort`,
// optional `--system-prompt-file`, plus confinement flags), feeds the
// projected prompt over stdin, and normalizes stream-json output to
// ClaudeCodeCliEvent.
//
// Secret boundary: the seat OAuth access projection travels as
// CLAUDE_CODE_OAUTH_TOKEN in the CHILD env only. It never appears on argv,
// in logs, or in thrown messages. The child env is an allowlist (PATH and a
// few locale/timezone knobs copied from the parent); every known
// authentication, endpoint, and cloud carrier is purged before the seat token
// is injected, so the CLI cannot prefer ambient key auth over the seat grant
// and ambient secrets never reach the CLI or its hook/MCP descendants.
// Confinement: the CLI runs with `--tools ""`, `--strict-mcp-config` (no
// MCP config, so no MCP servers), `--safe-mode` (no hooks, skills, plugins,
// or ambient settings), and `--no-session-persistence`, inside a fresh
// sandbox directory used as cwd, HOME, and CLAUDE_CONFIG_DIR. A non-empty
// tool/MCP inventory in the CLI `init` line fails the run closed.
// Quota signals (5-hour session limit, rate limits, overload) surface as
// ClaudeCliQuotaError; every other host failure is a fixed-message runner
// error with no CLI output attached.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { AnthropicAdapterClient } from '../adapters.js';
import {
  ClaudeCliQuotaError,
  ClaudeCodeRuntimeClient,
  type ClaudeCodeAccessProjection,
  type ClaudeCodeCliCapabilities,
  type ClaudeCodeCliEvent,
  type ClaudeCodeCliRequest,
  type ClaudeCodeCliRunner,
} from '../transport/claude-code-runtime-client.js';
import type { ClaudeCodeLineOutcome } from './claude-code-cli-wire.js';
import { appendCappedTail, diagnoseClaudeCodeQuota, extractQuotaText, parseClaudeCodeLine, renderClaudeCodeCliPrompt } from './claude-code-cli-wire.js';

export const CLAUDE_CODE_OAUTH_ENV_VAR = 'CLAUDE_CODE_OAUTH_TOKEN';
export const CLAUDE_CODE_STREAM_PROTOCOL = 'claude-code-stream-json-v1';
export const DEFAULT_CLAUDE_CODE_CLI_PATH = 'claude';
export const DEFAULT_CLAUDE_CODE_EFFORT = 'medium';
export const DEFAULT_CLAUDE_CODE_TIMEOUT_MS = 300_000;
export const CLAUDE_CODE_RESULT_TIMEOUT_MS = 15_000;
/** SIGTERM grace before the group SIGKILL escalation. */
const KILL_GRACE_MS = 2_000;
/** One NDJSON line past this fails the run instead of growing the buffer. */
const MAX_STDOUT_LINE_CHARS = 1_048_576;
/** Whole-run stdout past this fails the run instead of growing memory. */
const MAX_STDOUT_TOTAL_BYTES = 33_554_432;
/** Probe output past this fails the probe instead of growing memory. */
const MAX_PROBE_OUTPUT_BYTES = 65_536;
/** Oldest qualified CLI line: every confinement flag below was verified on 2.1.x. */
const MIN_CLAUDE_CODE_MAJOR = 2;
const MIN_CLAUDE_CODE_MINOR = 1;
const REQUIRED_CLAUDE_CODE_FLAGS = [
  '--verbose',
  '--output-format',
  '--model',
  '--effort',
  '--system-prompt-file',
  '--tools',
  '--strict-mcp-config',
  '--no-session-persistence',
] as const;
const STDERR_TAIL_BYTES = 8_192;

export interface NodeClaudeCodeCliRunnerOptions {
  readonly cliPath?: string;
  readonly effort?: string;
  readonly systemPromptFile?: string;
  readonly timeoutMs?: number;
  readonly collectStderrBytes?: number;
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 4096
  && !/[\0-\x1f\x7f]/.test(value);

const validEffort = (value: string): boolean => /^[A-Za-z0-9-]{1,16}$/.test(value);

const validModelId = (value: string): boolean =>
  /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value) && value.length <= 256;

/**
 * Parent env names copied into the CLI child. Everything else — ambient
 * secrets, auth carriers, endpoints, cloud credentials — never crosses.
 */
const CHILD_ENV_COPY = ['PATH', 'LANG', 'LC_ALL', 'TZ', 'NO_COLOR'] as const;

/**
 * Auth/endpoint/cloud carriers purged from the child env before the seat
 * token is injected. The allowlist above already excludes them; this is
 * belt-and-suspenders in case the allowlist ever grows.
 */
const PURGED_ENV_PREFIXES = [
  'ANTHROPIC_',
  'CLAUDE_CODE_',
  'AWS_',
  'GOOGLE_',
  'GEMINI_',
  'AZURE_',
  'VERTEX_',
  'BEDROCK_',
] as const;

/**
 * Minimal child env: allowlist copy, purge, then the sandbox dirs and — when
 * a seat projection is supplied — the seat token. The probe passes no token
 * and never runs a workload.
 */
const buildChildEnv = (
  sandboxDir: string,
  accessToken?: string,
): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = {};
  for (const name of CHILD_ENV_COPY) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  if (process.platform === 'win32') {
    const systemRoot = process.env['SystemRoot'];
    if (systemRoot !== undefined) env['SystemRoot'] = systemRoot;
  }
  for (const name of Object.keys(env)) {
    if (PURGED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))) delete env[name];
  }
  if (accessToken !== undefined) env[CLAUDE_CODE_OAUTH_ENV_VAR] = accessToken;
  env['CLAUDE_CONFIG_DIR'] = sandboxDir;
  env['HOME'] = sandboxDir;
  env['TMPDIR'] = sandboxDir;
  env['TMP'] = sandboxDir;
  env['TEMP'] = sandboxDir;
  env['XDG_CONFIG_HOME'] = sandboxDir;
  env['XDG_CACHE_HOME'] = sandboxDir;
  env['XDG_DATA_HOME'] = sandboxDir;
  env['XDG_STATE_HOME'] = sandboxDir;
  return env;
};

const abortedError = (): Error => {
  const error = new Error('claude CLI runner aborted');
  error.name = 'AbortError';
  return error;
};

const runnerError = (message: string): Error => {
  const error = new Error(message);
  error.name = 'ClaudeCliRunnerError';
  return error;
};

/**
 * Signal the whole process group on POSIX (the child is spawned detached, so
 * its pid is the group id) and the direct child on win32. Skipped only when
 * our own stdio pipes are already closed — while they are open the group is
 * necessarily alive, so there is no pid-reuse race.
 */
const killTree = (
  child: ChildProcess | undefined,
  closed: () => boolean,
  signal: 'SIGTERM' | 'SIGKILL',
): void => {
  if (!child || closed()) return;
  try {
    if (child.pid !== undefined && process.platform !== 'win32') process.kill(-child.pid, signal);
    else if (child.exitCode === null) child.kill(signal);
  } catch { /* already gone */ }
};

const destroyPipes = (child: ChildProcess | undefined): void => {
  try { child?.stdin?.destroy(); } catch { /* already gone */ }
  try { child?.stdout?.destroy(); } catch { /* already gone */ }
  try { child?.stderr?.destroy(); } catch { /* already gone */ }
};

const waitForClose = async (
  child: ChildProcess,
  closed: () => boolean,
  timeoutMs: number,
): Promise<boolean> => {
  if (closed()) return true;
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    child.once('close', () => { clearTimeout(timer); resolve(true); });
  });
};

/**
 * Hard teardown: SIGTERM the group, escalate to a group SIGKILL past the
 * grace, destroy our pipe ends so a surviving grandchild holding stdout can
 * neither block nor orphan the run, then await the close.
 */
const shutdown = async (child: ChildProcess | undefined, closed: () => boolean): Promise<void> => {
  if (!child) return;
  killTree(child, closed, 'SIGTERM');
  if (await waitForClose(child, closed, KILL_GRACE_MS)) return;
  killTree(child, closed, 'SIGKILL');
  destroyPipes(child);
  await waitForClose(child, closed, CLAUDE_CODE_RESULT_TIMEOUT_MS);
};

export class NodeClaudeCodeCliRunner implements ClaudeCodeCliRunner {
  private readonly cliPath: string;
  private readonly effort: string;
  private readonly systemPromptFile?: string;
  private readonly timeoutMs: number;
  private readonly stderrTailBytes: number;

  constructor(options: NodeClaudeCodeCliRunnerOptions = {}) {
    if (options.cliPath !== undefined && !nonEmpty(options.cliPath)) {
      throw new Error('claude CLI path must be a non-empty string');
    }
    if (options.effort !== undefined && !validEffort(options.effort)) {
      throw new Error('claude CLI effort must match [A-Za-z0-9-]{1,16}');
    }
    if (options.systemPromptFile !== undefined && !nonEmpty(options.systemPromptFile)) {
      throw new Error('claude CLI system prompt file must be a non-empty string');
    }
    if (options.timeoutMs !== undefined
      && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
      throw new Error('claude CLI timeout must be a positive number of milliseconds');
    }
    if (options.collectStderrBytes !== undefined
      && (!Number.isSafeInteger(options.collectStderrBytes) || options.collectStderrBytes < 0)) {
      throw new Error('claude CLI stderr cap must be a non-negative safe integer');
    }
    this.cliPath = options.cliPath ?? DEFAULT_CLAUDE_CODE_CLI_PATH;
    this.effort = options.effort ?? DEFAULT_CLAUDE_CODE_EFFORT;
    this.systemPromptFile = options.systemPromptFile;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_CLAUDE_CODE_TIMEOUT_MS;
    this.stderrTailBytes = options.collectStderrBytes ?? STDERR_TAIL_BYTES;
  }

  run(input: {
    access: ClaudeCodeAccessProjection; request: ClaudeCodeCliRequest; signal: AbortSignal;
  }): AsyncIterable<ClaudeCodeCliEvent> {
    return {
      [Symbol.asyncIterator]: () => this.execute(input.access, input.request, input.signal),
    };
  }

  private async *execute(
    access: ClaudeCodeAccessProjection,
    request: ClaudeCodeCliRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ClaudeCodeCliEvent> {
    if (!nonEmpty(access.accessToken) || /[\r\n]/.test(access.accessToken)) {
      throw runnerError('claude CLI runner refused an invalid access projection');
    }
    if (!validModelId(request.modelId)) throw runnerError('claude CLI runner refused an invalid model id');
    // No token-bearing process exists before this point: abort and prompt
    // rendering both precede the spawn.
    if (signal.aborted) throw abortedError();
    const prompt = renderClaudeCodeCliPrompt(request);
    if (signal.aborted) throw abortedError();
    const sandboxDir = await mkdtemp(join(tmpdir(), 'claude-seat-')).catch(() => {
      throw runnerError('claude CLI runner failed to isolate the CLI workspace');
    });
    let child: ChildProcess | undefined;
    let closed = false;
    const isClosed = (): boolean => closed;
    try {
      // --verbose is required with -p --output-format stream-json on the 2.1
      // line; --tools "" disables every built-in (local) tool; with
      // --strict-mcp-config and no --mcp-config no MCP server can load;
      // --no-session-persistence keeps the seat run off disk.
      const args = ['-p', '--verbose', '--output-format', 'stream-json',
        '--model', request.modelId, '--effort', this.effort,
        '--tools', '', '--strict-mcp-config', '--no-session-persistence',
        ...(this.systemPromptFile ? ['--system-prompt-file', this.systemPromptFile] : [])];
      const env = buildChildEnv(sandboxDir, access.accessToken);
      try {
        child = spawn(this.cliPath, args,
          { env: env as Record<string, string>, stdio: ['pipe', 'pipe', 'pipe'],
            cwd: sandboxDir, detached: process.platform !== 'win32' });
      } catch {
        throw runnerError('claude CLI runner failed to spawn the CLI');
      }
      child.once('close', () => { closed = true; });
      // The internal stop fires on external abort and on timeout; consume
      // observes it so a SIGTERM-ignoring CLI cannot hold the run open.
      const stop = new AbortController();
      const onAbort = (): void => { stop.abort(); void shutdown(child, isClosed); };
      if (signal.aborted) { onAbort(); throw abortedError(); }
      signal.addEventListener('abort', onAbort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      try {
        timer = setTimeout(() => {
          timedOut = true;
          stop.abort();
          void shutdown(child, isClosed);
        }, this.timeoutMs);
        (timer as unknown as { unref?: () => void }).unref?.();
        yield* this.consume(child, prompt, stop.signal);
        if (stop.signal.aborted) {
          if (signal.aborted) throw abortedError();
          if (timedOut) throw runnerError('claude CLI runner timed out waiting for the CLI result');
          throw runnerError('claude CLI runner stopped before the CLI result');
        }
        if (timedOut) throw runnerError('claude CLI runner timed out waiting for the CLI result');
      } catch (error) {
        if (signal.aborted) throw abortedError();
        if (timedOut) throw runnerError('claude CLI runner timed out waiting for the CLI result');
        if (error instanceof ClaudeCliQuotaError) throw error;
        if (error instanceof Error && error.name === 'ClaudeCliRunnerError') throw error;
        throw runnerError('claude CLI runner failed while reading CLI output');
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        await shutdown(child, isClosed);
      }
    } finally {
      await rm(sandboxDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async *consume(
    child: ChildProcess,
    prompt: string,
    stop: AbortSignal,
  ): AsyncGenerator<ClaudeCodeCliEvent> {
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout || !stderr) throw runnerError('claude CLI runner lost the CLI pipes');
    // Byte-capped tail: the pipe is always drained, but at most
    // collectStderrBytes are retained (0 keeps nothing).
    let stderrTail = Buffer.from('');
    stderr.on('data', (chunk: Buffer) => {
      stderrTail = appendCappedTail(stderrTail, chunk, this.stderrTailBytes);
    });
    const failures: unknown[] = [];
    child.once('error', (error: unknown) => { failures.push(error); });
    const stdinError = new Promise<void>((resolve) => {
      child.stdin?.once('error', () => resolve());
      child.stdin?.once('close', () => resolve());
    });
    const writePrompt = (async () => {
      try {
        if (!child.stdin) return;
        await new Promise<void>((resolve, reject) => {
          child.stdin!.write(prompt, (error) => { if (error) reject(error); else resolve(); });
          child.stdin!.end();
        });
      } catch { /* the exit path below reports the failure */ }
    })();
    void stdinError;
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let totalBytes = 0;
    let toolCalls = 0;
    let textEmitted = false;
    let lastStopReason: unknown;
    let sawInit = false;
    let toolsInventory: unknown;
    let mcpInventory: unknown;
    let result: { finishReason: 'stop' | 'length' | 'tool_calls';
      usage?: { inputTokens?: number; outputTokens?: number }; resultText?: string } | undefined;
    let errorPayload: unknown;
    const applyOutcome = (outcome: ClaudeCodeLineOutcome): ClaudeCodeCliEvent[] => {
      if (outcome.type === 'system_init') {
        sawInit = true;
        toolsInventory = outcome.init.tools;
        mcpInventory = outcome.init.mcpServers;
        return [];
      }
      if (outcome.type === 'text') { textEmitted = true; return [{ type: 'text_delta', text: outcome.text }]; }
      // Local tools are disabled at the CLI, so a tool_use block can only
      // describe a server-side execution. It is republished verbatim; the
      // non-empty init inventory above is the fail-closed enforcement point.
      if (outcome.type === 'tool_use') { toolCalls += 1; return [outcome.event]; }
      if (outcome.type === 'stop_reason') { lastStopReason = outcome.reason; return []; }
      if (outcome.type === 'result') { result = outcome.result; return []; }
      errorPayload = (outcome as { payload: unknown }).payload;
      return [];
    };
    const exitCode = new Promise<number | null>((resolve) => {
      child.once('exit', (code) => resolve(code));
      child.once('error', () => resolve(null));
    });
    try {
      for await (const chunk of stdout) {
        if (stop.aborted) return;
        totalBytes += chunk.length;
        if (totalBytes > MAX_STDOUT_TOTAL_BYTES) {
          throw runnerError('claude CLI runner refused an oversized CLI output');
        }
        buffer += decoder.write(chunk);
        if (buffer.length > MAX_STDOUT_LINE_CHARS) {
          throw runnerError('claude CLI runner refused an oversized CLI output line');
        }
        let boundary = buffer.indexOf('\n');
        while (boundary >= 0) {
          const line = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + 1);
          boundary = buffer.indexOf('\n');
          if (!line) continue;
          for (const outcome of parseClaudeCodeLine(line)) {
            const events = applyOutcome(outcome);
            for (const event of events) yield event;
          }
        }
      }
      // A final line without a trailing newline is still a line.
      buffer += decoder.end();
      if (buffer.trim().length > 0) {
        for (const outcome of parseClaudeCodeLine(buffer.trim())) {
          const events = applyOutcome(outcome);
          for (const event of events) yield event;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'ClaudeCliRunnerError') throw error;
      throw runnerError('claude CLI runner failed while reading CLI output');
    }
    await writePrompt;
    const code = await exitCode;
    if (sawInit
      && ((Array.isArray(toolsInventory) && toolsInventory.length > 0)
        || (Array.isArray(mcpInventory) && mcpInventory.length > 0))) {
      throw runnerError('claude CLI runner refused a non-empty CLI tool inventory');
    }
    if (errorPayload !== undefined || result === undefined) {
      const structuredText = errorPayload === undefined ? undefined : extractQuotaText(errorPayload);
      const structured = structuredText === undefined
        ? { quota: false as const }
        : diagnoseClaudeCodeQuota(structuredText);
      const diagnosis = structured.quota
        ? structured
        : diagnoseClaudeCodeQuota(stderrTail.toString('utf8'));
      if (diagnosis.quota) throw new ClaudeCliQuotaError(diagnosis.retryAfterMs);
      if (code !== 0) {
        const spawnFailure = failures.length > 0;
        throw runnerError(spawnFailure
          ? 'claude CLI runner failed to run the CLI executable'
          : `claude CLI runner exited with code ${String(code)}`);
      }
      throw runnerError('claude CLI runner ended without a CLI result');
    }
    const finishReason = toolCalls > 0 ? 'tool_calls'
      : lastStopReason === 'max_tokens' ? 'length' : result.finishReason;
    if (result.resultText !== undefined && !textEmitted && result.resultText.trim().length > 0) {
      yield { type: 'text_delta', text: result.resultText };
    }
    yield result.usage !== undefined
      ? { type: 'result', finishReason, usage: result.usage }
      : { type: 'result', finishReason };
  }

}

export interface ClaudeSeatAnthropicClientOptions {
  readonly capabilities: ClaudeCodeCliCapabilities;
  readonly cliPath?: string;
  readonly effort?: string;
  readonly systemPromptFile?: string;
  readonly timeoutMs?: number;
  readonly fallback?: AnthropicAdapterClient;
  readonly now?: () => number;
}

/** Host capability attestation for a locally qualified `claude` CLI. */
export interface ClaudeCodeCliProbeOptions {
  readonly cliPath?: string;
  readonly source: string;
  readonly qualificationRef: string;
  readonly timeoutMs?: number;
}

/**
 * Run one probe command with a token-free allowlist env inside the sandbox;
 * never runs a workload. Output is byte-capped; stderr is drained.
 */
const runProbeCommand = (
  cliPath: string,
  args: readonly string[],
  env: Record<string, string | undefined>,
  sandboxDir: string,
  timeoutMs: number,
): Promise<string> => new Promise((resolve, reject) => {
  let child: ChildProcess;
  try {
    child = spawn(cliPath, args,
      { env: env as Record<string, string>, stdio: ['ignore', 'pipe', 'pipe'], cwd: sandboxDir });
  } catch {
    reject(runnerError('claude CLI probe failed to spawn the CLI'));
    return;
  }
  let closed = false;
  child.once('close', () => { closed = true; });
  const isClosed = (): boolean => closed;
  const decoder = new StringDecoder('utf8');
  let received = 0;
  let output = Buffer.from('');
  child.stdout?.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (received <= MAX_PROBE_OUTPUT_BYTES) output = Buffer.concat([output, chunk]);
  });
  child.stderr?.on('data', () => { /* drained, never retained */ });
  const timer = setTimeout(() => {
    killTree(child, isClosed, 'SIGKILL');
    destroyPipes(child);
    reject(runnerError('claude CLI probe timed out'));
  }, timeoutMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  child.once('error', () => {
    clearTimeout(timer);
    reject(runnerError('claude CLI probe failed to run the CLI'));
  });
  child.once('exit', (code) => {
    clearTimeout(timer);
    if (code !== 0) {
      reject(runnerError('claude CLI probe could not read the CLI'));
      return;
    }
    if (received > MAX_PROBE_OUTPUT_BYTES) {
      reject(runnerError('claude CLI probe refused an oversized CLI output'));
      return;
    }
    resolve(output.toString('utf8') + decoder.end());
  });
});

/** Probe `claude --version` and `claude --help` with a token-free env; never runs a workload. */
export const probeClaudeCodeCliCapabilities = (
  options: ClaudeCodeCliProbeOptions,
): Promise<ClaudeCodeCliCapabilities> => {
  if (!nonEmpty(options.source)) throw new Error('claude CLI probe needs a trusted source label');
  if (!nonEmpty(options.qualificationRef)) throw new Error('claude CLI probe needs a qualification reference');
  const cliPath = options.cliPath ?? DEFAULT_CLAUDE_CODE_CLI_PATH;
  const timeoutMs = options.timeoutMs ?? CLAUDE_CODE_RESULT_TIMEOUT_MS;
  return (async (): Promise<ClaudeCodeCliCapabilities> => {
    const sandboxDir = await mkdtemp(join(tmpdir(), 'claude-seat-probe-')).catch(() => {
      throw runnerError('claude CLI probe failed to isolate the CLI workspace');
    });
    try {
      const env = buildChildEnv(sandboxDir);
      const version = await runProbeCommand(cliPath, ['--version'], env, sandboxDir, timeoutMs);
      const match = /(\d+)\.(\d+)\.(\d+)/.exec(version);
      const major = match === null ? NaN : Number(match[1]);
      const minor = match === null ? NaN : Number(match[2]);
      if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor)
        || major < MIN_CLAUDE_CODE_MAJOR || (major === MIN_CLAUDE_CODE_MAJOR && minor < MIN_CLAUDE_CODE_MINOR)) {
        throw runnerError('claude CLI probe requires claude 2.1 or newer');
      }
      const help = await runProbeCommand(cliPath, ['--help'], env, sandboxDir, timeoutMs);
      const missing = REQUIRED_CLAUDE_CODE_FLAGS.filter((flag) => !help.includes(flag));
      if (missing.length > 0) throw runnerError('claude CLI probe found a CLI missing confinement flags');
      return { protocol: CLAUDE_CODE_STREAM_PROTOCOL, cliVersion: `${major}.${minor}.${Number(match![3])}`,
        source: options.source, qualificationRef: options.qualificationRef };
    } finally {
      await rm(sandboxDir, { recursive: true, force: true }).catch(() => undefined);
    }
  })();
};

/**
 * Factory for the consumer: builds the `clients.anthropic` runtime client
 * over a dedicated Claude seat. Wire with
 * `createDefaultProviderAdapters({ anthropic })`.
 */
export const createClaudeSeatAnthropicClient = (
  options: ClaudeSeatAnthropicClientOptions,
): ClaudeCodeRuntimeClient => {
  const runner = new NodeClaudeCodeCliRunner({
    ...(options.cliPath !== undefined ? { cliPath: options.cliPath } : {}),
    ...(options.effort !== undefined ? { effort: options.effort } : {}),
    ...(options.systemPromptFile !== undefined ? { systemPromptFile: options.systemPromptFile } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
  return new ClaudeCodeRuntimeClient({
    runner,
    capabilities: { ...options.capabilities },
    ...(options.fallback !== undefined ? { fallback: options.fallback } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
};

export type {
  ClaudeCodeAccessProjection,
  ClaudeCodeCliCapabilities,
  ClaudeCodeCliContent,
  ClaudeCodeCliEvent,
  ClaudeCodeCliRequest,
  ClaudeCodeCliRunner,
} from '../transport/claude-code-runtime-client.js';
