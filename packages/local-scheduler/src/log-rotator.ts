import { closeSync, constants, openSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';
import { ensurePrivateDir } from './state-dir.js';

export const RUNS_LOG_MAX_BYTES = 5 * 1024 * 1024;
export const RUNS_LOG_MAX_FILES = 5;
export const RUNS_LOG_EXCERPT_BYTES = 64 * 1024;
export const SKIPS_LOG_MAX_BYTES = 256 * 1024;
export const SKIPS_LOG_MAX_FILES = 2;

const DISALLOWED_LOG_CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;

/** Strips control chars (preserving tab/newline) and truncates safely on a UTF-8 boundary. */
export function truncateLogExcerpt(raw: string, maxBytes: number = RUNS_LOG_EXCERPT_BYTES): string {
  const cleaned = raw.replace(DISALLOWED_LOG_CONTROL, '');
  const buf = Buffer.from(cleaned, 'utf8');
  if (buf.length <= maxBytes) return cleaned;
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  return buf.subarray(0, end).toString('utf8');
}

export function rotateLogFile(filePath: string, maxBytes: number, maxFiles: number): void {
  let size = 0;
  try {
    size = statSync(filePath).size;
  } catch {
    return;
  }
  if (size < maxBytes || maxFiles < 2) return;
  const oldest = `${filePath}.${maxFiles - 1}`;
  try { unlinkSync(oldest); } catch { /* absent */ }
  for (let i = maxFiles - 2; i >= 1; i -= 1) {
    const src = `${filePath}.${i}`;
    const dst = `${filePath}.${i + 1}`;
    try { renameSync(src, dst); } catch { /* absent */ }
  }
  try { renameSync(filePath, `${filePath}.1`); } catch { /* absent */ }
}

export function appendRunLog(
  stateDir: string,
  taskId: string,
  header: Record<string, unknown>,
  outputExcerpt: string,
): string {
  const taskDir = path.join(stateDir, 'tasks', taskId);
  ensurePrivateDir(taskDir);
  const logPath = path.join(taskDir, 'runs.log');
  const excerpt = truncateLogExcerpt(outputExcerpt);
  const block = excerpt.length > 0 ? `${JSON.stringify(header)}\n${excerpt}\n` : `${JSON.stringify(header)}\n`;
  const fd = openSync(logPath, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND, 0o600);
  try {
    writeSync(fd, block);
  } finally {
    closeSync(fd);
  }
  rotateLogFile(logPath, RUNS_LOG_MAX_BYTES, RUNS_LOG_MAX_FILES);
  return logPath;
}

export function rotateSkipsLog(stateDir: string, taskId: string): void {
  const skipsPath = path.join(stateDir, 'tasks', taskId, 'skips.jsonl');
  rotateLogFile(skipsPath, SKIPS_LOG_MAX_BYTES, SKIPS_LOG_MAX_FILES);
}
