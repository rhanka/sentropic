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

const DEST_FORMAT: Record<SeatOnboardingDestKey, SeatOnboardingFormat> = {
  'agy-jetski': 'agy-jetski-pbtxt-v1',
  'claude-json': 'claude-json-projection-v1',
  'muse-trust': 'muse-trust-json-v1',
  'codex-config': 'codex-config-projection-v1',
};

/** v1 allowlist entry per CLI; vibe has none until a gate is measured. */
const CLI_DEST: Record<SeatCli, SeatOnboardingDestKey | null> = {
  agy: 'agy-jetski',
  claude: 'claude-json',
  muse: 'muse-trust',
  codex: 'codex-config',
  vibe: null,
};

/** Reviewed full completed-step set per pinned agy version (measured 1.4.12). */
export const AGY_REQUIRED_COMPLETED_STEPS: Record<string, readonly string[]> = {
  '1.4.12': [
    'POST_ONBOARDING_STEP_TYPE_MANAGER_WELCOME',
    'POST_ONBOARDING_STEP_TYPE_USAGE_MODE',
    'POST_ONBOARDING_STEP_TYPE_AGENT_CONFIGURATION',
    'POST_ONBOARDING_STEP_TYPE_ADD_WORKSPACE',
  ],
};

/** Reviewed muse trust.json schema versions; starts as a singleton. */
export const MUSE_TRUST_KNOWN_SCHEMA_VERSIONS: readonly number[] = [1];

/** Reviewed codex approval policies for v1 (sufficiency unverified until the L4 probe). */
export const CODEX_APPROVAL_POLICY_VALUES: readonly string[] = [
  'untrusted',
  'on-failure',
  'on-request',
  'never',
];

const CLIS: readonly SeatCli[] = ['agy', 'codex', 'vibe', 'muse', 'claude'];
const GATED_CLIS: readonly SeatCli[] = ['agy', 'claude', 'muse', 'codex'];
const SYNTHESIS_CLIS: Record<SeatCellSynthesis, SeatCli> = {
  'claude-workspace-trust': 'claude',
  'muse-workspace-trust': 'muse',
  'codex-project-trust': 'codex',
};

/**
 * The single gate fact every downstream stage uses: a present block (any
 * CLI) and vibe-absent are eligible; agy/claude/muse/codex absent close the
 * gate with the launch-gate code `onboarding-required`.
 */
export function seatLaunchGate(cli: SeatCli, onboardingStatus: SeatOnboardingStatus): SeatLaunchGate {
  if (onboardingStatus === 'present') return { eligible: true };
  if (!GATED_CLIS.includes(cli)) return { eligible: true };
  return { eligible: false, code: 'onboarding-required' };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const unknownKey = (value: Record<string, unknown>, allowed: readonly string[]): string | null =>
  Object.keys(value).find((k) => !allowed.includes(k)) ?? null;

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const validDate = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));

const validInt = (value: unknown, min: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min;

const utf8Bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const fail = (
  code: SeatOnboardingCode,
  detail: string,
): SeatOnboardingValidationResult => ({ ok: false, code, detail });

const SEAT_ONBOARDING_TOP_KEYS = [
  'schemaVersion', 'cli', 'seatRef', 'accountBinding', 'accountBindingBasis',
  'lineage', 'reboundFrom', 'reboundAt', 'nativeCliVersion', 'os',
  'capturedAt', 'consent', 'cellSynthesis', 'files',
] as const;

const SEAT_ONBOARDING_FILE_KEYS = ['destKey', 'format', 'contentBase64', 'sha256', 'byteLength'] as const;
const LINEAGE_KEYS = ['epoch', 'generation', 'operationId'] as const;
const CONSENT_KEYS = ['source', 'ownerScope'] as const;

function validateLineageTuple(value: unknown): value is SeatLineageTuple {
  if (!isRecord(value)) return false;
  if (unknownKey(value, LINEAGE_KEYS)) return false;
  return validInt(value['epoch'], 1) && validInt(value['generation'], 0) && nonEmpty(value['operationId']);
}


// ── agy jetski pbtxt subset ──────────────────────────────────────────────
// Narrow grammar: blocks, keys, enum scalars, quoted strings and numbers.
// No new dependency. The canonical grammar admits enum tokens only inside
// the transported block, so an identifier cannot be represented in a valid
// block at all — a structural property, not a denylist.

export type PbtxtScalar =
  | { kind: 'enum'; token: string }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: string };

export interface PbtxtField {
  name: string;
  scalar?: PbtxtScalar;
  children?: PbtxtField[];
}

class PbtxtParser {
  private pos = 0;
  constructor(private readonly text: string) {}

  parseFields(untilBrace: boolean): PbtxtField[] {
    const fields: PbtxtField[] = [];
    for (;;) {
      this.skipTrivia();
      if (this.pos >= this.text.length) {
        if (untilBrace) throw new SeatOnboardingError('onboarding-shape-unverified', 'unterminated pbtxt block');
        return fields;
      }
      if (this.text[this.pos] === '}') {
        if (!untilBrace) throw new SeatOnboardingError('onboarding-shape-unverified', 'unexpected }');
        this.pos += 1;
        return fields;
      }
      fields.push(this.parseField());
    }
  }

