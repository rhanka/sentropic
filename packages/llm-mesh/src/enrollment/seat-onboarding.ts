// @sentropic/llm-mesh/enrollment/seat-onboarding.ts
//
// SeatOnboardingV1: the sibling onboarding block that travels inside the
// serialized seat envelope next to the frozen SeatBundleV1. Contract and
// validators only — this module performs no home, keyring, network or
// provider access (same rule as seat-bundle.ts). Capture normalizes and
// re-serializes an allowlisted subset; transport accepts canonical bytes
// only. Every refusal is fail-closed at the stage that raises it.

import { createHash } from 'node:crypto';
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

// ── per-format content validation ────────────────────────────────────────
// Structural, per format. Nothing is accepted on the basis of a file name
// or a digest alone.

export const CLAUDE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
export const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function decodeBase64Strict(value: string): Uint8Array | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  try {
    return new Uint8Array(Buffer.from(value, 'base64'));
  } catch {
    return null;
  }
}

function parseJsonObject(bytes: Uint8Array): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  return isRecord(parsed) ? parsed : null;
}

/** Validate one transported file's decoded content against its format. */
export function validateOnboardingFileContent(
  format: SeatOnboardingFormat,
  bytes: Uint8Array,
  nativeCliVersion: string,
): SeatOnboardingCode | null {
  if (format === 'agy-jetski-pbtxt-v1') {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return 'onboarding-shape-unverified';
    }
    return validateAgyJetskiContent(text, nativeCliVersion);
  }
  const obj = parseJsonObject(bytes);
  if (!obj) return 'onboarding-shape-unverified';
  if (format === 'claude-json-projection-v1') {
    if (unknownKey(obj, ['hasCompletedOnboarding', 'lastOnboardingVersion'])) return 'onboarding-shape-unverified';
    if (obj['hasCompletedOnboarding'] !== true) return 'onboarding-shape-unverified';
    if (typeof obj['lastOnboardingVersion'] !== 'string' || !CLAUDE_VERSION_PATTERN.test(obj['lastOnboardingVersion'])) {
      return 'onboarding-shape-unverified';
    }
    return null;
  }
  if (format === 'muse-trust-json-v1') {
    if (unknownKey(obj, ['schema_version'])) return 'onboarding-shape-unverified';
    const schemaVersion = obj['schema_version'];
    if (!validInt(schemaVersion, 1) || !MUSE_TRUST_KNOWN_SCHEMA_VERSIONS.includes(schemaVersion)) {
      return 'onboarding-shape-unverified';
    }
    return null;
  }
  if (format === 'codex-config-projection-v1') {
    if (unknownKey(obj, ['approvalPolicy', 'mcpServerNames'])) return 'onboarding-shape-unverified';
    if (typeof obj['approvalPolicy'] !== 'string' || !CODEX_APPROVAL_POLICY_VALUES.includes(obj['approvalPolicy'])) {
      return 'onboarding-shape-unverified';
    }
    const names = obj['mcpServerNames'];
    if (!Array.isArray(names) || names.length === 0) return 'onboarding-shape-unverified';
    const seen = new Set<string>();
    for (const name of names) {
      if (typeof name !== 'string' || !MCP_SERVER_NAME_PATTERN.test(name) || seen.has(name)) {
        return 'onboarding-shape-unverified';
      }
      seen.add(name);
    }
    return null;
  }
  return 'onboarding-shape-unverified';
}

