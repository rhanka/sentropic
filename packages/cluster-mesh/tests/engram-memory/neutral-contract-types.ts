// Compiled by binding-compatibility.spec.ts with the installed 0.21.3 declarations.
import type {
  ModuleStorageMemoryStoreOptionsV1 as InstalledOptions,
  openModuleStorageCanonicalMemoryStoreV1,
} from '@sentropic/engram/memory-substrate';
import type {
  ModuleStorageMemoryStoreOptionsV1 as FrozenOptions,
  NeutralMemoryHandle,
  NeutralModuleStorageBinding,
  NeutralBoundScope,
  NeutralModuleTransaction,
} from '../../src/engram-memory/neutral-contract.js';

type Assert<T extends true> = T;
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type BothWays<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
type InstalledFlat = Extract<InstalledOptions['handle'], { transact: unknown }>;
type InstalledBinding = Extract<InstalledOptions['handle'], { bind: unknown }>;
type InstalledBound = Awaited<ReturnType<InstalledBinding['bind']>>;
type InstalledTransaction = Parameters<Parameters<InstalledFlat['transact']>[1]>[0];
type Constructor = typeof openModuleStorageCanonicalMemoryStoreV1;
type FrozenConstructor = (options: FrozenOptions) => ReturnType<Constructor>;

export type FrozenCompatibility = [
  Assert<BothWays<FrozenOptions, InstalledOptions>>,
  Assert<BothWays<FrozenConstructor, Constructor>>,
  Assert<Same<keyof FrozenOptions, keyof InstalledOptions>>,
  Assert<BothWays<NeutralMemoryHandle, InstalledFlat>>,
  Assert<Same<keyof NeutralMemoryHandle, keyof InstalledFlat>>,
  Assert<BothWays<NeutralModuleStorageBinding, InstalledBinding>>,
  Assert<Same<keyof NeutralModuleStorageBinding, keyof InstalledBinding>>,
  Assert<BothWays<NeutralBoundScope, InstalledBound>>,
  Assert<Same<keyof NeutralBoundScope, keyof InstalledBound>>,
  Assert<BothWays<NeutralModuleTransaction, InstalledTransaction>>,
  Assert<Same<keyof NeutralModuleTransaction, keyof InstalledTransaction>>,
  Assert<Same<FrozenOptions['scope_binding'], InstalledOptions['scope_binding']>>,
  Assert<Same<FrozenOptions['grant'], InstalledOptions['grant']>>,
  Assert<Same<FrozenOptions['work_limits'], InstalledOptions['work_limits']>>,
  Assert<Same<NeutralMemoryHandle['readCommitResult'], InstalledFlat['readCommitResult']>>,
  Assert<Same<NeutralBoundScope['acquireFence'], InstalledBound['acquireFence']>>,
];

// Maintenance remains a separate host binding; it must not escape into this asset.
// @ts-expect-error memory has no host maintenance checkpoint port
export type NoCheckpoint = NeutralMemoryHandle['checkpoint'];
// @ts-expect-error memory has no snapshot maintenance port
export type NoSnapshot = NeutralBoundScope['captureSnapshot'];
