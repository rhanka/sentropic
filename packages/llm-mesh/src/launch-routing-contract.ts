import { createHash } from 'node:crypto';
import type { TargetMapping } from './routing-targets.js';

export interface LaunchRoutingContract {
  readonly version: 1;
  readonly revision: string;
  readonly ownerScopeRef: string;
  readonly exactModels: readonly string[];
  readonly authorizedAccountRefs: readonly string[];
  readonly rotateAccounts: boolean;
  readonly effortPolicy: { readonly mode: 'preserve'; readonly allowedEfforts?: readonly string[] };
  readonly mapping?: {
    readonly id: string;
    readonly revision: string;
    readonly contentSha256: string;
    readonly targets: Readonly<Record<string, readonly TargetMapping[]>>;
  };
}
export class LaunchRoutingContractError extends Error {
  readonly code = 'routing-contract-invalid';
  constructor() { super('Explicit valid launch routing policy is required'); }
}
function refuse(): never { throw new LaunchRoutingContractError(); }
const record = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const keys = (value: Record<string, unknown>, allowed: string[]) => {
  if (Object.keys(value).some((key) => !allowed.includes(key))) refuse();
};
const list = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.length <= 128
  && value.every(nonempty) && new Set(value).size === value.length;
export const mappingContentSha256 = (targets: Readonly<Record<string, readonly TargetMapping[]>>): string =>
  createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(targets).sort().map((model) => [model,
    targets[model].map((target) => ({ providerId: target.providerId, transportProviderId: target.transportProviderId,
      model: target.model, ...(target.effort !== undefined ? { effort: target.effort } : {}) })),
  ])))).digest('hex');

export const validateLaunchRoutingContract = (value: unknown): LaunchRoutingContract => {
  if (!record(value)) refuse();
  keys(value, ['version', 'revision', 'ownerScopeRef', 'exactModels', 'authorizedAccountRefs', 'rotateAccounts', 'effortPolicy', 'mapping']);
  if (value.version !== 1 || !nonempty(value.revision) || !nonempty(value.ownerScopeRef)
    || !list(value.exactModels) || !list(value.authorizedAccountRefs) || typeof value.rotateAccounts !== 'boolean'
    || !record(value.effortPolicy) || value.effortPolicy.mode !== 'preserve') refuse();
  keys(value.effortPolicy, ['mode', 'allowedEfforts']);
  if (value.effortPolicy.allowedEfforts !== undefined && !list(value.effortPolicy.allowedEfforts)) refuse();
  if (value.mapping !== undefined) {
    const mapping = value.mapping;
    if (!record(mapping)) refuse();
    keys(mapping, ['id', 'revision', 'contentSha256', 'targets']);
    if (!nonempty(mapping.id) || !nonempty(mapping.revision) || !record(mapping.targets)
      || !Object.keys(mapping.targets).length || Object.keys(mapping.targets).length > 128) refuse();
    for (const [model, targets] of Object.entries(mapping.targets)) {
      if (!value.exactModels.includes(model) || !Array.isArray(targets) || !targets.length || targets.length > 8) refuse();
      for (const target of targets) {
        if (!record(target)) refuse();
        keys(target, ['providerId', 'transportProviderId', 'model', 'effort']);
        if (!nonempty(target.providerId) || !nonempty(target.transportProviderId) || !nonempty(target.model)
          || (target.effort !== undefined && !nonempty(target.effort))) refuse();
      }
    }
    if (typeof mapping.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(mapping.contentSha256)
      || mappingContentSha256(mapping.targets) !== mapping.contentSha256) refuse();
  }
  return value as unknown as LaunchRoutingContract;
};
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
};
export const freezeLaunchRoutingContract = (value: unknown): LaunchRoutingContract =>
  deepFreeze(structuredClone(validateLaunchRoutingContract(value)));
export const launchTargets = (contract: LaunchRoutingContract, model: string): readonly TargetMapping[] | undefined => {
  validateLaunchRoutingContract(contract);
  if (!contract.exactModels.includes(model)) refuse();
  return contract.mapping?.targets[model];
};
