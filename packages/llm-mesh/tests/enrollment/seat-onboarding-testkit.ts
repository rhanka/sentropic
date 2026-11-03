//
// Synthetic fixtures shared by the seat-onboarding projection and
// materialization tests. Invented values only — never captured from a real
// profile (D10).

import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

import { SEAT_PACKAGE_PROVIDER_ID, type SeatBundleV1, type SeatCli } from '../../src/enrollment/seat-bundle.js';
import { SEAT_ENVELOPE_AUTH_FILES, type SeatOnboardingV1 } from '../../src/enrollment/seat-onboarding.js';

export function synthBundle(cli: SeatCli): SeatBundleV1 {
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
      nativeCliVersion: '1.4.12',
      os: 'linux',
    },
    provenance: { enrollmentSource: 'cli', accountBinding: `binding-synth-${cli}-01`, entitlementClass: 'lab-seat' },
    authority: 'consumer',
    credentialClass: 'access-only',
    lifecycle: {
      epoch: 1, generation: 1, operationId: `op-synth-${cli}-01`,
      issuedAt: '2026-10-15T00:00:00Z', providerExpiry: '2026-10-16T00:00:00Z',
      localExpiryPolicy: 'synthetic-policy-01', refreshAuthority: 'none',
    },
    meshUse: { kind: 'access', accessRef: `access-synth-${cli}-01` },
  };
}

export function synthEnvelope(cli: SeatCli, onboarding?: unknown): Record<string, unknown> {
  const files: Record<string, string> = {};
  for (const name of SEAT_ENVELOPE_AUTH_FILES[cli]) {
    files[name] = Buffer.from(`synthetic-${cli}-${name}`, 'utf8').toString('base64');
  }
  if (cli === 'claude') {
    // stage 1 enforces the minimized-projection key set on the auth .claude.json
    files['.claude.json'] = Buffer.from(JSON.stringify({
      oauthAccount: 'synthetic-oauth-account',
      hasCompletedOnboarding: true,
      lastOnboardingVersion: '2.1.0',
    })).toString('base64');
  }
  const env: Record<string, unknown> = { bundle: synthBundle(cli), files };
  if (cli === 'agy') {
    env.agy = {
      packageProviderId: 'cloud-code',
      packageAccountTransport: 'cloud-code',
      issuingClientRef: 'agy-cli',
      endpointFamily: 'antigravity',
      requestedTargetProviderId: 'cloudcode-pa',
      requestedTransportProviderId: 'antigravity',
    };
  }
  if (onboarding !== undefined) env.onboarding = onboarding;
  return env;
}

const DEST: Record<string, [string, string]> = {
  agy: ['agy-jetski', 'agy-jetski-pbtxt-v1'],
  claude: ['claude-json', 'claude-json-projection-v1'],
  muse: ['muse-trust', 'muse-trust-json-v1'],
  codex: ['codex-config', 'codex-config-projection-v1'],
};

export function synthBlock(cli: SeatCli, content: string, cellSynthesis: string[] = []): SeatOnboardingV1 {
  const [destKey, format] = DEST[cli];
  const buf = Buffer.from(content, 'utf8');
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
    cellSynthesis: cellSynthesis as SeatOnboardingV1['cellSynthesis'],
    files: [{
      destKey: destKey as never,
      format: format as never,
      contentBase64: buf.toString('base64'),
      sha256: createHash('sha256').update(buf).digest('hex'),
      byteLength: buf.length,
    }],
  };
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

export async function mkRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'seat-proj-'));
  roots.push(root);
  return root;
}

/** Oversize synthetic owner .claude.json: onboarding fields + oauthAccount + projects + history. */
export function oversizeClaudeJson(): string {
  const projects: Record<string, unknown> = {};
  for (let i = 0; i < 60; i += 1) projects[`/foreign/owner/path-${i}`] = { hasTrustDialogAccepted: i % 2 === 0 };
  const history = Array.from({ length: 2000 }, (_, i) => ({ role: 'user', content: `synthetic message ${i} `.repeat(8) }));
  return JSON.stringify({
    oauthAccount: 'synthetic-oauth-account',
    hasCompletedOnboarding: true,
    lastOnboardingVersion: '2.1.0',
    projects,
    history,
  });
}
