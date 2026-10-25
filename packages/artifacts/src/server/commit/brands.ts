import type { ArtifactAuthorizationFence, ArtifactCommitTransaction } from '#artifacts-frozen-commit';

type CommitFenceBrand = Extract<keyof ArtifactAuthorizationFence, symbol>;
type CommitTransactionBrand = Extract<keyof ArtifactCommitTransaction, symbol>;

/** Runtime credentials implement the frozen brands without changing the freeze. */
export const commitFenceBrand: CommitFenceBrand = Symbol('artifact-authorization-fence') as CommitFenceBrand;
export const commitTransactionBrand: CommitTransactionBrand = Symbol('artifact-commit-transaction') as CommitTransactionBrand;
