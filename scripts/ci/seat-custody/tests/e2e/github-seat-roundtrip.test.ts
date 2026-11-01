// T5-C2 / T6-C2 later-run probes (r6 §6.4: real later-run probes live in this E2E
// suite). Synthetic environment-secret payloads prove the acknowledged canonical →
// projection → newly queued N+1 job roundtrip, including a genuine cross-process
// snapshot read-back. Live GitHub probes are gated: without SEAT_LIVE_ROUNDTRIP=1 the
// suite refuses to claim any live platform evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPOSITORY, SyntheticEnvironmentApi, canonicalProjectionRoundtrip, readSnapshotSecret, sealSecret,
} from '../../src/seat-environment-custody.ts';

const here = dirname(fileURLToPath(import.meta.url));
// The suite runs as .ts under the pinned Node 24 image (type stripping); the local
// transpile loop runs the .js build, so resolve whichever exists.
const fixture = [join(here, 'fixtures', 'later-run-reader.js'), join(here, 'fixtures', 'later-run-reader.ts')]
  .find(p => existsSync(p))!;

function liveGate(): void {
  if (process.env.SEAT_LIVE_ROUNDTRIP !== '1') throw new Error('live-probes-disabled');
  if (!process.env.SEAT_LIVE_TOKEN_PRESENT) throw new Error('live-token-missing');
}

test('T5-C2: synthetic canonical → projection → N+1 roundtrip acknowledges and the original run stays stale', async () => {
  const api = new SyntheticEnvironmentApi({ repository: REPOSITORY });
  const result = await canonicalProjectionRoundtrip(api, {
    cli: 'codex', slot: '01', writerRunId: 'run-writer', writerRunAttempt: 1,
  });
  assert.equal(result.nPlusOne, true);
  assert.equal(result.originalRunStale, true);
  assert.match(result.queuedRunId, /^run-\d+$/);
});

test('T5-C2/T6-C2: a newly queued run reads the projection back cross-process; the earlier run cannot', async () => {
  const api = new SyntheticEnvironmentApi({ repository: REPOSITORY });
  const before = await api.queueWorkflow({ workflowId: 'security-seat-maintenance.yml', ref: 'refs/heads/main' });
  const result = await canonicalProjectionRoundtrip(api, {
    cli: 'vibe', slot: '02', writerRunId: 'run-writer', writerRunAttempt: 1,
  });
  const freshSnap = await api.snapshot(result.queuedRunId);
  const staleSnap = await api.snapshot(before.runId);
  const dir = mkdtempSync(join(tmpdir(), 'l03a-roundtrip-'));
  const specPath = join(dir, 'spec.json');
  writeFileSync(specPath, JSON.stringify({
    snapshot: freshSnap,
    checks: [
      { env: 'security-nightly', name: 'SEAT_USE_VIBE_02', expect: 'value' },
      { env: 'security-nightly', name: 'SEAT_STATE_HEAD', expect: 'error', code: 'writer-native-separation' },
      { env: 'security-nightly', name: 'SEAT_USE_CODEX_01', expect: 'error', code: 'secret-unavailable' },
    ],
  }));
  const child = spawnSync(process.execPath, [fixture, specPath], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const out = JSON.parse(child.stdout) as { results: { ok: boolean }[] };
  assert.deepEqual(out.results.map(r => r.ok), [true, true, true]);
  // The earlier run's snapshot (same process guard) must not contain the projection.
  assert.throws(() => readSnapshotSecret(staleSnap, 'security-nightly', 'SEAT_USE_VIBE_02'), /secret-unavailable/);
  assert.equal(readSnapshotSecret(freshSnap, 'security-nightly', 'SEAT_USE_VIBE_02'), 'synthetic-projection-vibe-02');
});

test('T5-C2: same-run/stale-rerun, wrong-repository and unprotected-ref probes refuse', async () => {
  const api = new SyntheticEnvironmentApi({ repository: REPOSITORY });
  await assert.rejects(
    canonicalProjectionRoundtrip(api, { cli: 'muse', slot: '03', writerRunId: 'r', writerRunAttempt: 1, sameRun: true }),
    /same-run-dependent/,
  );
  await assert.rejects(
    canonicalProjectionRoundtrip(api, { cli: 'muse', slot: '03', writerRunId: 'r', writerRunAttempt: 1, wrongGeneration: true }),
    /generation-mismatch/,
  );
  await assert.rejects(
    canonicalProjectionRoundtrip(api, { cli: 'muse', slot: '03', writerRunId: 'r', writerRunAttempt: 1, refreshBearing: true }),
    /refresh-bearing-projection/,
  );
  await assert.rejects(
    canonicalProjectionRoundtrip(api, { cli: 'muse', slot: '03', writerRunId: 'r', writerRunAttempt: 1, projectionFirst: true }),
    /canonical-before-projection/,
  );
  await assert.rejects(api.queueWorkflow({ workflowId: 'x.yml', ref: 'refs/pull/1/merge' }), /unprotected-ref/);
  const other = new SyntheticEnvironmentApi({ repository: 'other/repo' });
  const key = await api.publicKey('security-nightly');
  await assert.rejects(
    other.putSealed('security-nightly', 'SEAT_USE_MUSE_03', sealSecret(key.pem, key.keyId, 'x'), { runId: 'r', runAttempt: 1, repository: REPOSITORY }),
    /repository-mismatch/,
  );
});

test('T6-C2: live platform probes are gated and refuse to claim evidence without the explicit gate', () => {
  assert.throws(() => liveGate(), /live-probes-disabled/);
  process.env.SEAT_LIVE_ROUNDTRIP = '1';
  try {
    assert.throws(() => liveGate(), /live-token-missing/);
  } finally {
    delete process.env.SEAT_LIVE_ROUNDTRIP;
  }
  assert.throws(() => liveGate(), /live-probes-disabled/);
});
