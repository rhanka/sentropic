import { describe, expect, it } from 'vitest';
import { InMemoryKeyring } from '../../src/node/keyring/in-memory-keyring.js';
import {
  LocalAccountTransportService,
  SeatExportUnavailableError,
} from '../../src/service/local-account-transport-service.js';
import { createLlmMeshFacade } from '../../src/service/facade.js';
import {
  AGY_REQUIRED_COMPLETED_STEPS,
  canonicalAgyJetskiBytes,
  rebindSeatOnboarding,
  type SeatOnboardingV1,
} from '../../src/enrollment/seat-onboarding.js';
import type { SeatBundleV1, SeatCli } from '../../src/enrollment/seat-bundle.js';
import { synthBlock, synthBundle } from '../enrollment/seat-onboarding-testkit.js';

// L5T: the stored seat record and the facade export. Synthetic fixtures
// only (D10). The keyring read-only gates live in
// tests/node/encrypted-file-keyring.test.ts (PR #887) and are not
// duplicated here.

const OWNER = 'owner-synth-01';

const CONTENT: Record<string, string> = {
  agy: canonicalAgyJetskiBytes('1.4.12', AGY_REQUIRED_COMPLETED_STEPS['1.4.12']),
  claude: JSON.stringify({ hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.0' }),
  muse: JSON.stringify({ schema_version: 1 }),
  codex: JSON.stringify({ approvalPolicy: 'on-request', mcpServerNames: ['h2a'] }),
};

const SYNTH: Record<string, string[]> = {
  agy: [],
  claude: ['claude-workspace-trust'],
  muse: ['muse-workspace-trust'],
  codex: ['codex-project-trust'],
};

const blockFor = (cli: SeatCli): SeatOnboardingV1 =>
  synthBlock(cli, CONTENT[cli], SYNTH[cli] as never);

const serviceOn = (keyring = new InMemoryKeyring()) =>
  new LocalAccountTransportService(keyring, new Map(), { async resolveConfig() { return {}; } });

const accountIdFor = (cli: SeatCli): string => `seat-${cli}-${synthBundle(cli).identity.seatRef}`;

const seatRecordKey = (accountId: string): string => `sentropic-llm-mesh:${accountId}:seat-record`;

const nextBundle = (bundle: SeatBundleV1, generation: number, operationId: string): SeatBundleV1 => ({
  ...bundle,
  lifecycle: { ...bundle.lifecycle, generation, operationId },
});

describe('L5 stored seat record and export', () => {
  it('persists the record on import with a valid block and exports bundle + block verbatim', async () => {
    const keyring = new InMemoryKeyring();
    const service = serviceOn(keyring);
    const bundle = synthBundle('claude');
    const block = blockFor('claude');
    const imported = await service.importSeatBundle({ bundle, ownerScope: OWNER, onboarding: block });
    expect(imported.idempotent).toBe(false);

    const raw = await keyring.getSecret(seatRecordKey(imported.accountId));
    expect(raw).toBeTruthy();
    const record = JSON.parse(raw as string);
    expect(record.version).toBe(1);
    expect(record.bundle).toEqual(bundle);
    expect(record.onboarding).toEqual(block);
    expect(typeof record.storedAt).toBe('string');

    const exported = await service.exportSeatBundle({ accountId: imported.accountId, ownerScope: OWNER });
    expect(exported.bundle).toEqual(bundle);
    expect(exported.onboarding).toEqual(block);
    // No native auth files and no refresh material ever leave through
    // export: only bundle + onboarding, meshUse carries the access ref only
    // (the smuggled-refreshToken refusal is covered by the scan test below).
    expect(Object.keys(exported).sort()).toEqual(['bundle', 'onboarding']);
    expect(exported.bundle.meshUse).toEqual({ kind: 'access', accessRef: bundle.meshUse.accessRef });
    expect(JSON.stringify(exported)).not.toContain('"refreshToken"');
    expect(JSON.stringify(exported)).not.toContain('"sessionToken"');
    expect(JSON.stringify(exported)).not.toContain('"deviceCode"');
  });

  it('round-trips through the record across a restart', async () => {
    const keyring = new InMemoryKeyring();
    const bundle = synthBundle('codex');
    const block = blockFor('codex');
    const first = await serviceOn(keyring).importSeatBundle({ bundle, ownerScope: OWNER, onboarding: block });
    const restarted = serviceOn(keyring);
    const exported = await restarted.exportSeatBundle({ accountId: first.accountId, ownerScope: OWNER });
    expect(exported.bundle).toEqual(bundle);
    expect(exported.onboarding).toEqual(block);
  });

  it('exports the N+1 bundle and the rebound block with reboundFrom after a forward re-import', async () => {
    const service = serviceOn();
    const bundle = synthBundle('claude');
    const block = blockFor('claude');
    const first = await service.importSeatBundle({ bundle, ownerScope: OWNER, onboarding: block });
    expect(first.generation).toBe(1);

    const successor = nextBundle(bundle, 2, 'op-synth-claude-02');
    const rebound = rebindSeatOnboarding(block, successor, { reboundAt: '2026-11-02T12:00:00.000Z' });
    expect(rebound.ok).toBe(true);
    const second = await service.importSeatBundle({
      bundle: successor,
      ownerScope: OWNER,
      onboarding: rebound.ok ? rebound.block : undefined,
    });
    expect(second).toMatchObject({ generation: 2, idempotent: false });

    const exported = await service.exportSeatBundle({ accountId: first.accountId, ownerScope: OWNER });
    expect(exported.bundle).toEqual(successor);
    expect(exported.onboarding).toEqual({
      ...block,
      lineage: { epoch: 1, generation: 2, operationId: 'op-synth-claude-02' },
      reboundFrom: { epoch: 1, generation: 1, operationId: 'op-synth-claude-01' },
      reboundAt: '2026-11-02T12:00:00.000Z',
    });
  });

  it('refuses a forward re-import whose block was not rebound to the new lineage', async () => {
    const service = serviceOn();
    const bundle = synthBundle('claude');
    const block = blockFor('claude');
    await service.importSeatBundle({ bundle, ownerScope: OWNER, onboarding: block });
    const successor = nextBundle(bundle, 2, 'op-synth-claude-02');
    await expect(
      service.importSeatBundle({ bundle: successor, ownerScope: OWNER, onboarding: block }),
    ).rejects.toThrow(/onboarding/i);
    // The held record still exports the N values.
    const exported = await service.exportSeatBundle({ accountId: accountIdFor('claude'), ownerScope: OWNER });
    expect(exported.bundle).toEqual(bundle);
  });

  it('rejects an invalid block with no account registered at all', async () => {
    const keyring = new InMemoryKeyring();
    const service = serviceOn(keyring);
    const bundle = synthBundle('muse');
    const invalid = { ...blockFor('muse'), extraField: 1 };
    await expect(
      service.importSeatBundle({ bundle, ownerScope: OWNER, onboarding: invalid }),
    ).rejects.toThrow(/onboarding/i);
    expect(await service.listAccounts(OWNER)).toEqual([]);
    expect(await keyring.getSecret(`sentropic-llm-mesh:${accountIdFor('muse')}:public`)).toBeNull();
    expect(await keyring.getSecret(seatRecordKey(accountIdFor('muse')))).toBeNull();
  });

  it('rejects a misbound block (foreign seatRef) with no account registered', async () => {
    const keyring = new InMemoryKeyring();
    const service = serviceOn(keyring);
    const bundle = synthBundle('claude');
    const misbound = { ...blockFor('claude'), seatRef: 'seat-synth-claude-99' };
    await expect(
      service.importSeatBundle({ bundle, ownerScope: OWNER, onboarding: misbound }),
    ).rejects.toThrow(/onboarding/i);
    expect(await service.listAccounts(OWNER)).toEqual([]);
    expect(await keyring.getSecret(seatRecordKey(accountIdFor('claude')))).toBeNull();
  });

  it('imports without a block for mesh use and exports onboarding: null', async () => {
    const service = serviceOn();
    const bundle = synthBundle('agy');
    const imported = await service.importSeatBundle({ bundle, ownerScope: OWNER });
    expect(imported.idempotent).toBe(false);
    const exported = await service.exportSeatBundle({ accountId: imported.accountId, ownerScope: OWNER });
    expect(exported.bundle).toEqual(bundle);
    expect(exported.onboarding).toBeNull();
  });

  it('refuses export as record-missing for a pre-L5 marker-only account, then backfills on idempotent reimport', async () => {
    const keyring = new InMemoryKeyring();
    const service = serviceOn(keyring);
    const bundle = synthBundle('claude');
    const imported = await service.importSeatBundle({ bundle, ownerScope: OWNER });
    // Simulate a pre-L5 import: marker persisted, seat record never written.
    await keyring.deleteSecret(seatRecordKey(imported.accountId));

    await expect(
      service.exportSeatBundle({ accountId: imported.accountId, ownerScope: OWNER }),
    ).rejects.toMatchObject({ code: 'seat-export-unavailable:record-missing' });

    const block = blockFor('claude');
    const replay = await service.importSeatBundle({ bundle, ownerScope: OWNER, onboarding: block });
    expect(replay.idempotent).toBe(true);
    const exported = await service.exportSeatBundle({ accountId: imported.accountId, ownerScope: OWNER });
    expect(exported.bundle).toEqual(bundle);
    expect(exported.onboarding).toEqual(block);
  });

  it('refuses export as not-a-seat for a directly enrolled account', async () => {
    const service = serviceOn();
    service.registerAccount({
      accountId: 'acct-direct-01',
      ownerScopeRef: OWNER,
      accountLabel: 'direct',
      targetProviderId: 'anthropic',
      transportProviderId: 'claude-code',
      status: 'active',
      accessToken: 'synthetic-access',
    }, 'v1');
    await expect(
      service.exportSeatBundle({ accountId: 'acct-direct-01', ownerScope: OWNER }),
    ).rejects.toMatchObject({ code: 'seat-export-unavailable:not-a-seat' });
  });

  it('refuses export as not-a-seat for an unknown account', async () => {
    const service = serviceOn();
    await expect(
      service.exportSeatBundle({ accountId: 'seat-claude-never-imported', ownerScope: OWNER }),
    ).rejects.toBeInstanceOf(SeatExportUnavailableError);
    await expect(
      service.exportSeatBundle({ accountId: 'seat-claude-never-imported', ownerScope: OWNER }),
    ).rejects.toMatchObject({ code: 'seat-export-unavailable:not-a-seat' });
  });

  it('refuses a foreign ownerScope on export', async () => {
    const service = serviceOn();
    const bundle = synthBundle('claude');
    const imported = await service.importSeatBundle({ bundle, ownerScope: OWNER, onboarding: blockFor('claude') });
    await expect(
      service.exportSeatBundle({ accountId: imported.accountId, ownerScope: 'owner-other-01' }),
    ).rejects.toMatchObject({ code: 'seat-export-unavailable:owner-mismatch' });
  });

  it('refuses export when the stored record no longer matches the held marker lineage', async () => {
    const keyring = new InMemoryKeyring();
    const service = serviceOn(keyring);
    const bundle = synthBundle('claude');
    const imported = await service.importSeatBundle({ bundle, ownerScope: OWNER, onboarding: blockFor('claude') });
    // Tamper: record claims an older generation than the held marker.
    const stale = nextBundle(bundle, 0, 'op-tampered');
    await keyring.setSecret(seatRecordKey(imported.accountId), JSON.stringify({
      version: 1, bundle: stale, onboarding: null, storedAt: '2026-11-02T00:00:00.000Z',
    }));
    await expect(
      service.exportSeatBundle({ accountId: imported.accountId, ownerScope: OWNER }),
    ).rejects.toMatchObject({ code: 'seat-export-unavailable:lineage-mismatch' });
  });

  it('applies the refresh-material scan to the stored record on export', async () => {
    const keyring = new InMemoryKeyring();
    const service = serviceOn(keyring);
    const bundle = synthBundle('claude');
    const imported = await service.importSeatBundle({ bundle, ownerScope: OWNER, onboarding: blockFor('claude') });
    const smuggled = {
      ...bundle,
      meshUse: { kind: 'access', accessRef: bundle.meshUse.accessRef, refreshToken: 'smuggled-refresh' },
    };
    await keyring.setSecret(seatRecordKey(imported.accountId), JSON.stringify({
      version: 1, bundle: smuggled, onboarding: null, storedAt: '2026-11-02T00:00:00.000Z',
    }));
    await expect(
      service.exportSeatBundle({ accountId: imported.accountId, ownerScope: OWNER }),
    ).rejects.toMatchObject({ code: 'seat-export-unavailable:record-invalid' });
  });

  it('refuses export when the stored block is invalid', async () => {
    const keyring = new InMemoryKeyring();
    const service = serviceOn(keyring);
    const bundle = synthBundle('claude');
    const imported = await service.importSeatBundle({ bundle, ownerScope: OWNER, onboarding: blockFor('claude') });
    const broken = { ...blockFor('claude'), schemaVersion: 2 };
    await keyring.setSecret(seatRecordKey(imported.accountId), JSON.stringify({
      version: 1, bundle, onboarding: broken, storedAt: '2026-11-02T00:00:00.000Z',
    }));
    await expect(
      service.exportSeatBundle({ accountId: imported.accountId, ownerScope: OWNER }),
    ).rejects.toMatchObject({ code: 'seat-export-unavailable:record-invalid' });
  });

  it('deletes the seat record on account removal', async () => {
    const keyring = new InMemoryKeyring();
    const service = serviceOn(keyring);
    const bundle = synthBundle('claude');
    const imported = await service.importSeatBundle({ bundle, ownerScope: OWNER, onboarding: blockFor('claude') });
    expect(await keyring.getSecret(seatRecordKey(imported.accountId))).toBeTruthy();
    await service.removeAccount(imported.accountId, OWNER);
    expect(await keyring.getSecret(seatRecordKey(imported.accountId))).toBeNull();
    await expect(
      service.exportSeatBundle({ accountId: imported.accountId, ownerScope: OWNER }),
    ).rejects.toMatchObject({ code: 'seat-export-unavailable:not-a-seat' });
  });

  it('exposes import-with-block and export through the facade', async () => {
    const keyring = new InMemoryKeyring();
    const facade = createLlmMeshFacade({
      mode: 'portal',
      keyring,
      configResolver: { async resolveConfig() { return {}; } },
    });
    const bundle = synthBundle('muse');
    const block = blockFor('muse');
    const imported = await facade.importSeatBundle({ bundle, ownerScope: OWNER, onboarding: block });
    const exported = await facade.exportSeatBundle({ accountId: imported.accountId, ownerScope: OWNER });
    expect(exported.bundle).toEqual(bundle);
    expect(exported.onboarding).toEqual(block);
    await expect(
      facade.exportSeatBundle({ accountId: imported.accountId, ownerScope: 'owner-other-01' }),
    ).rejects.toMatchObject({ code: 'seat-export-unavailable:owner-mismatch' });
  });
});
