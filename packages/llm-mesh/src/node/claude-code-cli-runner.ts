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

const kill = (child: ChildProcess | undefined): void => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
};

const awaitExit = async (child: ChildProcess, timeoutMs: number): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } resolve(); }, timeoutMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
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
    const args = ['-p', '--output-format', 'stream-json',
      '--model', request.modelId, '--effort', this.effort,
      ...(this.systemPromptFile ? ['--system-prompt-file', this.systemPromptFile] : [])];
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    env[CLAUDE_CODE_OAUTH_ENV_VAR] = access.accessToken;
    let child: ChildProcess | undefined;
    try {
      child = spawn(this.cliPath, args, { env: env as Record<string, string>, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      throw runnerError('claude CLI runner failed to spawn the CLI');
    }
    const abort = () => { kill(child); };
    if (signal.aborted) { kill(child); await awaitExit(child, CLAUDE_CODE_RESULT_TIMEOUT_MS); throw abortedError(); }
    signal.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      timer = setTimeout(() => { timedOut = true; kill(child); }, this.timeoutMs);
      (timer as unknown as { unref?: () => void }).unref?.();
      const prompt = renderClaudeCodeCliPrompt(request);
      yield* this.consume(child, prompt, signal);
      if (signal.aborted) throw abortedError();
      if (timedOut) throw runnerError('claude CLI runner timed out waiting for the CLI result');
    } catch (error) {
      if (signal.aborted) throw abortedError();
      if (timedOut) throw runnerError('claude CLI runner timed out waiting for the CLI result');
      if (error instanceof ClaudeCliQuotaError) throw error;
      if (error instanceof Error && error.name === 'ClaudeCliRunnerError') throw error;
      throw runnerError('claude CLI runner failed while reading CLI output');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      kill(child);
      if (child) await awaitExit(child, CLAUDE_CODE_RESULT_TIMEOUT_MS);
    }
  }

  private async *consume(
    child: ChildProcess,
    prompt: string,
    signal: AbortSignal,
  ): AsyncGenerator<ClaudeCodeCliEvent> {
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout || !stderr) throw runnerError('claude CLI runner lost the CLI pipes');
    let stderrTail = '';
    stderr.on('data', (chunk: Buffer) => {
      stderrTail += chunk.toString('utf8');
      if (stderrTail.length > this.stderrTailBytes) stderrTail = stderrTail.slice(-this.stderrTailBytes);
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
    let buffer = '';
    let toolCalls = 0;
    let textEmitted = false;
    let lastStopReason: unknown;
    let result: { finishReason: 'stop' | 'length' | 'tool_calls';
      usage?: { inputTokens?: number; outputTokens?: number }; resultText?: string } | undefined;
    let errorPayload: unknown;
    const exitCode = new Promise<number | null>((resolve) => {
      child.once('exit', (code) => resolve(code));
      child.once('error', () => resolve(null));
    });
    try {
      for await (const chunk of stdout) {
        if (signal.aborted) return;
        buffer += chunk.toString('utf8');
        let boundary = buffer.indexOf('\n');
        while (boundary >= 0) {
          const line = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + 1);
          boundary = buffer.indexOf('\n');
          if (!line) continue;
          for (const outcome of parseClaudeCodeLine(line)) {
            if (outcome.type === 'text') { textEmitted = true; yield { type: 'text_delta', text: outcome.text }; }
            else if (outcome.type === 'tool_use') { toolCalls += 1; yield outcome.event; }
            else if (outcome.type === 'stop_reason') lastStopReason = outcome.reason;
            else if (outcome.type === 'result') result = outcome.result;
            else if (outcome.type === 'error_payload') errorPayload = outcome.payload;
          }
        }
      }
    } catch {
      throw runnerError('claude CLI runner failed while reading CLI output');
    }
    await writePrompt;
    const code = await exitCode;
    if (errorPayload !== undefined || result === undefined) {
      const diagnosis = diagnoseClaudeCodeQuota(`${JSON.stringify(errorPayload)} ${stderrTail}`);
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

/** Probe `claude --version` with a token-free env; never runs a workload. */
export const probeClaudeCodeCliCapabilities = (
  options: ClaudeCodeCliProbeOptions,
): Promise<ClaudeCodeCliCapabilities> => {
  if (!nonEmpty(options.source)) throw new Error('claude CLI probe needs a trusted source label');
  if (!nonEmpty(options.qualificationRef)) throw new Error('claude CLI probe needs a qualification reference');
  const cliPath = options.cliPath ?? DEFAULT_CLAUDE_CODE_CLI_PATH;
  const timeoutMs = options.timeoutMs ?? CLAUDE_CODE_RESULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env[CLAUDE_CODE_OAUTH_ENV_VAR];
    let child: ChildProcess;
    try {
      child = spawn(cliPath, ['--version'], { env: env as Record<string, string>, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      reject(runnerError('claude CLI probe failed to spawn the CLI'));
      return;
    }
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    const timer = setTimeout(() => { kill(child); reject(runnerError('claude CLI probe timed out')); }, timeoutMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    child.once('error', () => { clearTimeout(timer); reject(runnerError('claude CLI probe failed to run the CLI')); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      const match = /(\d+\.\d+\.\d+[^ \r\n]*)/.exec(output);
      if (code === 0 && match) {
        resolve({ protocol: CLAUDE_CODE_STREAM_PROTOCOL, cliVersion: match[1]!,
          source: options.source, qualificationRef: options.qualificationRef });
      } else {
        reject(runnerError('claude CLI probe could not read the CLI version'));
      }
    });
  });
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
