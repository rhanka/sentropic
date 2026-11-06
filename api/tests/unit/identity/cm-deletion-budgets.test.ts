import { describe, expect, it } from 'vitest';

import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';

import {
  loadCmDeletionOptions, loadCmWorkspaceDeletionOptions, loadReplicaRunOptions,
} from '../../../src/services/identity/cm-deletion-options';

const base = {
  reservation: { deadlineMs: 10_000, maxAttempts: 1 },
  deletion: { deadlineMs: 10_000, maxAttempts: 1 },
  diagnostic: { deadlineMs: 10_000, maxAttempts: 1 },
  read: { deadlineMs: 10_000, maxAttempts: 1 },
  qualificationReceiptRef: 'synthetic-test-only',
};

const env = (budgets: unknown) => ({ CM_IDENTITY_DELETION_BUDGETS_JSON: JSON.stringify(budgets) });

describe('protected run budgets (a4-cm-gaps-r2 §9.2/§10.7)', () => {
  it('accepts the base record and extra known entries, rejects unknown keys', () => {
    expect(() => loadCmDeletionOptions(env(base))).not.toThrow();
    expect(() => loadCmDeletionOptions(env({ ...base, workspace: base.deletion }))).not.toThrow();
    expect(() => loadCmDeletionOptions(env({
      ...base, workspace: base.deletion, replicaSync: base.deletion,
    }))).not.toThrow();
    expect(() => loadCmDeletionOptions(env({ ...base, nope: base.deletion })))
      .toThrowError(IdentityCustodyErrorV1);
  });

  it('refuses a missing or malformed workspace entry', () => {
    expect(() => loadCmWorkspaceDeletionOptions(env(base))).toThrowError(IdentityCustodyErrorV1);
    expect(() => loadCmWorkspaceDeletionOptions(env({ ...base, workspace: { deadlineMs: 0, maxAttempts: 1 } })))
      .toThrowError(IdentityCustodyErrorV1);
    const loaded = loadCmWorkspaceDeletionOptions(env({ ...base, workspace: base.deletion }));
    expect(loaded.deletion).toMatchObject({ mode: 'write', purpose: 'delete' });
  });

  it('loads replica entries with import purpose, never defaults', () => {
    expect(() => loadReplicaRunOptions(env(base))).toThrowError(IdentityCustodyErrorV1);
    const loaded = loadReplicaRunOptions(env({
      ...base,
      replicaExport: base.read, replicaValidation: base.read, replicaSync: base.deletion,
    }));
    expect(loaded.export).toMatchObject({ mode: 'read', purpose: 'import' });
    expect(loaded.validation).toMatchObject({ mode: 'read', purpose: 'import' });
    expect(loaded.sync).toMatchObject({ mode: 'write', purpose: 'import' });
  });
});
