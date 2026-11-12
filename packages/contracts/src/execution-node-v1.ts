/**
 * ExecutionNodeV1 contract — single amendable module (S1-T0 freeze).
 * Normative spec: spec/SPEC_EVOL_SANDBOX_NODE.md. Amend this file only.
 */

export const EXECUTION_NODE_CONTRACT_VERSION = 'execution-node.v1' as const;

export const EXECUTION_TICKET_TTL_MS = 30_000 as const;

export const EXECUTION_NODE_TENANTS = ['sentropic', 'immo'] as const;
export type ExecutionNodeTenantId = (typeof EXECUTION_NODE_TENANTS)[number];

export const EXECUTION_NODE_LIFECYCLE = [
  'creating',
  'standby',
  'running',
  'stopping',
  'stopped-output-retained',
  'exported',
  'destroyed',
  'failed',
] as const;
export type ExecutionNodeLifecycleState =
  (typeof EXECUTION_NODE_LIFECYCLE)[number];

export type ExecutionNodePurpose = string;

export interface ExecutionNodeOwnership {
  readonly tenantId: ExecutionNodeTenantId;
  readonly poolOwned: string | false;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly sessionId?: string;
  readonly buildId?: string;
  readonly jobId?: string;
  readonly attemptId: string;
  readonly purpose: ExecutionNodePurpose;
  readonly generation: number;
  readonly custodyEpoch: number;
}

export interface ExecutionNodeStandbyCompatibility {
  readonly tenantId: ExecutionNodeTenantId;
  readonly repoId: string;
  readonly sourceTreeSha256: string;
  readonly lockSha256: string;
  readonly prebundleDigest: string;
  readonly rootfsBaseDigest: string;
  readonly profile: string;
  readonly viteConfigDigest: string;
}

export interface ExecutionNodeSignedCustodyToken {
  readonly tenantId: ExecutionNodeTenantId;
  readonly principalId: string;
  readonly custodyEpoch: number;
  readonly resourceId: string;
  readonly deadlineAt: string;
}

export interface ExecutionNodeTicket {
  readonly v: 1;
  readonly tenantId: ExecutionNodeTenantId;
  readonly commandId: string;
  readonly method: string;
  readonly path: string;
  readonly bodySha256: string;
  readonly targetNodeId: string;
  readonly expectedNodeInstanceId: string;
  readonly expectedNodeEpoch: number;
  readonly ownership: ExecutionNodeOwnership;
  readonly issuedAt: string;
  readonly deadlineAt: string;
}

export type ExecutionNodeBaseKind =
  | 'rootfs'
  | 'dependencies'
  | 'source'
  | 'prebundle'
  | 'vendor-esm';

export interface ExecutionNodeBaseRef {
  readonly baseId: string;
  readonly kind: ExecutionNodeBaseKind;
  readonly identityDigest: string;
}

export interface ExecutionNodeQuota {
  readonly memoryMinMiB: number;
  readonly memoryHighMiB: number;
  readonly memoryMaxMiB: number;
  readonly cpuWeight: number;
  readonly tasksMax: number;
}

export const EXECUTION_NODE_TENANT_SLICE_DEFAULTS: Record<
  ExecutionNodeTenantId,
  ExecutionNodeQuota
> = {
  sentropic: {
    memoryMinMiB: 4096,
    memoryHighMiB: 6656,
    memoryMaxMiB: 9216,
    cpuWeight: 100,
    tasksMax: 4096,
  },
  immo: {
    memoryMinMiB: 4096,
    memoryHighMiB: 6656,
    memoryMaxMiB: 9216,
    cpuWeight: 100,
    tasksMax: 4096,
  },
};

export interface ExecutionNodeSandboxSpec {
  readonly tenantId: ExecutionNodeTenantId;
  readonly physicalUid: string;
  readonly profile: string;
  readonly runtimeClass: string;
  readonly baseMounts: readonly ExecutionNodeBaseRef[];
  readonly quotaMiB: number;
  readonly quotaInodes: number;
  readonly uid: number;
  readonly gid: number;
  readonly network: 'none' | 'ports';
  readonly allowExec: boolean;
  readonly allowPty: boolean;
  readonly allowSnapshots: boolean;
}

export interface ExecutionNodeClaimSpec {
  readonly tenantId: ExecutionNodeTenantId;
  readonly compatibility: ExecutionNodeStandbyCompatibility;
  readonly ownership: ExecutionNodeOwnership;
}

export interface ExecutionNodeStopSpec {
  readonly retainOutput: boolean;
  readonly outputSubPath?: string;
  readonly retentionTtlMs?: number;
}

