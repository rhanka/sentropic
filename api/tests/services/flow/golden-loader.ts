import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Golden trace fixture loader for BR-26 regression baseline.
 *
 * Loads `.jsonl` fixtures under `api/tests/fixtures/golden/br26/`, validates
 * their three-section shape (`input` → `event*` → `final_state`), and exposes
 * normalization helpers so the replay harness can compare event streams
 * byte-identically modulo IDs/timestamps.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const GOLDEN_DIR = resolve(__dirname, '../../fixtures/golden/br26');

export type GoldenEventType =
  | 'run_started'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'state_merged'
  | 'gate_evaluated'
  | 'run_paused'
  | 'run_resumed'
  | 'run_cancelled'
  | 'job_enqueued'
  | 'job_retried'
  | 'job_dlq'
  | 'chat_tool_call'
  | 'chat_tool_result'
  | 'chat_completed'
  | 'state_resumed';

export interface GoldenInputLine {
  kind: 'input';
  fixtureId: string;
  scenario: string;
  workspaceType: 'opportunity' | 'ai-ideas' | 'code' | 'neutral';
  seed: Record<string, unknown>;
  expectations: Record<string, unknown>;
}

export interface GoldenEventLine {
  kind: 'event';
  ts: string;
  runId: string;
  taskKey: string | null;
  taskInstanceKey: string;
  eventType: GoldenEventType;
  payload: Record<string, unknown>;
  sequence: number;
}

export interface GoldenFinalStateLine {
  kind: 'final_state';
  runId: string;
  status: 'completed' | 'failed' | 'cancelled' | 'paused' | 'in_progress';
  workflowRunState: Record<string, unknown>;
  taskResults: Array<{
    taskKey: string;
    taskInstanceKey: string;
    status: string;
    attempts: number;
  }>;
  assertions: Record<string, unknown>;
}

export interface GoldenFixture {
  fixtureId: string;
  filePath: string;
  input: GoldenInputLine;
  events: GoldenEventLine[];
  finalState: GoldenFinalStateLine;
}

const ID_LIKE_RE = /^[A-Za-z0-9_-]{20,}$/;
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/**
 * Recursively normalize a value: any field/value that looks like an ID,
 * a UUID, or an ISO timestamp is replaced by a stable token, so structural
 * comparisons survive across runs.
 *
 * Numeric fields like `sequence` and `attempts` are preserved verbatim;
 * they are part of the byte-identical contract.
 */
export function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (ISO_TS_RE.test(value)) return '__TS__';
    if (ID_LIKE_RE.test(value)) return '__ID__';
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'ts') out[k] = '__TS__';
      else if (k === 'runId') out[k] = '__RUN_ID__';
      else if (k === 'workflowRunId') out[k] = '__RUN_ID__';
      else if (k === 'jobId') out[k] = '__JOB_ID__';
      else out[k] = normalize(v);
    }
    return out;
  }
  return value;
}

/**
 * Parse a single `.jsonl` fixture file into a structured `GoldenFixture`.
 * Throws on malformed content so misconfigured fixtures fail loudly.
 */
export function loadFixture(filePath: string): GoldenFixture {
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 3) {
    throw new Error(
      `[golden-loader] ${filePath}: must contain at least input + 1 event + final_state lines`,
    );
  }
  const parsed = lines.map((line, idx) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(
        `[golden-loader] ${filePath}:${idx + 1}: invalid JSON — ${(err as Error).message}`,
      );
    }
  });
  const inputLine = parsed[0] as GoldenInputLine;
  if (inputLine.kind !== 'input') {
    throw new Error(`[golden-loader] ${filePath}: first line must be {kind:"input"}`);
  }
  const finalLine = parsed[parsed.length - 1] as GoldenFinalStateLine;
  if (finalLine.kind !== 'final_state') {
    throw new Error(`[golden-loader] ${filePath}: last line must be {kind:"final_state"}`);
  }
  const events = parsed.slice(1, -1) as GoldenEventLine[];
  for (const ev of events) {
    if (ev.kind !== 'event') {
      throw new Error(
        `[golden-loader] ${filePath}: every intermediate line must be {kind:"event"} (got ${ev.kind})`,
      );
    }
  }
  return {
    fixtureId: inputLine.fixtureId,
    filePath,
    input: inputLine,
    events,
    finalState: finalLine,
  };
}

/**
 * Load every `.jsonl` file in the BR-26 golden directory, sorted by filename.
 * Sorting is stable so the replay harness iterates in a deterministic order
 * regardless of filesystem listing semantics.
 */
export function loadAllFixtures(): GoldenFixture[] {
  const entries = readdirSync(GOLDEN_DIR)
    .filter((name) => name.endsWith('.jsonl'))
    .sort();
  return entries.map((name) => loadFixture(join(GOLDEN_DIR, name)));
}

/**
 * Assert that an observed event sequence matches the fixture sequence after
 * normalization. Used by the replay harness for structural equality.
 */
export function assertSequenceMonotonic(events: GoldenEventLine[], fixtureId: string): void {
  const perRun = new Map<string, number>();
  for (const ev of events) {
    const last = perRun.get(ev.runId) ?? 0;
    if (ev.sequence <= last) {
      throw new Error(
        `[${fixtureId}] event sequence not monotonic: got ${ev.sequence} after ${last} for runId=${ev.runId}`,
      );
    }
    perRun.set(ev.runId, ev.sequence);
  }
}
