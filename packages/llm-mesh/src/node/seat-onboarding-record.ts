//
// Stage-2 seat-record read: re-read and re-validate the stage-1 seat record
// (bundle + onboarding + binding + versions) and re-derive the launch gate.
// A stored gate that disagrees with the derivation is a tampered record.
// Internal module: not exported from the package entry points.

import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { validateSeatBundle } from '../enrollment/seat-bundle.js';
import {
  seatLaunchGate,
  validateSeatOnboarding,
  type SeatOnboardingStatus,
  type SeatOnboardingV1,
} from '../enrollment/seat-onboarding.js';
import type { SeatRecordView } from './seat-onboarding-types.js';
import { SEAT_RECORD_REL_PATH, fail, isRecord } from './seat-stage-write.js';

/**
 * Read and re-validate the seat record of a staged seat directory. Throws a
 * StageRefusal (via `fail`) on any mismatch, missing or symlinked record.
 */
export async function readSeatRecord(input: {
  seatDir: string;
  expectedNativeCliVersion: string;
  ownerScope: string;
}): Promise<SeatRecordView> {
  const { seatDir } = input;
  const seatSt = await lstat(seatDir).catch(() => null);
  if (!seatSt || seatSt.isSymbolicLink() || !seatSt.isDirectory()) {
    fail('onboarding-shape-unverified', 'seatDir must be an existing directory');
  }
  const recordPath = join(seatDir, SEAT_RECORD_REL_PATH);
  const recordSt = await lstat(recordPath).catch(() => null);
  if (!recordSt || recordSt.isSymbolicLink() || !recordSt.isFile()) {
    fail('onboarding-shape-unverified', 'seat record missing or not a regular file');
  }
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(await readFile(recordPath, 'utf8'));
  } catch {
    fail('onboarding-shape-unverified', 'seat record is not JSON');
  }
  if (!isRecord(record)) fail('onboarding-shape-unverified', 'seat record must be an object');
  const badRecordKey = Object.keys(record).find((k) => !['version', 'bundle', 'onboarding', 'launchGate', 'authFiles'].includes(k));
  if (badRecordKey) fail('onboarding-unknown-field', `unknown seat record field: ${badRecordKey}`);
  if (record['version'] !== 1) fail('onboarding-schema-mismatch', 'seat record version must be 1');
  const bundleResult = validateSeatBundle(record['bundle'], { trustedAuthority: 'consumer' });
  if (!bundleResult.ok) fail(bundleResult.code, bundleResult.detail);
  const bundle = bundleResult.bundle;
  const cli = bundle.identity.cli;
  let onboarding: SeatOnboardingV1 | null = null;
  let onboardingStatus: SeatOnboardingStatus = 'absent';
  if (record['onboarding'] !== null && record['onboarding'] !== undefined) {
    const blockResult = validateSeatOnboarding(record['onboarding']);
    if (!blockResult.ok) fail(blockResult.code, blockResult.detail);
    onboarding = blockResult.block;
    onboardingStatus = 'present';
    const lifecycle = bundle.lifecycle;
    if (
      onboarding.cli !== cli ||
      onboarding.seatRef !== bundle.identity.seatRef ||
      onboarding.accountBinding !== bundle.provenance.accountBinding ||
      onboarding.consent.ownerScope !== bundle.identity.ownerScope ||
      onboarding.lineage.epoch !== lifecycle.epoch ||
      onboarding.lineage.generation !== lifecycle.generation ||
      onboarding.lineage.operationId !== lifecycle.operationId
    ) {
      fail('onboarding-lineage-mismatch', 'seat record binding mismatch');
    }
    if (bundle.identity.nativeCliVersion !== onboarding.nativeCliVersion) {
      fail('onboarding-version-mismatch', 'record version mismatch');
    }
  }
  if (bundle.identity.ownerScope !== input.ownerScope) {
    fail('onboarding-lineage-mismatch', 'ownerScope does not match the seat record');
  }
  if (bundle.identity.nativeCliVersion !== undefined && bundle.identity.nativeCliVersion !== input.expectedNativeCliVersion) {
    fail('onboarding-version-mismatch', 'bundle nativeCliVersion does not match the expected version');
  }
  if (onboarding && onboarding.nativeCliVersion !== input.expectedNativeCliVersion) {
    fail('onboarding-version-mismatch', 'block nativeCliVersion does not match the expected version');
  }
  const derivedGate = seatLaunchGate(cli, onboardingStatus);
  if (JSON.stringify(record['launchGate']) !== JSON.stringify(derivedGate)) {
    fail('onboarding-lineage-mismatch', 'stored launchGate disagrees with the re-derived gate');
  }
  const authFiles = record['authFiles'];
  if (!Array.isArray(authFiles) || authFiles.some((n) => typeof n !== 'string')) {
    fail('onboarding-schema-mismatch', 'seat record authFiles must be a string list');
  }
  return { bundle, onboarding, onboardingStatus, launchGate: derivedGate, authFiles: authFiles as string[] };
}
