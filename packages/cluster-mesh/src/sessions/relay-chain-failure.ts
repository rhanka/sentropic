// CHAIN-ESTABLISH-2 pairFailure evaluator (RC2.contract r3
// vectors/state-transitions.json): establishment-failure propagation rules.
import type { RelayErrorCode } from './registry-types.js';
import type { RelayRecord } from './relay-chain.js';
export type ChainFailureDecision = RelayErrorCode | 'paired-close-floor-preserved-model' | 'failure-propagation-refused';

export interface PairFailureInput {
  readonly before: { readonly consumedGeneration: number; readonly unrelatedCircuit: string; readonly upstream: RelayRecord; readonly downstream: RelayRecord };
  readonly after: {
    readonly upstream: string;
    readonly downstream: string;
    readonly upstreamClose: RelayRecord;
    readonly downstreamClose: RelayRecord;
    readonly volatileBytes: number;
    readonly tlsResumable: boolean;
    readonly endpointSuccess: boolean;
    readonly consumedGeneration: number;
    readonly unrelatedCircuit: string;
  };
  readonly cause: string;
}

// pairFailure: on failure both legs close with a Close on their own tunnel/generation;
// no volatile bytes, TLS resumption, false success, floor rollback, unrelated closes.
export function chainPairFailure(input: PairFailureInput): ChainFailureDecision {
  const { before, after } = input;
  if (after.upstream !== 'closed' || after.downstream !== 'closed') return 'failure-propagation-refused';
  if (after.upstreamClose.tunnelId !== before.upstream.tunnelId || after.upstreamClose.linkGeneration !== before.upstream.linkGeneration) return 'failure-propagation-refused';
  if (after.downstreamClose.tunnelId !== before.downstream.tunnelId || after.downstreamClose.linkGeneration !== before.downstream.linkGeneration) return 'failure-propagation-refused';
  if (after.volatileBytes !== 0) return 'failure-propagation-refused';
  if (after.tlsResumable) return 'failure-propagation-refused';
  if (after.endpointSuccess) return 'failure-propagation-refused';
  if (after.consumedGeneration !== before.consumedGeneration) return 'failure-propagation-refused';
  if (after.unrelatedCircuit !== before.unrelatedCircuit) return 'failure-propagation-refused';
  return 'paired-close-floor-preserved-model';
}
