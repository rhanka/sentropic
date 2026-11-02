import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SEAT_PACKAGE_PROVIDER_ID,
  type SeatBundleV1,
  type SeatCli,
} from '../../src/enrollment/seat-bundle.js';
import {
  AGY_REQUIRED_COMPLETED_STEPS,
  SEAT_ENVELOPE_AUTH_FILES,
  SEAT_ONBOARDING_MAX_BYTES,
  type SeatCellSynthesis,
  type SeatOnboardingDestKey,
  type SeatOnboardingFile,
  type SeatOnboardingFormat,
  type SeatOnboardingV1,
  rebindSeatOnboarding,
  seatLaunchGate,
  validateSeatEnvelope,
  validateSeatOnboarding,
} from '../../src/enrollment/seat-onboarding.js';

const CLIS: SeatCli[] = ['agy', 'codex', 'vibe', 'muse', 'claude'];
const GATED: SeatCli[] = ['agy', 'claude', 'muse', 'codex'];

const AGY_STEPS = AGY_REQUIRED_COMPLETED_STEPS['1.4.12'];
const AGY_CANONICAL = `post_onboarding {\n${AGY_STEPS.map((s) => `  completed_steps: ${s}\n`).join('')}}\n`;

const DEST: Record<string, [SeatOnboardingDestKey, SeatOnboardingFormat]> = {
  agy: ['agy-jetski', 'agy-jetski-pbtxt-v1'],
  claude: ['claude-json', 'claude-json-projection-v1'],
  muse: ['muse-trust', 'muse-trust-json-v1'],
  codex: ['codex-config', 'codex-config-projection-v1'],
};
const SYNTH: Record<string, SeatCellSynthesis> = {
  claude: 'claude-workspace-trust',
  muse: 'muse-workspace-trust',
  codex: 'codex-project-trust',
};
const CONTENT: Record<string, string> = {
  agy: AGY_CANONICAL,
  claude: JSON.stringify({ hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.0' }),
  muse: JSON.stringify({ schema_version: 1 }),
  codex: JSON.stringify({ approvalPolicy: 'on-request', mcpServerNames: ['h2a'] }),
};

export function consumerBundle(cli: SeatCli, nativeCliVersion = '1.4.12'): SeatBundleV1 {
  return {
    identity: {
      schemaVersion: 1,
      seatRef: `seat-synth-${cli}-01`,
      refreshFamilyRef: `family-synth-${cli}-01`,
      ownerScope: 'owner-synth-01',
      cli,
      packageProviderId: SEAT_PACKAGE_PROVIDER_ID[cli],
      issuingClientRef: `client-synth-${cli}-01`,
      endpointFamily: `endpoint-synth-${cli}-01`,
      credentialFormatVersion: 'v1',
      nativeCliVersion,
      os: 'linux',
    },
    provenance: {
      enrollmentSource: 'cli',
      accountBinding: `binding-synth-${cli}-01`,
      entitlementClass: 'lab-seat',
    },
    authority: 'consumer',
    credentialClass: 'access-only',
    lifecycle: {
      epoch: 1,
      generation: 1,
      operationId: `op-synth-${cli}-01`,
      issuedAt: '2026-10-15T00:00:00Z',
      providerExpiry: '2026-10-16T00:00:00Z',
      localExpiryPolicy: 'synthetic-policy-01',
      refreshAuthority: 'none',
    },
    meshUse: { kind: 'access', accessRef: `access-synth-${cli}-01` },
  };
}

export function onboardingFile(destKey: SeatOnboardingDestKey, format: SeatOnboardingFormat, content: string): SeatOnboardingFile {
  const buf = Buffer.from(content, 'utf8');
  return {
    destKey,
    format,
    contentBase64: buf.toString('base64'),
    sha256: createHash('sha256').update(buf).digest('hex'),
    byteLength: buf.length,
  };
}

export function synthBlock(cli: SeatCli, overrides: Partial<SeatOnboardingV1> = {}): SeatOnboardingV1 {
  const [destKey, format] = DEST[cli];
  return {
    schemaVersion: 1,
    cli,
    seatRef: `seat-synth-${cli}-01`,
    accountBinding: `binding-synth-${cli}-01`,
    accountBindingBasis: 'custodian-stable-ref',
    lineage: { epoch: 1, generation: 1, operationId: `op-synth-${cli}-01` },
    nativeCliVersion: '1.4.12',
    os: 'linux',
    capturedAt: '2026-11-02T00:00:00Z',
    consent: { source: 'owner-interactive-cli', ownerScope: 'owner-synth-01' },
    cellSynthesis: cli === 'agy' ? [] : [SYNTH[cli]],
    files: [onboardingFile(destKey, format, CONTENT[cli])],
    ...overrides,
  };
}

describe('validateSeatOnboarding', () => {
  it.each(['agy', 'claude', 'muse', 'codex'] as const)('accepts a valid synthetic %s block', (cli) => {
    const result = validateSeatOnboarding(synthBlock(cli));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.block.cli).toBe(cli);
  });

  it('refuses a vibe block as shape-unverified (no v1 allowlist entry)', () => {
    const result = validateSeatOnboarding({ ...synthBlock('agy'), cli: 'vibe' });
    expect(result).toMatchObject({ ok: false, code: 'onboarding-shape-unverified' });
  });

  it('refuses an unknown top-level key', () => {
    const result = validateSeatOnboarding({ ...synthBlock('agy'), extra: 1 });
    expect(result).toMatchObject({ ok: false, code: 'onboarding-unknown-field' });
  });

  it('refuses an unknown nested key in consent and files', () => {
    const nested = validateSeatOnboarding({
      ...synthBlock('agy'),
      consent: { source: 'owner-interactive-cli', ownerScope: 'owner-synth-01', extra: true },
    });
    expect(nested).toMatchObject({ ok: false, code: 'onboarding-unknown-field' });
    const fileKey = validateSeatOnboarding({
      ...synthBlock('agy'),
      files: [{ ...synthBlock('agy').files[0], relPath: 'x' }],
    });
    expect(fileKey).toMatchObject({ ok: false, code: 'onboarding-unknown-field' });
  });

  it('refuses a block over the 4 KiB bound', () => {
    const big = synthBlock('codex', {
      files: [onboardingFile('codex-config', 'codex-config-projection-v1', CONTENT.codex)],
    });
    const padded = { ...big, seatRef: 'x'.repeat(SEAT_ONBOARDING_MAX_BYTES) };
    const result = validateSeatOnboarding(padded);
    expect(result).toMatchObject({ ok: false, code: 'onboarding-size-exceeded' });
  });

  it('refuses a digest or byteLength mismatch', () => {
    const base = synthBlock('agy');
    const badDigest = validateSeatOnboarding({
      ...base,
      files: [{ ...base.files[0], sha256: '0'.repeat(64) }],
    });
    expect(badDigest).toMatchObject({ ok: false, code: 'onboarding-shape-unverified' });
    const badLength = validateSeatOnboarding({
      ...base,
      files: [{ ...base.files[0], byteLength: base.files[0].byteLength + 1 }],
    });
    expect(badLength).toMatchObject({ ok: false, code: 'onboarding-shape-unverified' });
  });

  it('refuses a partial agy step set as onboarding-incomplete', () => {
    const partial = `post_onboarding {\n  completed_steps: ${AGY_STEPS[0]}\n}\n`;
    const result = validateSeatOnboarding(
      synthBlock('agy', { files: [onboardingFile('agy-jetski', 'agy-jetski-pbtxt-v1', partial)] }),
    );
    expect(result).toMatchObject({ ok: false, code: 'onboarding-incomplete' });
  });

  it('refuses a non custodian-stable-ref basis', () => {
    const result = validateSeatOnboarding(
      synthBlock('agy', { accountBindingBasis: 'login-bytes-hash' as never }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(['onboarding-schema-mismatch', 'onboarding-binding-unverifiable']).toContain(result.code);
  });

  it('refuses an agy version with no required-step table entry', () => {
    const result = validateSeatOnboarding(synthBlock('agy', { nativeCliVersion: '9.9.9' }));
    expect(result).toMatchObject({ ok: false, code: 'onboarding-shape-unverified' });
  });

  it('refuses a string scalar inside the agy block as identifier-present', () => {
    const withUuid = `post_onboarding {\n${AGY_STEPS.map((s) => `  completed_steps: ${s}\n`).join('')}}\ninstallation_uuid: "synthetic-uuid"\n`;
    const result = validateSeatOnboarding(
      synthBlock('agy', { files: [onboardingFile('agy-jetski', 'agy-jetski-pbtxt-v1', withUuid)] }),
    );
    expect(result).toMatchObject({ ok: false, code: 'onboarding-identifier-present' });
  });

  it('refuses cellSynthesis entries foreign to the block CLI', () => {
    const result = validateSeatOnboarding(synthBlock('claude', { cellSynthesis: ['muse-workspace-trust'] }));
    expect(result).toMatchObject({ ok: false, code: 'onboarding-shape-unverified' });
    const agyTrust = validateSeatOnboarding(synthBlock('agy', { cellSynthesis: ['claude-workspace-trust'] }));
    expect(agyTrust).toMatchObject({ ok: false, code: 'onboarding-shape-unverified' });
  });

});

describe('validateSeatOnboarding formats', () => {
  it('refuses malformed per-format content', () => {
    const claudeExtra = validateSeatOnboarding(synthBlock('claude', { files: [onboardingFile('claude-json', 'claude-json-projection-v1', JSON.stringify({ hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.0', oauthAccount: 'x' }))] }));
    expect(claudeExtra).toMatchObject({ ok: false, code: 'onboarding-shape-unverified' });
    const claudeVersion = validateSeatOnboarding(synthBlock('claude', { files: [onboardingFile('claude-json', 'claude-json-projection-v1', JSON.stringify({ hasCompletedOnboarding: true, lastOnboardingVersion: '2.1' }))] }));
    expect(claudeVersion).toMatchObject({ ok: false, code: 'onboarding-shape-unverified' });
    const museSchema = validateSeatOnboarding(synthBlock('muse', { files: [onboardingFile('muse-trust', 'muse-trust-json-v1', JSON.stringify({ schema_version: 999 }))] }));
    expect(museSchema).toMatchObject({ ok: false, code: 'onboarding-shape-unverified' });
    const codexPolicy = validateSeatOnboarding(synthBlock('codex', { files: [onboardingFile('codex-config', 'codex-config-projection-v1', JSON.stringify({ approvalPolicy: 'always', mcpServerNames: ['h2a'] }))] }));
    expect(codexPolicy).toMatchObject({ ok: false, code: 'onboarding-shape-unverified' });
  });

  it('refuses a wrong destKey or format for the CLI', () => {
    const result = validateSeatOnboarding(synthBlock('agy', { files: [onboardingFile('muse-trust', 'muse-trust-json-v1', CONTENT.muse)] }));
    expect(result).toMatchObject({ ok: false, code: 'onboarding-shape-unverified' });
  });
});

export function synthEnvelope(cli: SeatCli, onboarding?: unknown): Record<string, unknown> {
  const bundle = consumerBundle(cli);
  const files: Record<string, string> = {};
  for (const name of SEAT_ENVELOPE_AUTH_FILES[cli]) {
    files[name] = Buffer.from(`synthetic-${cli}-${name}`, 'utf8').toString('base64');
  }
  const envelope: Record<string, unknown> = { bundle, files };
  if (cli === 'agy') {
    envelope.agy = {
      packageProviderId: 'cloud-code',
      packageAccountTransport: 'cloud-code',
      issuingClientRef: 'agy-cli',
      endpointFamily: 'antigravity',
      requestedTargetProviderId: 'cloudcode-pa',
      requestedTransportProviderId: 'antigravity',
    };
  }
  if (onboarding !== undefined) envelope.onboarding = onboarding;
  return envelope;
}

describe('validateSeatEnvelope', () => {
  it.each(['agy', 'claude', 'muse', 'codex'] as const)('accepts a valid %s envelope with a block', (cli) => {
    const result = validateSeatEnvelope(synthEnvelope(cli, synthBlock(cli)));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.onboardingStatus).toBe('present');
      expect(result.launchGate).toEqual({ eligible: true });
    }
  });

  it.each(CLIS)('accepts an absent block for %s and derives onboardingStatus absent', (cli) => {
    const result = validateSeatEnvelope(synthEnvelope(cli));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.onboardingStatus).toBe('absent');
  });

  it('refuses a lineage mismatch between block and bundle', () => {
    const result = validateSeatEnvelope(synthEnvelope('agy', synthBlock('agy', { lineage: { epoch: 1, generation: 2, operationId: 'op-other' } })));
    expect(result).toMatchObject({ ok: false, code: 'onboarding-lineage-mismatch' });
  });

  it('refuses when the bundle lacks nativeCliVersion but a block is present', () => {
    const bundle = consumerBundle('agy');
    delete (bundle.identity as Record<string, unknown>).nativeCliVersion;
    const env = { ...synthEnvelope('agy', synthBlock('agy')), bundle };
    const result = validateSeatEnvelope(env);
    expect(result).toMatchObject({ ok: false, code: 'onboarding-version-mismatch' });
  });

  it('refuses an envelope over the 48 KiB bound', () => {
    const env = synthEnvelope('codex', synthBlock('codex'));
    (env.files as Record<string, string>)['.codex/auth.json'] = 'x'.repeat(60 * 1024);
    const result = validateSeatEnvelope(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('size-exceeded');
  });

  it('refuses a present block on a vibe bundle as shape-unverified', () => {
    const result = validateSeatEnvelope(synthEnvelope('vibe', synthBlock('agy')));
    expect(result).toMatchObject({ ok: false, code: 'onboarding-shape-unverified' });
  });

  it('never returns onboarding-required itself', () => {
    for (const cli of CLIS) {
      const absent = validateSeatEnvelope(synthEnvelope(cli));
      if (!absent.ok) throw new Error('absent block must validate');
      expect(absent.onboardingStatus).toBe('absent');
    }
  });

  it('refuses an auth file outside the allowlist', () => {
    const env = synthEnvelope('agy');
    (env.files as Record<string, string>)['.gemini/settings.json'] = Buffer.from('x').toString('base64');
    const result = validateSeatEnvelope(env);
    expect(result.ok).toBe(false);
  });
});

describe('seatLaunchGate', () => {
  it.each(GATED)('closes the gate for absent %s with onboarding-required', (cli) => {
    expect(seatLaunchGate(cli, 'absent')).toEqual({ eligible: false, code: 'onboarding-required' });
  });
  it('keeps vibe absent eligible and every present block eligible', () => {
    expect(seatLaunchGate('vibe', 'absent')).toEqual({ eligible: true });
    for (const cli of CLIS) expect(seatLaunchGate(cli, 'present')).toEqual({ eligible: true });
  });
});

describe('rebindSeatOnboarding', () => {
  const next = (over: Partial<SeatBundleV1> = {}) => ({
    ...consumerBundle('agy'),
    lifecycle: { ...consumerBundle('agy').lifecycle, generation: 2, operationId: 'op-synth-agy-02' },
    ...over,
  });

  it('accepts a same-epoch forward transition and moves only the lineage pointer', () => {
    const block = synthBlock('agy');
    const result = rebindSeatOnboarding(block, next(), { reboundAt: '2026-11-02T01:00:00Z' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.block.lineage).toEqual({ epoch: 1, generation: 2, operationId: 'op-synth-agy-02' });
      expect(result.block.reboundFrom).toEqual(block.lineage);
      expect(result.block.reboundAt).toBe('2026-11-02T01:00:00Z');
      expect(result.block.files).toEqual(block.files);
      expect(result.block.capturedAt).toBe(block.capturedAt);
    }
  });

  it('refuses epoch change, version change, digest change and account change', () => {
    const block = synthBlock('agy');
    const epoch = rebindSeatOnboarding(block, next({ lifecycle: { ...next().lifecycle, epoch: 2 } }), { reboundAt: '2026-11-02T01:00:00Z' });
    expect(epoch).toMatchObject({ ok: false, code: 'onboarding-lineage-mismatch' });
    const version = rebindSeatOnboarding(block, next({ identity: { ...next().identity, nativeCliVersion: '1.4.13' } }), { reboundAt: '2026-11-02T01:00:00Z' });
    expect(version).toMatchObject({ ok: false, code: 'onboarding-version-mismatch' });
    const account = rebindSeatOnboarding(block, next({ provenance: { ...next().provenance, accountBinding: 'other-account' } }), { reboundAt: '2026-11-02T01:00:00Z' });
    expect(account).toMatchObject({ ok: false, code: 'onboarding-lineage-mismatch' });
    const digest = rebindSeatOnboarding(block, next(), {
      reboundAt: '2026-11-02T01:00:00Z',
      files: [{ ...block.files[0], sha256: '1'.repeat(64) }],
    });
    expect(digest).toMatchObject({ ok: false, code: 'onboarding-shape-unverified' });
  });
});
