import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadMap,
  validateMap,
  READER_COPY_ENVIRONMENTS,
} from './job-environment-map.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const workflowPath = join(repoRoot, '.github', 'workflows', 'security-report-control.yml');

describe('T5-C1: one environment per job, complete section 4.1 role set', () => {
  it('manifest loads and validates clean', () => {
    const map = loadMap();
    assert.deepEqual(validateMap(map), []);
  });

  it('reader-token copies are exactly the twelve enumerated environments', () => {
    assert.equal(READER_COPY_ENVIRONMENTS.length, 12);
    const map = loadMap();
    const errors = validateMap(map);
    assert.deepEqual(errors, []);
    const copyEnvs = new Set();
    for (const row of map.jobs) {
      for (const secret of row.secrets) {
        if (secret === 'SECURITY_CONTROL_READER_TOKEN') copyEnvs.add(row.environment);
      }
    }
    assert.deepEqual([...copyEnvs].sort(), [...READER_COPY_ENVIRONMENTS].sort());
  });

  it('scan and seat signing keys live in exactly one environment each', () => {
    const map = loadMap();
    assert.deepEqual(map.keyPlacements, [
      { key: 'SECURITY_CONTROL_PERMIT_SIGNING_KEY_PUBLIC', environment: 'security-daily-control' },
      { key: 'SECURITY_CONTROL_PERMIT_SIGNING_KEY_CUSTODY', environment: 'security-nightly' },
    ]);
  });

  it('no row uses secrets:inherit, caller-chosen names or second environments', () => {
    const map = loadMap();
    for (const row of map.jobs) {
      assert.ok(!row.inheritSecrets, `${row.job} must not inherit secrets`);
      assert.ok(typeof row.environment === 'string' && row.environment.length > 0, row.job);
      assert.ok(!Array.isArray(row.environment), `${row.job} must request exactly one environment`);
    }
  });
});

describe('T6-C1: emitted workflow matches the manifest for L08a jobs', () => {
  it('workflow file exists', () => {
    assert.ok(existsSync(workflowPath), 'security-report-control.yml must exist');
  });

  it('every L08a job declares exactly its mapped environment', () => {
    const text = readFileSync(workflowPath, 'utf8');
    const map = loadMap();
    const l08aJobs = map.jobs.filter((r) => r.workflow === 'security-report-control.yml' && r.lots.includes('ACT-L08a'));
    assert.ok(l08aJobs.length >= 3, 'L08a must own at least deadline-record, control-receipt and fence writers');
    for (const row of l08aJobs) {
      const block = new RegExp(`${row.job}:[\\s\\S]*?environment:\\s*${row.environment}\\b`);
      assert.match(text, block, `${row.job} must request exactly ${row.environment}`);
    }
  });

  it('workflow carries no hostile trigger or credential leak', () => {
    const text = readFileSync(workflowPath, 'utf8');
    assert.ok(!text.includes('pull_request_target'), 'candidate execution via pull_request_target is forbidden');
    assert.ok(!text.includes('secrets: inherit'), 'secret inheritance is forbidden');
  });
});
