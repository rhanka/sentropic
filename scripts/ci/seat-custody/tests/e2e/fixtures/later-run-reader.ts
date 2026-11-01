// Cross-process later-run reader used by github-seat-roundtrip.test.ts: a freshly
// spawned process (the "newly queued N+1 job") reads back an immutable run snapshot
// written by the earlier run and applies the same read-back guards.
import { readFileSync } from 'node:fs';
import { readSnapshotSecret } from '../../../src/seat-environment-custody.ts';

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8')) as {
  snapshot: Record<string, Record<string, string>>;
  checks: { env: string; name: string; expect: 'value' | 'error'; code?: string }[];
};
const results = spec.checks.map(c => {
  try {
    const value = readSnapshotSecret(spec.snapshot, c.env, c.name);
    return { ok: c.expect === 'value', value };
  } catch (e) {
    const code = (e as Error).message;
    return { ok: c.expect === 'error' && code === c.code, code };
  }
});
process.stdout.write(JSON.stringify({ results }));
