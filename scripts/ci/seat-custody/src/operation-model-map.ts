// L3-E / L3-J (r6 §6.3, r4 §5): OperationModelMapV1 — the reviewed exact current
// product/CI operation map generated from the candidate H/B/T. Each entry binds a
// stable operation ID, I/D/N classification, source locations, provider, exact model
// ID, endpoint, runtime, capabilities, bounds and qualified seat routes. Unknown or
// unmapped live operations refuse before send; retired IDs refuse by exact match
// only (no substring ban); the gpt-5.4-nano refusal boundary is exactly
// 2027-04-01T00:00:00Z; missing deployment/migration evidence leaves the whole case
// required/incomplete (source-gap), never a substitution or CI-only alias.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type OperationClass = 'intentional-live' | 'incidental-deterministic' | 'no-inference';

export type OperationEntry = {
  operationId: string;
  classification: OperationClass;
  sourceLocations: string[];
  provider: string;
  modelId: string;
  endpoint: string;
  runtime: string;
  capabilities: string[];
  requestBounds: string;
  responseBounds: string;
  qualifiedSeatRoutes: string[];
  deploymentEvidence: 'source-gap' | 'accepted' | 'retired-exact-id';
};

export type OperationModelMapV1 = {
  schemaVersion: 1;
  mapId: 'OperationModelMapV1';
  generatedFrom: { head: string; base: string; tree: string };
  productDefaultModel: string;
  ciDefaultModel: string;
  retiredIds: string[];
  historicalIds: string[];
  nanoModel: string;
  nanoCutoffIso: string;
  operations: OperationEntry[];
};

export const RETIRED_IDS = ['gpt-4.1-nano', 'gpt-4.1-nano-2025-04-14'] as const;
export const HISTORICAL_IDS = ['gpt-6-luna', 'gpt-5.6-luna'] as const;
export const NANO_MODEL = 'gpt-5.4-nano';
export const NANO_CUTOFF_ISO = '2027-04-01T00:00:00Z';
export const MAP_PATH = 'scripts/ci/seat-custody/config/operation-model-map.v1.json';

const CLASSES: readonly string[] = ['intentional-live', 'incidental-deterministic', 'no-inference'];

export function loadOperationModelMap(repoRoot: string): OperationModelMapV1 {
  const map = JSON.parse(readFileSync(join(repoRoot, MAP_PATH), 'utf8')) as OperationModelMapV1;
  const errors = validateOperationModelMap(map);
  if (errors.length > 0) throw new Error('operation-model-map-invalid: ' + errors.join('; '));
  return map;
}

export function validateOperationModelMap(map: OperationModelMapV1): string[] {
  const errors: string[] = [];
  if (map.schemaVersion !== 1) errors.push('schemaVersion');
  if (map.mapId !== 'OperationModelMapV1') errors.push('mapId');
  for (const key of ['head', 'base', 'tree'] as const) {
    if (!/^[0-9a-f]{40}$/.test(map.generatedFrom?.[key] ?? '')) errors.push(`generatedFrom.${key}`);
  }
  if (map.productDefaultModel !== NANO_MODEL) errors.push('productDefaultModel');
  if (map.ciDefaultModel !== 'mistral-small-2603') errors.push('ciDefaultModel');
  if (JSON.stringify(map.retiredIds) !== JSON.stringify([...RETIRED_IDS])) errors.push('retiredIds');
  if (map.nanoModel !== NANO_MODEL || map.nanoCutoffIso !== NANO_CUTOFF_ISO) errors.push('nanoCutoff');
  const seen = new Set<string>();
  for (const op of map.operations ?? []) {
    if (!op.operationId || seen.has(op.operationId)) errors.push(`operation-id:${op.operationId}`);
    seen.add(op.operationId);
    if (!CLASSES.includes(op.classification)) errors.push(`${op.operationId}:classification`);
    if (!Array.isArray(op.sourceLocations) || op.sourceLocations.length === 0) errors.push(`${op.operationId}:sourceLocations`);
    if (!op.provider || !op.endpoint || !op.runtime) errors.push(`${op.operationId}:provider/endpoint/runtime`);
    if (!Array.isArray(op.capabilities) || !op.requestBounds || !op.responseBounds) errors.push(`${op.operationId}:bounds`);
    if (!Array.isArray(op.qualifiedSeatRoutes)) errors.push(`${op.operationId}:qualifiedSeatRoutes`);
    if (!['source-gap', 'accepted', 'retired-exact-id'].includes(op.deploymentEvidence)) errors.push(`${op.operationId}:deploymentEvidence`);
    if (op.modelId.length === 0 && !(op.qualifiedSeatRoutes.length === 0 && op.deploymentEvidence === 'source-gap')) {
      errors.push(`${op.operationId}:empty-modelId-with-route-or-evidence`);
    }
    if (op.deploymentEvidence === 'accepted' && op.qualifiedSeatRoutes.length === 0) {
      errors.push(`${op.operationId}:accepted-without-route`);
    }
  }
  return errors;
}

export function operationEntry(map: OperationModelMapV1, operationId: string): OperationEntry {
  const entry = map.operations.find(o => o.operationId === operationId);
  if (!entry) throw new Error('operation-unmapped');
  return entry;
}

export type ModelVerdict = { model: string; caseStatus: 'qualified' | 'required-incomplete' };

// Refuse-before-send gate for one operation/model at time nowMs. The retired-ID
// check is an exact-ID match: no substring ban. The nano cutoff is exact:
// nowMs >= 2027-04-01T00:00:00Z refuses gpt-5.4-nano; the preceding instant passes
// when valid receipts (a qualified route) exist.
export function assertModelAdmissible(model: unknown, map: OperationModelMapV1, operationId: string, nowMs: number): ModelVerdict {
  if (typeof model !== 'string' || model.length === 0) throw new Error('model-missing');
  if ((RETIRED_IDS as readonly string[]).includes(model)) throw new Error('model-retired');
  if ((HISTORICAL_IDS as readonly string[]).includes(model)) throw new Error('model-historical-no-route-authority');
  if (model === map.nanoModel && nowMs >= Date.parse(map.nanoCutoffIso)) throw new Error('model-cutoff');
  const entry = operationEntry(map, operationId);
  if (entry.modelId !== model) throw new Error('model-mismatch');
  if (!entry.qualifiedSeatRoutes.includes(model)) {
    // No qualified route: the whole case stays required/incomplete. A missing
    // route never selects another model, a paid API or a CI-only alias.
    if (entry.deploymentEvidence === 'source-gap') return { model, caseStatus: 'required-incomplete' };
    throw new Error('model-not-qualified-route');
  }
  return { model, caseStatus: 'qualified' };
}
