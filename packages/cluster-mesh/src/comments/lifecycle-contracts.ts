import type { CapacityDescriptor, CapabilityCheckPort, ResourceResolverPort, DecisionResolutionPort, ResourceRef, LifecycleEventRecord } from '@sentropic/comments';
export interface CommentsServiceOptions {
  readonly capacity: CapacityDescriptor;
  readonly capabilities: CapabilityCheckPort;
  readonly resolver: ResourceResolverPort;
  readonly decisions?: DecisionResolutionPort;
  readonly clock: { now(): number };
}
export interface CommentsLifecycleControl {
  readonly targets: readonly ResourceRef[]; readonly tombstoned: boolean; readonly intentId: string | null;
  readonly candidate?: LifecycleEventRecord; readonly outcomeHash?: string;
}
export interface CommentsLifecycleResult { readonly hash: string; readonly objectKind: string; readonly objectId: string; readonly action: string; readonly intentId: string | null; }
export const lifecycleControlKey = (target: string): string => JSON.stringify(['comments-lifecycle-control-v1', target]);
export const purgeControlKey = (intent: string): string => JSON.stringify(['comments-purge-control-v1', intent]);
