//
// Shared fail-closed write primitives for the seat materialization stages.
// Internal module: not exported from the package entry points.

import { chmod, lstat, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { SeatValidationCode } from '../enrollment/seat-bundle.js';
import { SeatOnboardingError, type SeatOnboardingCode } from '../enrollment/seat-onboarding.js';

export const SEAT_RECORD_REL_PATH = join('.sentropic-seat', 'seat-record.v1.json');

export const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export type StageCode = SeatOnboardingCode | SeatValidationCode;

class StageRefusal extends Error {
  readonly code: StageCode;
  constructor(code: StageCode, detail: string) {
    super(detail);
    this.name = 'StageRefusal';
    this.code = code;
  }
}

export function fail(code: StageCode, detail: string): never {
  throw new StageRefusal(code, detail);
}

export const asResult = (error: unknown): { ok: false; code: StageCode; detail: string } => {
  if (error instanceof StageRefusal) return { ok: false, code: error.code, detail: error.message };
  if (error instanceof SeatOnboardingError) return { ok: false, code: error.code, detail: error.message };
  throw error;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export const decodeBase64 = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'base64'));

export const withinRoot = (root: string, path: string): boolean => {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

/** Walk every existing ancestor of `path` and refuse any symlink in the chain. */
export async function assertCleanAncestors(path: string): Promise<void> {
  let current = resolve(path);
  for (;;) {
    let st;
    try {
      st = await lstat(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) return;
      current = parent;
      continue;
    }
    if (st.isSymbolicLink()) fail('onboarding-shape-unverified', `symlinked ancestor: ${current}`);
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

/**
 * Single-writer exclusive write: the resolved path must stay inside one of
 * `roots`, no component of the chain may be a symlink, the target must not
 * pre-exist, parents are created 0700 and the file 0600 with `wx`.
 */
export async function writeExclusive(roots: readonly string[], absPath: string, bytes: Uint8Array): Promise<void> {
  const resolved = resolve(absPath);
  const root = roots.find((r) => withinRoot(r, resolved));
  if (!root) fail('onboarding-shape-unverified', `path escapes the stage root: ${absPath}`);
  const rel = relative(resolve(root), resolved);
  const parts = rel.split(sep);
  let current = resolve(root);
  for (let i = 0; i < parts.length; i += 1) {
    current = join(current, parts[i]);
    let st;
    try {
      st = await lstat(current);
    } catch {
      break; // this component and everything below it do not exist yet
    }
    if (st.isSymbolicLink()) fail('onboarding-shape-unverified', `symlink in path: ${current}`);
    if (i === parts.length - 1) fail('onboarding-shape-unverified', `pre-existing target: ${current}`);
    if (!st.isDirectory()) fail('onboarding-shape-unverified', `non-directory in path: ${current}`);
  }
  await mkdir(dirname(resolved), { recursive: true, mode: DIR_MODE });
  await writeFile(resolved, bytes, { flag: 'wx', mode: FILE_MODE });
  await chmod(resolved, FILE_MODE);
}