/** Structural validation of one onboarding block; binding checks live in validateSeatEnvelope. */
export function validateSeatOnboarding(block: unknown): SeatOnboardingValidationResult {
  let serialized = '';
  try {
    serialized = JSON.stringify(block) ?? '';
  } catch {
    return fail('onboarding-schema-mismatch', 'block is not JSON-serializable');
  }
  if (utf8Bytes(serialized).length > SEAT_ONBOARDING_MAX_BYTES) {
    return fail('onboarding-size-exceeded', 'onboarding block exceeds 4 KiB');
  }
  if (!isRecord(block)) return fail('onboarding-schema-mismatch', 'block must be an object');
  const badTop = unknownKey(block, SEAT_ONBOARDING_TOP_KEYS);
  if (badTop) return fail('onboarding-unknown-field', `unknown onboarding field: ${badTop}`);
  if (block['schemaVersion'] !== SEAT_ONBOARDING_SCHEMA_VERSION) {
    return fail('onboarding-schema-mismatch', 'schemaVersion must be 1');
  }
  const cli = block['cli'];
  if (!CLIS.includes(cli as SeatCli)) return fail('onboarding-schema-mismatch', 'cli must be one of the five seat CLIs');
  const destKey = CLI_DEST[cli as SeatCli];
  if (!destKey) return fail('onboarding-shape-unverified', 'no v1 onboarding allowlist entry for this CLI');
  if (!nonEmpty(block['seatRef'])) return fail('onboarding-schema-mismatch', 'seatRef must be non-empty');
  if (!nonEmpty(block['accountBinding'])) return fail('onboarding-schema-mismatch', 'accountBinding must be non-empty');
  if (block['accountBindingBasis'] !== 'custodian-stable-ref') {
    return fail('onboarding-schema-mismatch', 'accountBindingBasis must be custodian-stable-ref');
  }
  if (!validateLineageTuple(block['lineage'])) return fail('onboarding-schema-mismatch', 'lineage must be a valid tuple');
  const hasReboundFrom = block['reboundFrom'] !== undefined;
  const hasReboundAt = block['reboundAt'] !== undefined;
  if (hasReboundFrom !== hasReboundAt) return fail('onboarding-schema-mismatch', 'reboundFrom and reboundAt come together');
  if (hasReboundFrom && !validateLineageTuple(block['reboundFrom'])) {
    return fail('onboarding-schema-mismatch', 'reboundFrom must be a valid tuple');
  }
  if (hasReboundAt && !validDate(block['reboundAt'])) return fail('onboarding-schema-mismatch', 'reboundAt must be a valid date');
  if (!nonEmpty(block['nativeCliVersion'])) return fail('onboarding-schema-mismatch', 'nativeCliVersion must be non-empty');
  if (block['os'] !== 'linux' && block['os'] !== 'macos' && block['os'] !== 'windows') {
    return fail('onboarding-schema-mismatch', 'os must be linux, macos or windows');
  }
  if (!validDate(block['capturedAt'])) return fail('onboarding-schema-mismatch', 'capturedAt must be a valid custodian-observed date');
  const consent = block['consent'];
  if (!isRecord(consent)) return fail('onboarding-schema-mismatch', 'consent must be an object');
  const badConsent = unknownKey(consent, CONSENT_KEYS);
  if (badConsent) return fail('onboarding-unknown-field', `unknown consent field: ${badConsent}`);
  if (consent['source'] !== 'owner-interactive-cli') return fail('onboarding-schema-mismatch', 'consent.source must be owner-interactive-cli');
  if (!nonEmpty(consent['ownerScope'])) return fail('onboarding-schema-mismatch', 'consent.ownerScope must be non-empty');
  const synthesis = block['cellSynthesis'];
  if (!Array.isArray(synthesis)) return fail('onboarding-schema-mismatch', 'cellSynthesis must be an array');
  const seenSynth = new Set<string>();
  for (const entry of synthesis) {
    if (typeof entry !== 'string' || !(entry in SYNTHESIS_CLIS) || seenSynth.has(entry)) {
      return fail('onboarding-shape-unverified', 'cellSynthesis entries must be unique known synthesis keys');
    }
    if (SYNTHESIS_CLIS[entry as SeatCellSynthesis] !== cli) {
      return fail('onboarding-shape-unverified', 'cellSynthesis entry does not belong to this CLI');
    }
    seenSynth.add(entry);
  }
  if (cli === 'agy' && synthesis.length > 0) {
    return fail('onboarding-shape-unverified', 'agy carries no cellSynthesis entry');
  }
  const files = block['files'];
  if (!Array.isArray(files) || files.length !== 1) {
    return fail('onboarding-shape-unverified', 'v1 carries exactly one onboarding file per CLI');
  }
  const file = files[0];
  if (!isRecord(file)) return fail('onboarding-schema-mismatch', 'file must be an object');
  const badFile = unknownKey(file, SEAT_ONBOARDING_FILE_KEYS);
  if (badFile) return fail('onboarding-unknown-field', `unknown file field: ${badFile}`);
  if (file['destKey'] !== destKey) return fail('onboarding-shape-unverified', 'destKey does not match the CLI allowlist');
  if (file['format'] !== DEST_FORMAT[destKey]) return fail('onboarding-shape-unverified', 'format does not match the destination');
  const bytes = decodeBase64Strict(file['contentBase64'] as string);
  if (!bytes) return fail('onboarding-schema-mismatch', 'contentBase64 must be strict base64');
  if (!validInt(file['byteLength'], 1) || file['byteLength'] !== bytes.length) {
    return fail('onboarding-shape-unverified', 'byteLength does not match the decoded content');
  }
  if (bytes.length > SEAT_ONBOARDING_FILE_CAPS[destKey]) {
    return fail('onboarding-size-exceeded', 'onboarding file exceeds its decoded-byte cap');
  }
  if (typeof file['sha256'] !== 'string' || !SHA256_PATTERN.test(file['sha256'])) {
    return fail('onboarding-shape-unverified', 'sha256 must be a hex digest');
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== file['sha256']) return fail('onboarding-shape-unverified', 'sha256 does not match the decoded content');
  const contentCode = validateOnboardingFileContent(DEST_FORMAT[destKey], bytes, block['nativeCliVersion'] as string);
  if (contentCode) return fail(contentCode, 'transported content is not canonical for the pinned version');
  return { ok: true, block: block as unknown as SeatOnboardingV1 };
}

