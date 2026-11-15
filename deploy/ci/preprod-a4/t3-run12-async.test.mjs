import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { supervisedAsync } from './t3-processes.mjs';
import { runKubectl } from './t3-lib.mjs';

test('R12 MIN-6: supervisedAsync captures cleanupRecord failure in close handler and resolves without uncaught exception', async () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-r12-min6-'));
  const uncaught = [];
  const onUncaught = err => { uncaught.push(err); };
  process.on('uncaughtException', onUncaught);
  try {
    const script = `for f in '${dir}'/.t3-command-*.pgid; do rm -f "$f" && mkdir "$f"; done; printf ok`;
    const res = await Promise.race([
      supervisedAsync('sh', ['-c', script], {}, dir),
      new Promise((_, reject) => setTimeout(() => reject(new Error('close_handler_threw_without_resolving')), 1500)),
    ]);
    assert.deepEqual(uncaught.map(e => e.code ?? e.message), [], 'close handler must never emit uncaughtException');
    assert.equal(res.status, 0);
    assert.equal(res.stdout, 'ok');
    assert.equal(res.error?.code, 'EISDIR');
    for (const n of readdirSync(dir)) rmSync(join(dir, n), { recursive: true, force: true });

    const savedPath = process.env.PATH;
    writeFileSync(join(dir, 'kubectl'), `#!/bin/sh\nfor f in '${dir}'/.t3-command-*.pgid; do rm -f "$f" && mkdir "$f"; done\nexit 0\n`, { mode: 0o755 });
    process.env.PATH = `${dir}:${savedPath}`;
    try {
      const call = runKubectl({ kubeconfig: '/private/kube', namespace: 'sentropic-preprod', stateDir: dir });
      await assert.rejects(
        Promise.race([
          call.async(['get', 'pods']),
          new Promise((_, reject) => setTimeout(() => reject(new Error('runKubectl_async_hung')), 1500)),
        ]),
        err => err.message.startsWith('kubectl_failed:') && /EISDIR/.test(String(err.cause)),
      );
      assert.equal(uncaught.length, 0);
    } finally {
      process.env.PATH = savedPath;
    }
  } finally {
    process.off('uncaughtException', onUncaught);
    rmSync(dir, { recursive: true, force: true });
  }
});
