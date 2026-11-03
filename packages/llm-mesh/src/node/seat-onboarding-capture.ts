//
// Node-side seat onboarding capture. Capture reads the explicitly selected
// source file once (agy, claude, muse), projects it to canonical bytes, and
// never reads a default home, the environment, the keyring, or the network.
// Codex reads no file: it takes the explicit custodian intent object (§3.3).
// Every refusal is a typed fail-closed result.

import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SeatCli, SeatLineageTuple } from '../enrollment/seat-bundle.js';
import {
  SEAT_ONBOARDING_FILE_CAPS,
  SeatOnboardingError,
  canonicaliseAgyJetski,
  validateSeatOnboarding,
  type SeatCellSynthesis,
  type SeatOnboardingCode,
  type SeatOnboardingDestKey,
  type SeatOnboardingFormat,
  type SeatOnboardingV1,
} from '../enrollment/seat-onboarding.js';
import {
  projectClaudeOnboarding,
  projectCodexIntent,
  projectMuseTrust,
} from '../enrollment/seat-onboarding-projections.js';

/**
 * Capture source per CLI, relative to the explicit source HOME (§3.2).
 * `null` means no file is read: codex takes an explicit intent object,
 * vibe has no measured gate and no allowlist entry.
 */
export const CAPTURE_SOURCES: Record<SeatCli, string | null> = {
  agy: '.gemini/antigravity-cli/jetski_state.pbtxt',
  claude: '.claude.json',
  muse: '.config/muse/trust.json',
  codex: null,
  vibe: null,
};

/** Source read cap before parse: agy's jetski is small; claude/muse sources may be large (the projection is the point). */
const CAPTURE_SOURCE_MAX_BYTES: Record<SeatCli, number> = {
  agy: SEAT_ONBOARDING_FILE_CAPS['agy-jetski'],
  claude: 1024 * 1024,
  muse: 1024 * 1024,
  codex: 0,
  vibe: 0,
};

const DEST_FORMAT: Record<string, [SeatOnboardingDestKey, SeatOnboardingFormat]> = {
  agy: ['agy-jetski', 'agy-jetski-pbtxt-v1'],
  claude: ['claude-json', 'claude-json-projection-v1'],
  muse: ['muse-trust', 'muse-trust-json-v1'],
  codex: ['codex-config', 'codex-config-projection-v1'],
};

export interface SeatCaptureSelector {
  sourceRelPath: string;
}

export interface SeatCaptureInput {
  cli: SeatCli;
  /** Explicit source HOME; there is no default-home overload (file CLIs only). */
  sourceHome: string;
  /** Explicit selector; must equal the CLI's capture source exactly (file CLIs only). */
  selector: SeatCaptureSelector;
  seatRef: string;
  ownerScope: string;
  /** Custodian-asserted stable account reference (§3.4). */
  accountBinding: string;
  nativeCliVersion: string;
  os: 'linux' | 'macos' | 'windows';
  /** Custodian-observed capture time, never read from the source file. */
  capturedAt: string;
  lineage: SeatLineageTuple;
  cellSynthesis?: SeatCellSynthesis[];
  /** Codex only: the explicit policy intent; no file is read. */
  intent?: unknown;
}

export type SeatCaptureResult =
  | { ok: true; block: SeatOnboardingV1 }
  | { ok: false; code: SeatOnboardingCode; detail: string };