// ── envelope validation ──────────────────────────────────────────────────

const ENVELOPE_KEYS = ['bundle', 'files', 'agy', 'onboarding'] as const;

/**
 * Validate the whole serialized seat envelope as one unit: bundle, agy
 * tuple translation where applicable, auth-file allowlist, onboarding
 * validation and binding. An absent block is a valid envelope (D1); what
 * absence denies is launch, through seatLaunchGate — never envelope
 * validity. `onboarding-required` is never returned here.
 */
export function validateSeatEnvelope(
  envelope: unknown,
  ctx?: SeatValidationContext,
): SeatEnvelopeValidationResult {
  let serialized = '';
  try {
    serialized = JSON.stringify(envelope) ?? '';
  } catch {
    return { ok: false, code: 'schema-mismatch', detail: 'envelope is not JSON-serializable' };
  }
  if (utf8Bytes(serialized).length > SEAT_BUNDLE_MAX_BYTES) {
    return { ok: false, code: 'size-exceeded', detail: 'serialized envelope exceeds 48 KiB' };
  }
  if (!isRecord(envelope)) return { ok: false, code: 'schema-mismatch', detail: 'envelope must be an object' };
  const badKey = unknownKey(envelope, ENVELOPE_KEYS);
  if (badKey) return { ok: false, code: 'unknown-field', detail: `unknown envelope field: ${badKey}` };
  const bundleResult = validateSeatBundle(envelope['bundle'], {
    ...ctx,
    trustedAuthority: ctx?.trustedAuthority ?? 'consumer',
  });
  if (!bundleResult.ok) return { ok: false, code: bundleResult.code, detail: bundleResult.detail };
  const bundle = bundleResult.bundle;
  const cli = bundle.identity.cli;
  const filesRaw = envelope['files'] ?? {};
  if (!isRecord(filesRaw)) return { ok: false, code: 'schema-mismatch', detail: 'files must be an object' };
  const allowlist = SEAT_ENVELOPE_AUTH_FILES[cli];
  for (const [name, value] of Object.entries(filesRaw)) {
    if (!allowlist.includes(name)) {
      return { ok: false, code: 'unknown-field', detail: `auth file not allowlisted for ${cli}: ${name}` };
    }
    if (typeof value !== 'string' || decodeBase64Strict(value) === null) {
      return { ok: false, code: 'schema-mismatch', detail: `auth file ${name} must be base64` };
    }
  }
  let agy: Record<string, unknown> | null = null;
  if (cli === 'agy') {
    if (!isRecord(envelope['agy'])) {
      return { ok: false, code: 'schema-mismatch', detail: 'agy envelope member is required for agy' };
    }
    agy = envelope['agy'];
    try {
      translateAgySeatToApplication({
        ownerScope: bundle.identity.ownerScope,
        seatRef: bundle.identity.seatRef,
        accountBinding: bundle.provenance.accountBinding,
        ...agy,
      });
    } catch (error) {
      if (error instanceof AgyMappingError) {
        return { ok: false, code: 'client-mismatch', detail: `agy tuple refused: ${error.code}` };
      }
      throw error;
    }
  } else if (envelope['agy'] !== undefined) {
    return { ok: false, code: 'unknown-field', detail: 'agy member is only valid for agy seats' };
  }
  let onboarding: SeatOnboardingV1 | null = null;
  let onboardingStatus: SeatOnboardingStatus = 'absent';
  if (envelope['onboarding'] !== undefined) {
    // A present block for a CLI with no allowlist entry (vibe in v1) is an
    // envelope defect, never a silent drop.
    if (!CLI_DEST[cli]) {
      return { ok: false, code: 'onboarding-shape-unverified', detail: 'no v1 onboarding allowlist entry for this CLI' };
    }
    const blockResult = validateSeatOnboarding(envelope['onboarding']);
    if (!blockResult.ok) return { ok: false, code: blockResult.code, detail: blockResult.detail };
    const block = blockResult.block;
    if (block.cli !== cli) return { ok: false, code: 'onboarding-lineage-mismatch', detail: 'block cli does not match the bundle' };
    if (block.seatRef !== bundle.identity.seatRef) {
      return { ok: false, code: 'onboarding-lineage-mismatch', detail: 'block seatRef does not match the bundle' };
    }
    if (block.accountBinding !== bundle.provenance.accountBinding) {
      return { ok: false, code: 'onboarding-lineage-mismatch', detail: 'block accountBinding does not match the bundle' };
    }
    if (block.consent.ownerScope !== bundle.identity.ownerScope) {
      return { ok: false, code: 'onboarding-lineage-mismatch', detail: 'block consent ownerScope does not match the bundle' };
    }
    const lifecycle = bundle.lifecycle;
    if (
      block.lineage.epoch !== lifecycle.epoch ||
      block.lineage.generation !== lifecycle.generation ||
      block.lineage.operationId !== lifecycle.operationId
    ) {
      return { ok: false, code: 'onboarding-lineage-mismatch', detail: 'block lineage does not match the bundle lifecycle' };
    }
    if (bundle.identity.nativeCliVersion !== block.nativeCliVersion) {
      return { ok: false, code: 'onboarding-version-mismatch', detail: 'bundle nativeCliVersion must equal the block version' };
    }
    onboarding = block;
    onboardingStatus = 'present';
  }
  return {
    ok: true,
    bundle,
    files: filesRaw as Record<string, string>,
    agy,
    onboarding,
    onboardingStatus,
    launchGate: seatLaunchGate(cli, onboardingStatus),
  };
}

