//
// Stage 2 (cell stage): seed one fresh cell HOME from a staged seat record.
// Single writer per owned destination; the seatDir is opened read-only.

import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { SEAT_ENVELOPE_AUTH_FILES } from '../enrollment/seat-onboarding.js';
import { authCellDest, planOnboardingWrites, receiptRelPath } from './seat-onboarding-cell-compose.js';
import { readSeatRecord } from './seat-onboarding-record.js';
import type {
  PlannedWrite,
  SeatCellInput,
  SeatCellResult,
  SeatCellConfigDirs,
} from './seat-onboarding-types.js';
import {
  asResult,
  fail,
  isRecord,
  sha256Hex,
  writeExclusive,
  assertCleanAncestors,
} from './seat-stage-write.js';

/**
 * Stage 2, one seat into one fresh cell HOME. Re-reads and re-validates the
 * seat record (binding + versions), re-derives the launch gate (a stored
 * gate that disagrees is a tampered record), refuses a closed gate with
 * `onboarding-required` before any write, then writes as single writer per
 * owned destination. The seatDir is opened read-only and never mutated.
 */
export async function materialiseCellHome(input: SeatCellInput): Promise<SeatCellResult> {
  try {
    if (!isRecord(input)) fail('schema-mismatch', 'input must be an object');
    for (const key of ['seatDir', 'cellHome', 'workspaceDir', 'expectedNativeCliVersion', 'ownerScope'] as const) {
      if (typeof input[key] !== 'string' || (input[key] as string).length === 0) fail('schema-mismatch', `${key} is required`);
    }
    if (!isRecord(input['configDirs'])) fail('schema-mismatch', 'configDirs is required');
    const seatDir = resolve(input.seatDir);
    const cellHome = resolve(input.cellHome);
    const workspaceDir = resolve(input.workspaceDir);
    const configDirs: SeatCellConfigDirs = {
      claudeConfigDir: resolve((input.configDirs as Record<string, string>)['claudeConfigDir']),
      codexHome: resolve((input.configDirs as Record<string, string>)['codexHome']),
      xdgConfigHome: resolve((input.configDirs as Record<string, string>)['xdgConfigHome']),
    };
    const record = await readSeatRecord({
      seatDir,
      expectedNativeCliVersion: input.expectedNativeCliVersion,
      ownerScope: input.ownerScope,
    });
    const { bundle, onboarding, launchGate } = record;
    const cli = bundle.identity.cli;
    if (!launchGate.eligible) fail('onboarding-required', 'launch gate is closed for this seat');
    const wsSt = await lstat(workspaceDir).catch(() => null);
    if (!wsSt || wsSt.isSymbolicLink() || !wsSt.isDirectory()) {
      fail('onboarding-shape-unverified', 'workspaceDir must be an existing directory');
    }
    if (onboarding && onboarding.cellSynthesis.length > 0) {
      // Q2: the trust write is allowed only for the bench-created empty workspace.
      const entries = await readdir(workspaceDir);
      if (entries.length > 0) {
        fail('onboarding-shape-unverified', 'trust write is limited to the empty bench-created workspace (Q2)');
      }
    }
    const cellSt = await lstat(cellHome).catch(() => null);
    if (cellSt) fail('onboarding-shape-unverified', 'cellHome must be fresh (not pre-existing)');
    for (const dir of Object.values(configDirs)) {
      const st = await lstat(dir).catch(() => null);
      if (st) fail('onboarding-shape-unverified', `configDir must be fresh: ${dir}`);
    }
    const roots = [cellHome, configDirs.claudeConfigDir, configDirs.codexHome, configDirs.xdgConfigHome];
    for (const root of roots) await assertCleanAncestors(root);
    // plan every write before writing any byte
    const writes: PlannedWrite[] = [];
    const allowlist = SEAT_ENVELOPE_AUTH_FILES[cli];
    for (const name of record.authFiles) {
      if (!allowlist.includes(name)) fail('unknown-field', `auth file not allowlisted for ${cli}: ${name}`);
      const src = join(seatDir, name);
      const st = await lstat(src).catch(() => null);
      if (!st || st.isSymbolicLink() || !st.isFile()) {
        fail('onboarding-shape-unverified', `auth file missing in seatDir: ${name}`);
      }
      const bytes = new Uint8Array(await readFile(src));
      if (cli === 'claude' && name === '.claude.json') continue; // composed below
      writes.push({ path: authCellDest(name, cellHome, configDirs), bytes, cls: 'auth' });
    }
    if (onboarding) {
      writes.push(...await planOnboardingWrites({
        cli,
        onboarding,
        seatDir,
        cellHome,
        workspaceDir,
        configDirs,
        claudeMcpConfig: input.claudeMcpConfig,
        codexMcpServers: input.codexMcpServers,
      }));
    }
    for (const w of writes) await writeExclusive(roots, w.path, w.bytes);
    const files = writes
      .map((w) => ({
        cellRelPath: receiptRelPath(w.path, cellHome, configDirs),
        class: w.cls,
        sha256: sha256Hex(w.bytes),
        byteLength: w.bytes.length,
      }))
      .sort((a, b) => a.cellRelPath.localeCompare(b.cellRelPath));
    return { ok: true, receipt: { files } };
  } catch (error) {
    return asResult(error);
  }
}
