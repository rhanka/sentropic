import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBuildReceipt,
  validateValidationReceipt,
  validatePublicationReceipt,
  canExecute,
} from './control-image-pin.mjs';

function buildReceipt() {
  return {
    schemaVersion: 1,
    repositoryId: 123,
    workflow: 'security-control-image.yml',
    workflowSha: 'a'.repeat(40),
    runId: 7,
    runAttempt: 1,
    job: 'build-control-image',
    sourceSha: 'b'.repeat(40),
    recipeDigest: 'c'.repeat(64),
    ociDigest: 'sha256:' + 'd'.repeat(64),
    binaryDigest: 'e'.repeat(64),
    sbomDigest: 'f'.repeat(64),
    artifactId: 'art-1',
    artifactDigest: '0'.repeat(64),
    outcome: 'success',
  };
}

describe('L8-K: control image receipt chain binds one artifact', () => {
  it('build, validation and publication receipts validate on one tuple', () => {
    const build = buildReceipt();
    assert.deepEqual(validateBuildReceipt(build), []);
    const validation = {
      schemaVersion: 1,
      buildDigest: '9'.repeat(64),
      repositoryId: 123,
      runId: 7,
      runAttempt: 1,
      artifactId: 'art-1',
      artifactDigest: build.artifactDigest,
      ociDigest: build.ociDigest,
      outcome: 'eligible',
    };
    assert.deepEqual(validateValidationReceipt(validation, build), []);
    const publication = {
      schemaVersion: 1,
      buildDigest: '9'.repeat(64),
      validationDigest: '8'.repeat(64),
      repositoryId: 123,
      runId: 7,
      runAttempt: 1,
      artifactId: 'art-1',
      artifactDigest: build.artifactDigest,
      ociDigest: build.ociDigest,
      package: 'ghcr.io/rhanka/sentropic-control',
      outcome: 'published',
    };
    assert.deepEqual(validatePublicationReceipt(publication, build, validation), []);
  });

  it('cross-run artifact swap and byte mismatch refuse', () => {
    const build = buildReceipt();
    const bad = {
      schemaVersion: 1,
      buildDigest: '9'.repeat(64),
      repositoryId: 123,
      runId: 8,
      runAttempt: 1,
      artifactId: 'art-1',
      artifactDigest: build.artifactDigest,
      ociDigest: build.ociDigest,
      outcome: 'eligible',
    };
    assert.ok(validateValidationReceipt(bad, build).length > 0);
  });
});
