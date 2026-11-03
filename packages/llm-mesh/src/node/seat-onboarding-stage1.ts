//
// Stage 1 (seat stage): batch two-phase materialization of validated seat
// envelopes into per-seat directories, plus the library-owned seat record.

import { chmod, lstat, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { SeatBundleV1, SeatCli } from '../enrollment/seat-bundle.js';
import {
  validateSeatEnvelope,
  type SeatLaunchGate,
  type SeatOnboardingStatus,
  type SeatOnboardingV1,
} from '../enrollment/seat-onboarding.js';
import type {
  SeatStageInput,
  SeatStageInputSeat,
  SeatStageReceiptEntry,
  SeatStageResult,
} from './seat-onboarding-types.js';
import {
  SEAT_RECORD_REL_PATH,
  asResult,
  decodeBase64,
  fail,
  isRecord,
  sha256Hex,
  utf8,
  writeExclusive,
  assertCleanAncestors,
  DIR_MODE,
} from './seat-stage-write.js';

/** Auth `.claude.json` minimized-projection key set (stage-1 check, §3.3). */
const CLAUDE_AUTH_MINIMIZED_KEYS = ['oauthAccount', 'hasCompletedOnboarding', 'lastOnboardingVersion'];

function checkClaudeAuthMinimized(files: Record<string, string>): void {
  const raw = files['.claude.json'];
  if (raw === undefined) return;
  let obj: unknown;
  try {
    obj = JSON.parse(new TextDecoder().decode(decodeBase64(raw)));
  } catch {
    fail('onboarding-shape-unverified', 'auth .claude.json is not JSON');
  }
  if (!isRecord(obj)) fail('onboarding-shape-unverified', 'auth .claude.json must be an object');
  for (const key of Object.keys(obj)) {
    if (!CLAUDE_AUTH_MINIMIZED_KEYS.includes(key)) {
      fail('onboarding-shape-unverified', `non-minimized auth .claude.json key: ${key}`);
    }
  }
}

/**
 * Stage 1, batch and two-phase: phase 1 validates every envelope (bundle,
 * agy tuple, auth allowlist, onboarding binding, versions, digests, size
 * bounds, claude minimized projection) and refuses the whole batch on the
 * first failure with zero bytes written; an absent block is valid and
 * stages with a closed launch gate. Phase 2 writes auth files at their
 * storage names plus the seat record, per seat.
 */
export async function materialiseSeatEnvelopes(input: SeatStageInput): Promise<SeatStageResult> {
  try {
    if (!isRecord(input) || !Array.isArray(input['seats']) || input['seats'].length === 0) {
      fail('schema-mismatch', 'seats must be a non-empty array');
    }
    const ownerScope = input['ownerScope'];
    if (typeof ownerScope !== 'string' || ownerScope.length === 0) fail('schema-mismatch', 'ownerScope is required');
    const expectedVersions = (input['expectedNativeCliVersions'] ?? {}) as Partial<Record<SeatCli, string>>;
    const validated: Array<{
      seatDir: string;
      bundle: SeatBundleV1;
      files: Record<string, string>;
      onboarding: SeatOnboardingV1 | null;
      onboardingStatus: SeatOnboardingStatus;
      launchGate: SeatLaunchGate;
    }> = [];
    const seenDirs = new Set<string>();
    for (const seat of input['seats'] as readonly SeatStageInputSeat[]) {
      if (!isRecord(seat) || typeof seat['seatDir'] !== 'string' || seat['seatDir'].length === 0) {
        fail('schema-mismatch', 'each seat needs a seatDir');
      }
      const seatDir = resolve(seat['seatDir']);
      if (seenDirs.has(seatDir)) fail('schema-mismatch', 'duplicate seatDir in batch');
      seenDirs.add(seatDir);
      const env = validateSeatEnvelope(seat['envelope'], { trustedAuthority: 'consumer' });
      if (!env.ok) fail(env.code, env.detail);
      const { bundle, files, onboarding, onboardingStatus, launchGate } = env;
      if (bundle.identity.ownerScope !== ownerScope) {
        fail('onboarding-lineage-mismatch', 'bundle ownerScope does not match the stage ownerScope');
      }
      const expected = expectedVersions[bundle.identity.cli];
      if (expected !== undefined && bundle.identity.nativeCliVersion !== expected) {
        fail('onboarding-version-mismatch', 'bundle nativeCliVersion does not match the expected version');
      }
      if (bundle.identity.cli === 'claude') checkClaudeAuthMinimized(files);
      const existing = await lstat(seatDir).catch(() => null);
      if (existing) fail('onboarding-shape-unverified', `seatDir already exists: ${seatDir}`);
      await assertCleanAncestors(seatDir);
      validated.push({ seatDir, bundle, files, onboarding, onboardingStatus, launchGate });
    }
    const seats: SeatStageReceiptEntry[] = [];
    for (const v of validated) {
      await mkdir(v.seatDir, { recursive: true, mode: DIR_MODE });
      await chmod(v.seatDir, DIR_MODE);
      const authFiles = Object.keys(v.files).sort();
      for (const name of authFiles) {
        await writeExclusive([v.seatDir], join(v.seatDir, name), decodeBase64(v.files[name]));
      }
      const record = {
        version: 1,
        bundle: v.bundle,
        onboarding: v.onboarding,
        launchGate: v.launchGate,
        authFiles,
      };
      const recordBytes = utf8(`${JSON.stringify(record, null, 2)}\n`);
      await writeExclusive([v.seatDir], join(v.seatDir, SEAT_RECORD_REL_PATH), recordBytes);
      seats.push({
        seatRef: v.bundle.identity.seatRef,
        cli: v.bundle.identity.cli,
        authFiles,
        seatRecordSha256: sha256Hex(recordBytes),
        onboardingStatus: v.onboardingStatus,
        launchGate: v.launchGate,
        onboarding: v.onboarding
          ? {
              files: v.onboarding.files.map((f) => ({
                destKey: f.destKey,
                format: f.format,
                sha256: f.sha256,
                byteLength: f.byteLength,
              })),
              nativeCliVersion: v.onboarding.nativeCliVersion,
              capturedAt: v.onboarding.capturedAt,
              lineage: v.onboarding.lineage,
              ...(v.onboarding.reboundFrom ? { reboundFrom: v.onboarding.reboundFrom } : {}),
            }
          : null,
      });
    }
    return { ok: true, receipt: { seats } };
  } catch (error) {
    return asResult(error);
  }
}