/**
 * D11 rebind: move only the lineage pointer on a same-epoch forward
 * transition. Never recaptures and never edits content; an epoch change or
 * a CLI version change requires a fresh interactive capture.
 */
export function rebindSeatOnboarding(
  block: SeatOnboardingV1,
  nextBundle: SeatBundleV1,
  options: { reboundAt: string; files?: readonly SeatOnboardingFile[] },
): SeatOnboardingValidationResult {
  if (!validDate(options.reboundAt)) {
    return fail('onboarding-schema-mismatch', 'reboundAt must be a valid custodian-observed date');
  }
  const incoming: SeatLineageTuple = {
    epoch: nextBundle.lifecycle.epoch,
    generation: nextBundle.lifecycle.generation,
    operationId: nextBundle.lifecycle.operationId,
  };
  if (classifyTransition(block.lineage, incoming) !== 'forward') {
    return fail('onboarding-lineage-mismatch', 'rebind requires a same-epoch forward transition');
  }
  if (nextBundle.identity.seatRef !== block.seatRef) {
    return fail('onboarding-lineage-mismatch', 'rebind requires the same seatRef');
  }
  if (nextBundle.provenance.accountBinding !== block.accountBinding) {
    return fail('onboarding-lineage-mismatch', 'rebind requires the same asserted account');
  }
  if (nextBundle.identity.nativeCliVersion !== block.nativeCliVersion) {
    return fail('onboarding-version-mismatch', 'rebind requires an unchanged nativeCliVersion');
  }
  if (options.files !== undefined) {
    if (options.files.length !== block.files.length) {
      return fail('onboarding-shape-unverified', 'rebind requires identical file digests');
    }
    for (let i = 0; i < options.files.length; i += 1) {
      const next = options.files[i];
      const prev = block.files[i];
      if (
        next.destKey !== prev.destKey ||
        next.format !== prev.format ||
        next.sha256 !== prev.sha256 ||
        next.byteLength !== prev.byteLength ||
        next.contentBase64 !== prev.contentBase64
      ) {
        return fail('onboarding-shape-unverified', 'rebind requires identical file digests');
      }
    }
  }
  return {
    ok: true,
    block: {
      ...block,
      lineage: incoming,
      reboundFrom: { ...block.lineage },
      reboundAt: options.reboundAt,
    },
  };
}

