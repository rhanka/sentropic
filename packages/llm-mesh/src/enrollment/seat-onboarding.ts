// @sentropic/llm-mesh/enrollment/seat-onboarding.ts
//
// SeatOnboardingV1: the sibling onboarding block that travels inside the
// serialized seat envelope next to the frozen SeatBundleV1. Contract and
// validators only — this module performs no home, keyring, network or
// provider access (same rule as seat-bundle.ts). Capture normalizes and
// re-serializes an allowlisted subset; transport accepts canonical bytes
// only. Every refusal is fail-closed at the stage that raises it.

import {
  SEAT_BUNDLE_MAX_BYTES,
  classifyTransition,
  validateSeatBundle,
  type SeatBundleV1,
  type SeatCli,
  type SeatLineageTuple,
  type SeatValidationCode,
  type SeatValidationContext,
} from './seat-bundle.js';
import { AgyMappingError, translateAgySeatToApplication } from './agy-cli-import.js';

export const SEAT_ONBOARDING_SCHEMA_VERSION = 1 as const;

/** Whole onboarding block cap, serialized; sidecar precedent (4 KiB). */
export const SEAT_ONBOARDING_MAX_BYTES = 4096;

export type SeatOnboardingDestKey =
  | 'agy-jetski'
  | 'claude-json'
  | 'muse-trust'
  | 'codex-config';

export type SeatOnboardingFormat =
  | 'agy-jetski-pbtxt-v1'
  | 'claude-json-projection-v1'
  | 'muse-trust-json-v1'
  | 'codex-config-projection-v1';

export type SeatCellSynthesis =
  | 'claude-workspace-trust'
  | 'muse-workspace-trust'
  | 'codex-project-trust';

/**
 * Closed refusal union. `onboarding-required` is the launch-gate code: it
 * is never returned by a validator (an absent block is a valid envelope)
 * and only stage 2 / the preflight raise it.
 */
export type SeatOnboardingCode =
  | 'onboarding-schema-mismatch'
  | 'onboarding-size-exceeded'
  | 'onboarding-unknown-field'
  | 'onboarding-identifier-present'
  | 'onboarding-version-mismatch'
  | 'onboarding-lineage-mismatch'
  | 'onboarding-shape-unverified'
  | 'onboarding-incomplete'
  | 'onboarding-binding-unverifiable'
  | 'onboarding-required';

export interface SeatOnboardingFile {
  /** Logical destination, resolved at cell stage — never a path. */
  destKey: SeatOnboardingDestKey;
  format: SeatOnboardingFormat;
  /** Canonical re-serialized bytes only. */
  contentBase64: string;
  /** Hex digest of the decoded bytes. */
  sha256: string;
  /** Decoded length; must match. */
  byteLength: number;
}

export interface SeatOnboardingV1 {
  schemaVersion: 1;
  cli: SeatCli;
  /** == bundle.identity.seatRef */
  seatRef: string;
  /** == bundle.provenance.accountBinding (custodian assertion, §3.4) */
  accountBinding: string;
  /** Only eligible basis: a reference that survives token refresh. */
  accountBindingBasis: 'custodian-stable-ref';
  /** == bundle.lifecycle {epoch, generation, operationId} */
  lineage: SeatLineageTuple;
  reboundFrom?: SeatLineageTuple;
  reboundAt?: string;
  nativeCliVersion: string;
  os: 'linux' | 'macos' | 'windows';
  /** Custodian-observed; never read from the source file. */
  capturedAt: string;
  consent: { source: 'owner-interactive-cli'; ownerScope: string };
  /** Per-CLI standing decision; [] for agy. */
  cellSynthesis: SeatCellSynthesis[];
  /** 1..N, N = allowlist size for the CLI (1 in v1). */
  files: SeatOnboardingFile[];
}

/** Serialized seat envelope: bundle + base64 auth files + agy tuple + onboarding. */
export interface SeatEnvelopeV1 {
  bundle: SeatBundleV1;
  files?: Record<string, string>;
  agy?: Record<string, unknown>;
  onboarding?: SeatOnboardingV1;
}

export type SeatOnboardingStatus = 'present' | 'absent';

export type SeatLaunchGate =
  | { eligible: true }
  | { eligible: false; code: 'onboarding-required' };

export type SeatOnboardingValidationResult =
  | { ok: true; block: SeatOnboardingV1 }
  | { ok: false; code: SeatOnboardingCode; detail: string };

export type SeatEnvelopeValidationResult =
  | {
      ok: true;
      bundle: SeatBundleV1;
      files: Record<string, string>;
      agy: Record<string, unknown> | null;
      onboarding: SeatOnboardingV1 | null;
      onboardingStatus: SeatOnboardingStatus;
      launchGate: SeatLaunchGate;
    }
  | { ok: false; code: SeatValidationCode | SeatOnboardingCode; detail: string };

export class SeatOnboardingError extends Error {
  readonly code: SeatOnboardingCode;
  constructor(code: SeatOnboardingCode, message: string) {
    super(message);
    this.name = 'SeatOnboardingError';
    this.code = code;
  }
}

/** Bench-measured auth-file allowlist, seat-directory-relative storage names. */
export const SEAT_ENVELOPE_AUTH_FILES: Record<SeatCli, readonly string[]> = {
  agy: ['.gemini/antigravity-cli/antigravity-oauth-token'],
  claude: ['.claude/.credentials.json', '.claude.json'],
  codex: ['.codex/auth.json'],
  muse: ['.config/muse/auth.json'],
  vibe: ['.vibe/MISTRAL_API_KEY'],
};

/** Decoded-byte cap per transported onboarding file. */
export const SEAT_ONBOARDING_FILE_CAPS: Record<SeatOnboardingDestKey, number> = {
  'agy-jetski': 1024,
  'claude-json': 1024,
  'muse-trust': 1024,
  'codex-config': 2048,
};
