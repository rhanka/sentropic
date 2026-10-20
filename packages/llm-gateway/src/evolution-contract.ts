/**
 * Frozen L0 evolution contract (spec 8/GWRC-CI-V1).
 *
 * Single TypeScript home for the closed v1 identities both program arms
 * freeze before the first candidate commit. Changing existing field meaning
 * requires an explicit versioned migration; a later phase needs a
 * coordinated additive extension, never an unknown value.
 */
export const SCHEMA_VERSION = 1;

/** Validated bytes of `.tmp/fcc-study/spec-gateway-evolutions-v8.md`. */
export const SPEC_SHA256 =
  'a530321eb43171ee3b11605b90aa81699bb2758a0020e43f389a59156642eaf9';

/** Byte-identical GWRC-CI-V1 block (markers included, no trailing newline). */
export const SHARED_BLOCK_SHA256 =
  'b46d3c3c10873b8f5742fd8a4c6349f607d480b907dea899c38f0e8bb4e3b332';

export type GatewayPhase =
  | 'none'
  | 'baseline-662'
  | 'pr1-candidate'
  | 'pr2-candidate'
  | 'pr3-candidate'
  | 'pr1-published'
  | 'pr2-published'
  | 'pr3-published';

export const GATEWAY_PHASES: readonly GatewayPhase[] = [
  'none',
  'baseline-662',
  'pr1-candidate',
  'pr2-candidate',
  'pr3-candidate',
  'pr1-published',
  'pr2-published',
  'pr3-published',
];

export type RegistryPhase =
  | 'none'
  | 'r4-candidate'
  | 'r5-candidate'
  | 'r6-candidate'
  | 'r7b-candidate'
  | 'r4-published'
  | 'r5-published'
  | 'r6-published'
  | 'r7b-published';

export const REGISTRY_PHASES: readonly RegistryPhase[] = [
  'none',
  'r4-candidate',
  'r5-candidate',
  'r6-candidate',
  'r7b-candidate',
  'r4-published',
  'r5-published',
  'r6-published',
  'r7b-published',
];

export const MANDATORY_GATEWAY_PROFILES = ['gateway-messaging', 'gateway-runtime'] as const;

export const PROFILE_MAP: Record<string, string> = {
  'gateway-runtime': 'gateway active-phase runtime gates',
  'gateway-messaging': 'gateway active-phase messaging gates',
  'registry-focus': 'registry R4 focus gates',
  'registry-runtime': 'registry R5 runtime gates',
  'registry-renderer': 'registry R6 renderer gates',
  'registry-hosts': 'registry R7b hosts gates',
};

export interface DeliveryRow {
  readonly branch: string;
  readonly slug: string;
  readonly candidateIndex: number;
  readonly slot: number;
  readonly apiPort: number;
  readonly uiPort: number;
  readonly maildevUiPort: number;
  readonly gatewayPort: number;
  readonly testEnv: string;
  readonly nativeEnv: string;
}

export const DELIVERIES: Record<'pr1' | 'pr2' | 'pr3', DeliveryRow> = {
  pr1: {
    branch: 'feat/gw-durable-vibe-muse',
    slug: 'feat-gw-durable-vibe-muse',
    candidateIndex: 120,
    slot: 0,
    apiPort: 9600,
    uiPort: 5800,
    maildevUiPort: 1700,
    gatewayPort: 19600,
    testEnv: 'test-gw-durable-vibe-muse',
    nativeEnv: 'e2e-gw-durable-vibe-muse',
  },
  pr2: {
    branch: 'feat/gw-claude-stack',
    slug: 'feat-gw-claude-stack',
    candidateIndex: 121,
    slot: 0,
    apiPort: 9605,
    uiPort: 5805,
    maildevUiPort: 1705,
    gatewayPort: 19605,
    testEnv: 'test-gw-claude-stack',
    nativeEnv: 'e2e-gw-claude-stack',
  },
  pr3: {
    branch: 'feat/gw-cli-protocol-coverage',
    slug: 'feat-gw-cli-protocol-coverage',
    candidateIndex: 122,
    slot: 0,
    apiPort: 9610,
    uiPort: 5810,
    maildevUiPort: 1710,
    gatewayPort: 19610,
    testEnv: 'test-gw-cli-protocol-coverage',
    nativeEnv: 'e2e-gw-cli-protocol-coverage',
  },
};