  private parseField(): PbtxtField {
    const name = this.parseIdent();
    this.skipTrivia();
    if (this.pos >= this.text.length) throw new SeatOnboardingError('onboarding-shape-unverified', 'truncated pbtxt field');
    const ch = this.text[this.pos];
    if (ch === '{') {
      this.pos += 1;
      return { name, children: this.parseFields(true) };
    }
    if (ch === ':') {
      this.pos += 1;
      return { name, scalar: this.parseScalar() };
    }
    throw new SeatOnboardingError('onboarding-shape-unverified', `unexpected '${ch}' after field ${name}`);
  }

  private parseScalar(): PbtxtScalar {
    this.skipTrivia();
    if (this.pos >= this.text.length) throw new SeatOnboardingError('onboarding-shape-unverified', 'truncated pbtxt scalar');
    const ch = this.text[this.pos];
    if (ch === '"') return { kind: 'string', value: this.parseString() };
    if (ch === '-' || (ch >= '0' && ch <= '9')) return { kind: 'number', value: this.parseNumber() };
    return { kind: 'enum', token: this.parseIdent() };
  }

  private parseIdent(): string {
    this.skipTrivia();
    const start = this.pos;
    while (this.pos < this.text.length && /[A-Za-z0-9_.]/.test(this.text[this.pos])) this.pos += 1;
    if (this.pos === start) throw new SeatOnboardingError('onboarding-shape-unverified', 'expected identifier');
    return this.text.slice(start, this.pos);
  }

  private parseString(): string {
    this.pos += 1;
    let out = '';
    while (this.pos < this.text.length && this.text[this.pos] !== '"') {
      out += this.text[this.pos];
      this.pos += 1;
    }
    if (this.pos >= this.text.length) throw new SeatOnboardingError('onboarding-shape-unverified', 'unterminated string');
    this.pos += 1;
    return out;
  }

  private parseNumber(): string {
    const start = this.pos;
    while (this.pos < this.text.length && /[-+0-9.eE]/.test(this.text[this.pos])) this.pos += 1;
    return this.text.slice(start, this.pos);
  }

  private skipTrivia(): void {
    for (;;) {
      while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) this.pos += 1;
      if (this.text[this.pos] === '#') {
        while (this.pos < this.text.length && this.text[this.pos] !== '\n') this.pos += 1;
        continue;
      }
      return;
    }
  }
}

/** Parse the pbtxt subset; throws SeatOnboardingError on shape drift. */
export function parseAgyJetskiPbtxt(text: string): PbtxtField[] {
  return new PbtxtParser(text).parseFields(false);
}

/** Canonical serialization: fixed key order, reviewed enum order, one trailing newline. */
export function canonicalAgyJetskiBytes(nativeCliVersion: string, steps: readonly string[]): string {
  const required = AGY_REQUIRED_COMPLETED_STEPS[nativeCliVersion];
  if (!required) throw new SeatOnboardingError('onboarding-shape-unverified', `no required step set for agy ${nativeCliVersion}`);
  const ordered = required.filter((step) => steps.includes(step));
  return `post_onboarding {\n${ordered.map((s) => `  completed_steps: ${s}\n`).join('')}}\n`;
}

/** True when any scalar anywhere in the tree is a quoted string or a number. */
function hasIdentifierScalar(fields: readonly PbtxtField[]): boolean {
  for (const field of fields) {
    if (field.scalar && field.scalar.kind !== 'enum') return true;
    if (field.children && hasIdentifierScalar(field.children)) return true;
  }
  return false;
}

/** Extract the completed_steps set of the single post_onboarding block. */
function extractAgySteps(fields: readonly PbtxtField[]): { steps: string[] } | SeatOnboardingCode {
  const blocks = fields.filter((f) => f.name === 'post_onboarding');
  if (fields.length !== 1 || blocks.length !== 1 || !blocks[0].children) {
    return 'onboarding-shape-unverified';
  }
  const children = blocks[0].children;
  if (children.length === 0) return 'onboarding-incomplete';
  const steps: string[] = [];
  for (const child of children) {
    if (child.name !== 'completed_steps' || !child.scalar || child.scalar.kind !== 'enum') {
      return 'onboarding-shape-unverified';
    }
    steps.push(child.scalar.token);
  }
  return { steps };
}

/**
 * Validate transported agy bytes: canonical form only. The step set must be
 * exactly the full reviewed set for the pinned version; any extra key,
 * value kind or step refuses.
 */
export function validateAgyJetskiContent(text: string, nativeCliVersion: string): SeatOnboardingCode | null {
  let fields: PbtxtField[];
  try {
    fields = parseAgyJetskiPbtxt(text);
  } catch (error) {
    if (error instanceof SeatOnboardingError) return error.code;
    return 'onboarding-shape-unverified';
  }
  if (hasIdentifierScalar(fields)) return 'onboarding-identifier-present';
  const extracted = extractAgySteps(fields);
  if (typeof extracted === 'string') return extracted;
  const required = AGY_REQUIRED_COMPLETED_STEPS[nativeCliVersion];
  if (!required) return 'onboarding-shape-unverified';
  const set = new Set(extracted.steps);
  if (set.size !== extracted.steps.length) return 'onboarding-shape-unverified';
  for (const step of extracted.steps) {
    if (!required.includes(step)) return 'onboarding-shape-unverified';
  }
  for (const step of required) {
    if (!set.has(step)) return 'onboarding-incomplete';
  }
  if (text !== canonicalAgyJetskiBytes(nativeCliVersion, extracted.steps)) {
    return 'onboarding-shape-unverified';
  }
  return null;
}
