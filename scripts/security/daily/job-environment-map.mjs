import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const READER_COPY_ENVIRONMENTS = [
  'security-daily-control',
  'security-nightly',
  'security-seat-writer',
  'security-seat-admission',
  'security-seat-dispatch',
  'security-report-publish',
  'security-repair-publish',
  'security-repair-merge',
  'security-review-attest',
  'security-source-acquire',
  'security-ci-status',
  'security-promotion-control',
];

const ENVIRONMENT_PATTERN = /^security-[a-z-]+$/;
const SECRET_PATTERN = /^(SEAT_[A-Z0-9_]+|SEAT[A-Z_]*PLACEHOLDER[A-Z_]*|SECURITY_[A-Z0-9_]+)$/;

export function loadMap() {
  return JSON.parse(readFileSync(join(here, 'job-environment-map.json'), 'utf8'));
}

export function validateMap(map) {
  const errors = [];
  if (map.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  const seenJobs = new Set();
  const readerEnvs = new Set();
  for (const row of map.jobs ?? []) {
    if (seenJobs.has(row.job)) errors.push(`${row.job}: duplicate job entry`);
    seenJobs.add(row.job);
    if (typeof row.environment !== 'string' || !ENVIRONMENT_PATTERN.test(row.environment)) {
      errors.push(`${row.job}: exactly one security-* environment is required`);
    }
    if (row.inheritSecrets) errors.push(`${row.job}: secrets:inherit is forbidden`);
    for (const secret of row.secrets ?? []) {
      if (!SECRET_PATTERN.test(secret)) errors.push(`${row.job}: arbitrary secret name ${secret}`);
      if (secret === 'SECURITY_CONTROL_READER_TOKEN') readerEnvs.add(row.environment);
    }
  }
  const expected = [...READER_COPY_ENVIRONMENTS].sort();
  const actual = [...readerEnvs].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`reader copies must be exactly the twelve enumerated environments, got ${actual.join(',')}`);
  }
  for (const row of map.jobs ?? []) {
    for (const secret of row.secrets ?? []) {
      if (secret === 'SECURITY_CONTROL_PERMIT_SIGNING_KEY_PUBLIC' || secret === 'SECURITY_CONTROL_PERMIT_SIGNING_KEY_CUSTODY') {
        errors.push(`${row.job}: signing keys load only in fixed watcher steps, never as job secrets`);
      }
    }
  }
  const expectedPlacements = JSON.stringify([
    { key: 'SECURITY_CONTROL_PERMIT_SIGNING_KEY_PUBLIC', environment: 'security-daily-control' },
    { key: 'SECURITY_CONTROL_PERMIT_SIGNING_KEY_CUSTODY', environment: 'security-nightly' },
  ]);
  if (JSON.stringify(map.keyPlacements) !== expectedPlacements) {
    errors.push('signing-key placements must be exactly the scan key in security-daily-control and the seat key in security-nightly');
  }
  return errors;
}
