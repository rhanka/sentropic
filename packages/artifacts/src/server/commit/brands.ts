/** Shared nominal identities for the frozen ABI and coordinator-issued credentials. */
export const commitFenceBrand: unique symbol = Symbol('artifact-authorization-fence');
export const commitTransactionBrand: unique symbol = Symbol('artifact-commit-transaction');
