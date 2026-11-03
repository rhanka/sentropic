//
// Erasure: whole-root wipe of a stage-1 seat directory or a stage-2 cell
// HOME, returning the surviving-path list (empty = proven).

import { lstat, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import type { SeatEraseResult } from './seat-onboarding-types.js';
import { asResult, fail } from './seat-stage-write.js';

// ── erasure ──────────────────────────────────────────────────────────────

/**
 * Whole-root erasure of a stage-1 seat directory or a stage-2 cell HOME.
 * Returns the surviving-path list (empty = proven); never follows a
 * symlinked root.
 */
export async function eraseSeatHome(rootDir: string): Promise<SeatEraseResult> {
  try {
    if (typeof rootDir !== 'string' || rootDir.length === 0) fail('onboarding-schema-mismatch', 'rootDir is required');
    const resolved = resolve(rootDir);
    if (resolved === sep) fail('onboarding-shape-unverified', 'refusing to erase the filesystem root');
    const st = await lstat(resolved).catch(() => null);
    if (st && st.isSymbolicLink()) fail('onboarding-shape-unverified', 'refusing to erase through a symlink');
    await rm(resolved, { recursive: true, force: true });
    const after = await lstat(resolved).catch(() => null);
    return { ok: true, survivingPaths: after ? [resolved] : [] };
  } catch (error) {
    return asResult(error);
  }
}
