//
// Shared input / receipt types for the two-stage seat materialization and
// erasure. Types only: no IO, imported by every sibling stage module and
// re-exported from the public barrel.

import type { SeatBundleV1, SeatCli, SeatLineageTuple } from '../enrollment/seat-bundle.js';
import type {
  SeatLaunchGate,
  SeatOnboardingDestKey,
  SeatOnboardingFormat,
  SeatOnboardingStatus,
  SeatOnboardingV1,
} from '../enrollment/seat-onboarding.js';
import type { StageCode } from './seat-stage-write.js';

// ── stage 1 (seat stage) ─────────────────────────────────────────────────

export interface SeatStageInputSeat {
  envelope: unknown;
  seatDir: string;
}

export interface SeatStageInput {
  seats: readonly SeatStageInputSeat[];
  ownerScope: string;
  expectedNativeCliVersions: Partial<Record<SeatCli, string>>;
}

export interface SeatStageReceiptOnboarding {
  files: Array<{
    destKey: SeatOnboardingDestKey;
    format: SeatOnboardingFormat;
    sha256: string;
    byteLength: number;
  }>;
  nativeCliVersion: string;
  capturedAt: string;
  lineage: SeatLineageTuple;
  reboundFrom?: SeatLineageTuple;
}

export interface SeatStageReceiptEntry {
  seatRef: string;
  cli: SeatCli;
  authFiles: string[];
  seatRecordSha256: string;
  onboardingStatus: SeatOnboardingStatus;
  launchGate: SeatLaunchGate;
  onboarding: SeatStageReceiptOnboarding | null;
}

export interface SeatStageReceipt {
  seats: SeatStageReceiptEntry[];
}

export type SeatStageResult =
  | { ok: true; receipt: SeatStageReceipt }
  | { ok: false; code: StageCode; detail: string };

// ── stage 2 (cell stage) ─────────────────────────────────────────────────

export interface SeatCellConfigDirs {
  claudeConfigDir: string;
  codexHome: string;
  xdgConfigHome: string;
}

export interface SeatCodexMcpServer {
  name: string;
  command: string;
  args: readonly string[];
  defaultToolsApprovalMode?: 'approve';
}

export interface SeatCellInput {
  seatDir: string;
  cellHome: string;
  workspaceDir: string;
  configDirs: SeatCellConfigDirs;
  expectedNativeCliVersion: string;
  ownerScope: string;
  claudeMcpConfig?: Record<string, unknown>;
  codexMcpServers?: readonly SeatCodexMcpServer[];
}

export type SeatCellFileClass = 'auth' | 'onboarding' | 'synthesized' | 'composed';

export interface SeatCellReceiptFile {
  cellRelPath: string;
  class: SeatCellFileClass;
  sha256: string;
  byteLength: number;
}

export interface SeatCellReceipt {
  files: SeatCellReceiptFile[];
}

export type SeatCellResult =
  | { ok: true; receipt: SeatCellReceipt }
  | { ok: false; code: StageCode; detail: string };

// ── erasure ──────────────────────────────────────────────────────────────

export type SeatEraseResult =
  | { ok: true; survivingPaths: string[] }
  | { ok: false; code: StageCode; detail: string };

// ── internal planning ────────────────────────────────────────────────────

/** One planned exclusive write, staged before any byte is written. */
export interface PlannedWrite {
  path: string;
  bytes: Uint8Array;
  cls: SeatCellFileClass;
}

/** Re-validated stage-1 seat record (stage 2 reads it, never trusts it). */
export interface SeatRecordView {
  bundle: SeatBundleV1;
  onboarding: SeatOnboardingV1 | null;
  onboardingStatus: SeatOnboardingStatus;
  launchGate: SeatLaunchGate;
  authFiles: string[];
}
