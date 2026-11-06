import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['dist/index.js', '--cm-preprod-checkpoint'], {
  encoding: 'utf8', input: '{"phase":"invalid"}', timeout: 30_000,
  env: { ...process.env, NODE_ENV: 'test', SCW_TEM_SECRET_KEY: 'a4-isolated-synthetic',
    DATABASE_URL: 'postgres://synthetic:synthetic@127.0.0.1:1/synthetic' },
});
assert.equal(result.status, 1);
assert.equal(result.stdout, '');
assert.match(result.stderr, /^failureSha256=[a-f0-9]{64}\n$/);
console.log('PASS: bundled preparation entrypoint exits before migrations and emits only a failure digest');
