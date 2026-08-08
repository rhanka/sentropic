import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadOrCreateWindowsMachineIdentity } from '../src/enroll/index.js';

describe('Windows machine-bound Cowork identity', () => {
    it('fails closed when Windows DPAPI is unavailable instead of creating an exportable fallback key', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'cowork-dpapi-'));
        try {
            if (process.platform === 'win32') return;
            await expect(loadOrCreateWindowsMachineIdentity(dir)).rejects.toThrow(/requires Windows DPAPI/);
        } finally { await rm(dir, { recursive: true, force: true }); }
    });
});
