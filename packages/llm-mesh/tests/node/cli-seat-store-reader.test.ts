import { describe, expect, it, vi } from 'vitest';
import {
  inspectSeatStoreRecord,
  type SeatRecordSelector,
  type SeatStoreBackend,
} from '../../src/node/cli-seat-store-reader.js';
import type { SeatCli } from '../../src/enrollment/seat-bundle.js';

const CLIS: SeatCli[] = ['agy', 'codex', 'vibe', 'muse', 'claude'];

// Synthetic canary material: the reader must never surface it raw or encoded.
const CANARY = 'canary-secret-value-9f2c';

const syntheticBackend = (cli: SeatCli, read = vi.fn(async (_selector: SeatRecordSelector) => ({
  schemaVersion: 'v1-synth',
  credentialClass: 'renewable' as const,
  refreshCapable: true as const,
  supported: true as const,
}))): SeatStoreBackend => ({
  cli,
  backend: 'synthetic',
  readSelectedRecord: read,
});

describe('cli-seat-store-reader', () => {
  it.each(CLIS)('inspects only the selected %s lab record', async (cli) => {
    const reads = new Map<SeatCli, ReturnType<typeof vi.fn>>();
    const backends = CLIS.map((candidate) => {
      const read = vi.fn(async () => ({
        schemaVersion: 'v1-synth',
        credentialClass: 'renewable' as const,
        refreshCapable: true as const,
        supported: true as const,
      }));
      reads.set(candidate, read);
      return syntheticBackend(candidate, read);
    });
    const descriptor = await inspectSeatStoreRecord(backends, { cli, profileLabel: `lab-${cli}-01` });
    expect(descriptor).toMatchObject({ cli, profileLabel: `lab-${cli}-01`, supported: true });
    for (const [candidate, read] of reads) {
      expect(read).toHaveBeenCalledTimes(candidate === cli ? 1 : 0);
    }
  });

  it('requires a non-empty lab profile label and never defaults to a daily profile', async () => {
    const backends = CLIS.map((cli) => syntheticBackend(cli));
    await expect(inspectSeatStoreRecord(backends, { cli: 'codex', profileLabel: '' })).rejects.toThrow(
      /non-empty lab profile label/,
    );
  });

  it('returns unverified/refused for missing backends and records', async () => {
    expect(await inspectSeatStoreRecord([], { cli: 'agy', profileLabel: 'lab-agy-01' })).toMatchObject({
      supported: false,
    });
    const backends = [syntheticBackend('vibe', vi.fn(async () => null))];
    const descriptor = await inspectSeatStoreRecord(backends, { cli: 'vibe', profileLabel: 'lab-vibe-01' });
    expect(descriptor).toMatchObject({ supported: false, reason: 'selected lab record not found' });
  });

  it('never forwards backend prose: refusal reasons are reader-fixed', async () => {
    const proseBackend: SeatStoreBackend = {
      cli: 'agy',
      backend: 'synthetic',
      readSelectedRecord: async () => ({
        schemaVersion: 'v1-synth',
        credentialClass: 'unknown' as const,
        refreshCapable: null,
        supported: false as const,
        reason: `refused because ${CANARY}`,
      }),
    };
    const descriptor = await inspectSeatStoreRecord([proseBackend], { cli: 'agy', profileLabel: 'lab-agy-01' });
    expect(descriptor.supported).toBe(false);
    expect(JSON.stringify(descriptor)).not.toContain(CANARY);
    expect(descriptor.reason).toBe('backend refused the selected lab record');
  });

  it('never leaks raw or encoded canary material through results or errors', async () => {
    const encoded = Buffer.from(CANARY, 'utf8').toString('base64');
    const hostile = {
      schemaVersion: 'v1-synth',
      credentialClass: 'unknown' as const,
      refreshCapable: null,
      supported: false as const,
      reason: 'refused category',
      secretMaterial: CANARY,
      nested: { token: CANARY, encoded },
    };
    const backends = CLIS.map((cli) => syntheticBackend(cli, vi.fn(async () => hostile)));
    const outputs: string[] = [];
    for (const cli of CLIS) {
      try {
        const descriptor = await inspectSeatStoreRecord(backends, { cli, profileLabel: `lab-${cli}-01` });
        expect(Object.keys(descriptor).sort()).toEqual(
          ['backend', 'cli', 'credentialClass', 'profileLabel', 'reason', 'refreshCapable', 'schemaVersion', 'supported'],
        );
        outputs.push(JSON.stringify(descriptor));
      } catch (error) {
        outputs.push(String(error));
      }
    }
    const combined = outputs.join('\n');
    expect(combined).not.toContain(CANARY);
    expect(combined).not.toContain(encoded);
  });
});