const refuse = (code: SeatOnboardingCode, detail: string): SeatCaptureResult => ({
  ok: false,
  code,
  detail,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Read the source file once: regular file only, size-capped before parse. */
async function readSource(sourcePath: string, cli: SeatCli): Promise<string | SeatCaptureResult> {
  let stat;
  try {
    stat = await lstat(sourcePath);
  } catch {
    return refuse('onboarding-shape-unverified', 'capture source is not readable');
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return refuse('onboarding-shape-unverified', 'capture source must be a regular file, not a symlink');
  }
  if (stat.size > CAPTURE_SOURCE_MAX_BYTES[cli]) {
    return refuse('onboarding-size-exceeded', 'capture source exceeds its read cap before parse');
  }
  try {
    return await readFile(sourcePath, 'utf8');
  } catch {
    return refuse('onboarding-shape-unverified', 'capture source could not be read');
  }
}

/** Project the source text to canonical bytes per CLI format. */
function projectSource(cli: SeatCli, sourceText: string, nativeCliVersion: string, intent?: unknown): string {
  try {
    if (cli === 'agy') return canonicaliseAgyJetski(sourceText, nativeCliVersion);
    if (cli === 'claude') return projectClaudeOnboarding(sourceText);
    if (cli === 'muse') return projectMuseTrust(sourceText);
    if (cli === 'codex') return projectCodexIntent(intent);
  } catch (error) {
    if (error instanceof SeatOnboardingError) throw error;
    throw new SeatOnboardingError('onboarding-shape-unverified', 'projection refused');
  }
  throw new SeatOnboardingError('onboarding-shape-unverified', `no capture projection for ${cli} in v1`);
}

function buildBlock(input: SeatCaptureInput, content: string): SeatCaptureResult {
  const bytes = new TextEncoder().encode(content);
  const [destKey, format] = DEST_FORMAT[input.cli];
  const block: SeatOnboardingV1 = {
    schemaVersion: 1,
    cli: input.cli,
    seatRef: input.seatRef,
    accountBinding: input.accountBinding,
    accountBindingBasis: 'custodian-stable-ref',
    lineage: input.lineage,
    nativeCliVersion: input.nativeCliVersion,
    os: input.os,
    capturedAt: input.capturedAt,
    consent: { source: 'owner-interactive-cli', ownerScope: input.ownerScope },
    cellSynthesis: input.cellSynthesis ?? [],
    files: [{
      destKey,
      format,
      contentBase64: Buffer.from(bytes).toString('base64'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.length,
    }],
  };
  const validated = validateSeatOnboarding(block);
  if (!validated.ok) return validated;
  return { ok: true, block: validated.block };
}

/**
 * Capture one onboarding block. File CLIs (agy, claude, muse) take an
 * explicit source HOME and selector; codex takes the explicit intent and
 * reads no file. The block is bound to one seat at issuance: `seatRef` and
 * `lineage` come from the caller and are checked again at envelope
 * validation and both materialization stages.
 */
export async function captureSeatOnboarding(input: SeatCaptureInput): Promise<SeatCaptureResult> {
  if (!isRecord(input)) return refuse('onboarding-schema-mismatch', 'capture input must be an object');
  if (typeof input.accountBinding !== 'string' || input.accountBinding.length === 0) {
    return refuse('onboarding-binding-unverifiable', 'no stable account reference available at capture');
  }
  if (input.cli === 'codex') {
    if (!('intent' in input) || input.intent === undefined) {
      return refuse('onboarding-shape-unverified', 'codex capture requires the explicit intent object and reads no file');
    }
    try {
      return buildBlock(input, projectSource('codex', '', input.nativeCliVersion, input.intent));
    } catch (error) {
      if (error instanceof SeatOnboardingError) return refuse(error.code, error.message);
      throw error;
    }
  }
  if (typeof input.sourceHome !== 'string' || input.sourceHome.length === 0) {
    return refuse('onboarding-shape-unverified', 'an explicit source HOME is required; there is no default home');
  }
  if (!isRecord(input.selector) || typeof input.selector['sourceRelPath'] !== 'string') {
    return refuse('onboarding-shape-unverified', 'an explicit selector is required');
  }
  const source = CAPTURE_SOURCES[input.cli];
  if (source === null || source === undefined) {
    return refuse('onboarding-shape-unverified', `no file capture source for ${input.cli} in v1`);
  }
  if (input.selector['sourceRelPath'] !== source) {
    return refuse('onboarding-shape-unverified', 'selector does not match the CLI capture source');
  }
  const read = await readSource(join(input.sourceHome, source), input.cli);
  if (typeof read !== 'string') return read;
  try {
    return buildBlock(input, projectSource(input.cli, read, input.nativeCliVersion));
  } catch (error) {
    if (error instanceof SeatOnboardingError) return refuse(error.code, error.message);
    throw error;
  }
}
