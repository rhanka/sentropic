// E10 installed type proof: compiled only inside the clean consumer, so
// every declaration below must resolve from the retained installed bytes
// of @sentropic/engram 0.21.3 and the candidate @sentropic/cluster-mesh.
import type {
  CanonicalMemoryStorePort,
  CaptureRequestV2,
  MemoryEngineDependenciesV2,
  MemoryPortV2,
  ModuleStorageMemoryStoreOptionsV1,
} from '@sentropic/engram/memory-substrate';
import { createMemoryPortV2, openModuleStorageCanonicalMemoryStoreV1 } from '@sentropic/engram/memory-substrate';
import type {
  CreateMemoryNeutralHandleInput,
  MemoryHostBinding,
  MemoryMaintainGrant,
  MemoryNeutralGrant,
  MemoryNeutralHandleAssembly,
  MemoryPostgresDriverProvider,
  MemoryProfileClaim,
} from '@sentropic/cluster-mesh/engram-memory';
import {
  MEMORY_DESCRIPTOR,
  MEMORY_PINNED_PROFILES,
  MEMORY_REQUIRED_PROFILES,
  assembleMemoryHostBinding,
  checkMemoryPostgresDriver,
  createMemoryNeutralHandle,
} from '@sentropic/cluster-mesh/engram-memory';

// The pinned five required profiles are a closed, versioned claim set.
const requiredClaims: readonly MemoryProfileClaim[] = MEMORY_PINNED_PROFILES.filter((claim) =>
  (MEMORY_REQUIRED_PROFILES as readonly string[]).includes(claim.name),
);
const requiredNames: readonly string[] = requiredClaims.map((claim) => claim.name);
const descriptorDigest: string = MEMORY_DESCRIPTOR.contractDigest;

// The host binding separates the two authorities at the type level: the
// neutral grant is exactly read/write and carries no maintain leg.
declare const binding: MemoryHostBinding;
const neutralGrant: MemoryNeutralGrant = binding.memoryGrant;
const neutralOperations: readonly ['read', 'write'] = neutralGrant.operations;
const maintainGrant: MemoryMaintainGrant = binding.maintainGrant;
const maintainOperations: readonly ['read', 'maintain'] = maintainGrant.operations;

// @ts-expect-error the host maintain grant must never flow into Engram's neutral handle
const maintainAsNeutral: MemoryNeutralGrant = binding.maintainGrant;

// @ts-expect-error a neutral read/write grant cannot open host maintenance ports
const neutralAsMaintain: MemoryMaintainGrant = binding.memoryGrant;

// The installed factory builds the neutral handle from installed bytes.
declare const neutralInput: CreateMemoryNeutralHandleInput;
const installedAssembly: MemoryNeutralHandleAssembly = createMemoryNeutralHandle(neutralInput);
const installedNeutralHandle: ModuleStorageMemoryStoreOptionsV1['handle'] = installedAssembly.handle;

// The constructor consumes the assembled binding's neutral grant only.
type InstalledHandle = ModuleStorageMemoryStoreOptionsV1['handle'];
declare const handle: InstalledHandle;
const options: ModuleStorageMemoryStoreOptionsV1 = {
  handle,
  grant: neutralGrant,
  scope_binding: {
    scope: { tenantId: 'tenant-installed', workspaceId: 'workspace-installed' },
    store_id: 'installed-memory-store',
    resolveScope: (ref) =>
      ref === 'installed-memory-store' ? { tenantId: 'tenant-installed', workspaceId: 'workspace-installed' } : null,
  },
  clock: { now: () => '2026-10-27T00:00:00.000Z' },
  deadline_at: '2026-10-27T01:00:00.000Z',
};
const opened: Promise<{ ok: boolean }> = openModuleStorageCanonicalMemoryStoreV1(options) as Promise<{ ok: boolean }>;

// The memory port surface stays the installed Engram v2 contract.
declare const store: CanonicalMemoryStorePort;
declare const dependencies: MemoryEngineDependenciesV2;
const port: MemoryPortV2 = createMemoryPortV2(dependencies);
declare const captureRequest: CaptureRequestV2;
const captureResult = port.capture(captureRequest);
const storeVersion: 1 = store.version;

// The driver provider check is part of the public installed surface.
declare const provider: MemoryPostgresDriverProvider;
const checkedProvider: MemoryPostgresDriverProvider = checkMemoryPostgresDriver(provider);
declare const assembleInput: Parameters<typeof assembleMemoryHostBinding>[0];
const assembled: MemoryHostBinding = assembleMemoryHostBinding(assembleInput);

export const installedTypeProof = {
  installedNeutralHandle,
  requiredNames,
  descriptorDigest,
  neutralOperations,
  maintainOperations,
  maintainAsNeutral,
  neutralAsMaintain,
  opened,
  captureResult,
  storeVersion,
  checkedProvider,
  assembled,
};