export interface ExecutionNodeExportSpec {
  readonly subPath: string;
  readonly presignedPutUrl: string;
  readonly maxBytes: number;
}

export type ExecutionNodeErrorCode =
  | 'already_claimed'
  | 'command_id_payload_mismatch'
  | 'stale_node_epoch'
  | 'unknown_node_instance'
  | 'cross_tenant_base_forbidden'
  | 'deprecated_on_overlay_node'
  | 'sandbox_still_running'
  | 'tenant_quota_exceeded';

export interface ExecutionNodeInfo {
  readonly contractVersion: typeof EXECUTION_NODE_CONTRACT_VERSION;
  readonly nodeId: string;
  readonly nodeInstanceId: string;
  readonly nodeEpoch: number;
  readonly classes: readonly ['sandbox'];
}

export type ExecutionNodeJsonSchema = {
  readonly $schema?: string;
  readonly $id?: string;
  readonly title?: string;
  readonly type: 'object';
  readonly required: readonly string[];
  readonly properties: Record<string, unknown>;
  readonly additionalProperties?: boolean;
};

export const EXECUTION_NODE_V1_SANDBOX_SPEC_SCHEMA: ExecutionNodeJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:sentropic:execution-node.v1:sandbox-spec',
  title: 'ExecutionNodeV1 SandboxSpec',
  type: 'object',
  required: [
    'tenantId',
    'physicalUid',
    'profile',
    'runtimeClass',
    'baseMounts',
    'quotaMiB',
    'quotaInodes',
    'uid',
    'gid',
    'network',
  ],
  properties: {
    tenantId: { enum: ['sentropic', 'immo'] },
    physicalUid: { type: 'string', minLength: 1 },
    profile: { type: 'string', minLength: 1 },
    runtimeClass: { type: 'string', minLength: 1 },
    baseMounts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['baseId', 'kind', 'identityDigest'],
        properties: {
          baseId: { type: 'string', minLength: 1 },
          kind: {
            enum: ['rootfs', 'dependencies', 'source', 'prebundle', 'vendor-esm'],
          },
          identityDigest: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
    quotaMiB: { type: 'integer', minimum: 1 },
    quotaInodes: { type: 'integer', minimum: 1 },
    uid: { type: 'integer', minimum: 0 },
    gid: { type: 'integer', minimum: 0 },
    network: { enum: ['none', 'ports'] },
    allowExec: { type: 'boolean' },
    allowPty: { type: 'boolean' },
    allowSnapshots: { type: 'boolean' },
  },
  additionalProperties: false,
};

export const EXECUTION_NODE_V1_CLAIM_SCHEMA: ExecutionNodeJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:sentropic:execution-node.v1:claim',
  title: 'ExecutionNodeV1 ClaimSpec',
  type: 'object',
  required: ['tenantId', 'compatibility', 'ownership'],
  properties: {
    tenantId: { enum: ['sentropic', 'immo'] },
    compatibility: {
      type: 'object',
      required: [
        'tenantId',
        'repoId',
        'sourceTreeSha256',
        'lockSha256',
        'prebundleDigest',
        'rootfsBaseDigest',
        'profile',
        'viteConfigDigest',
      ],
      properties: {
        tenantId: { enum: ['sentropic', 'immo'] },
        repoId: { type: 'string', minLength: 1 },
        sourceTreeSha256: { type: 'string', minLength: 1 },
        lockSha256: { type: 'string', minLength: 1 },
        prebundleDigest: { type: 'string', minLength: 1 },
        rootfsBaseDigest: { type: 'string', minLength: 1 },
        profile: { type: 'string', minLength: 1 },
        viteConfigDigest: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    },
    ownership: {
      type: 'object',
      required: [
        'tenantId',
        'poolOwned',
        'workspaceId',
        'principalId',
        'attemptId',
        'purpose',
        'generation',
        'custodyEpoch',
      ],
      properties: {
        tenantId: { enum: ['sentropic', 'immo'] },
        poolOwned: { type: ['string', 'boolean'] },
        workspaceId: { type: 'string', minLength: 1 },
        principalId: { type: 'string', minLength: 1 },
        sessionId: { type: 'string' },
        buildId: { type: 'string' },
        jobId: { type: 'string' },
        attemptId: { type: 'string', minLength: 1 },
        purpose: { type: 'string', minLength: 1 },
        generation: { type: 'integer', minimum: 0 },
        custodyEpoch: { type: 'integer', minimum: 0 },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export const EXECUTION_NODE_V1_SCHEMAS = {
  sandboxSpec: EXECUTION_NODE_V1_SANDBOX_SPEC_SCHEMA,
  claim: EXECUTION_NODE_V1_CLAIM_SCHEMA,
} as const;