// ── capture-side agy canonicalizer ───────────────────────────────────────

/** Capture extraction: the single post_onboarding block among other top-level keys. */
function extractAgyStepsForCapture(fields: readonly PbtxtField[]): { steps: string[] } | SeatOnboardingCode {
  const blocks = fields.filter((f) => f.name === 'post_onboarding');
  if (blocks.length !== 1 || !blocks[0].children) return 'onboarding-shape-unverified';
  const children = blocks[0].children;
  if (children.length === 0) return 'onboarding-incomplete';
  const steps: string[] = [];
  for (const child of children) {
    if (child.scalar && child.scalar.kind !== 'enum') return 'onboarding-identifier-present';
    if (child.name !== 'completed_steps' || !child.scalar || child.scalar.kind !== 'enum') {
      return 'onboarding-shape-unverified';
    }
    steps.push(child.scalar.token);
  }
  return { steps };
}

/**
 * Capture-side canonicalizer: parse the source file, keep only the
 * allowlisted step set, check it against the pinned version's required
 * set, and re-serialize canonically. No code path copies source bytes
 * through; `installation_uuid` and `migrations` are discarded here.
 */
export function canonicaliseAgyJetski(sourceText: string, nativeCliVersion: string): string {
  let fields: PbtxtField[];
  try {
    fields = parseAgyJetskiPbtxt(sourceText);
  } catch (error) {
    if (error instanceof SeatOnboardingError) throw error;
    throw new SeatOnboardingError('onboarding-shape-unverified', 'source pbtxt is not parseable');
  }
  const extracted = extractAgyStepsForCapture(fields);
  if (typeof extracted === 'string') throw new SeatOnboardingError(extracted, 'source step set refused');
  const required = AGY_REQUIRED_COMPLETED_STEPS[nativeCliVersion];
  if (!required) {
    throw new SeatOnboardingError('onboarding-shape-unverified', `no required step set for agy ${nativeCliVersion}`);
  }
  const set = new Set(extracted.steps);
  if (set.size !== extracted.steps.length) {
    throw new SeatOnboardingError('onboarding-shape-unverified', 'duplicate step entries');
  }
  for (const step of extracted.steps) {
    if (!required.includes(step)) throw new SeatOnboardingError('onboarding-shape-unverified', 'unknown step enum');
  }
  for (const step of required) {
    if (!set.has(step)) {
      throw new SeatOnboardingError('onboarding-incomplete', 'source step set is a strict subset of the required set');
    }
  }
  return canonicalAgyJetskiBytes(nativeCliVersion, extracted.steps);
}
