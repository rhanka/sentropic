// Shape validators for the packed relay port parameter objects (RC2.contract r3
// schemas). Defect string or null; the port turns any defect into the typed
// refusal relay_protocol_refused (never TypeError — that is only for invalid JS API use).
import { SESSION_RELAY_CLOSE_REASONS, SESSION_RELAY_INNER_ROUTES, relayRouteSpec } from './relay-routes.js';
import type { SessionRelayLane } from './relay-routes.js';

const ID_RE = /^[\x20-\x7e]{1,128}$/;
const RANDOM_ID_RE = /^[A-Za-z0-9_-]{21}[AQgw]$/;
const DIGEST_RE = /^[a-f0-9]{64}$/;
const LANES: readonly SessionRelayLane[] = ['content', 'actions', 'results', 'lifecycle'];
const STAGES = ['listing', 'bootstrap', 'bound'] as const;
const REVISION_PATH_PARAMS = new Set(['policyRevision', 'consentRevision']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): boolean {
  return typeof value === 'string' && ID_RE.test(value);
}

function isCounter(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isDigest(value: unknown): boolean {
  return typeof value === 'string' && DIGEST_RE.test(value);
}

function checkExactKeys(obj: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of Object.keys(obj)) {
    if (!keys.includes(key)) return `unlisted key: ${key}`;
  }
  for (const key of keys) {
    if (!(key in obj)) return `missing key: ${key}`;
  }
  return null;
}

function checkSessionRef(value: unknown): string | null {
  if (!isPlainObject(value)) return 'sessionRef must be an object';
  const defect = checkExactKeys(value, ['originInstanceId', 'sessionId', 'incarnation']);
  if (defect) return `sessionRef: ${defect}`;
  for (const key of ['originInstanceId', 'sessionId', 'incarnation'] as const) {
    if (!isId(value[key])) return `sessionRef.${key} must be an Id`;
  }
  return null;
}

function checkRevisionRef(value: unknown, name: string): string | null {
  if (!isPlainObject(value)) return `${name} must be an object`;
  const defect = checkExactKeys(value, ['id', 'revision', 'digest']);
  if (defect) return `${name}: ${defect}`;
  if (!isId(value.id)) return `${name}.id must be an Id`;
  if (!isCounter(value.revision)) return `${name}.revision must be a Counter`;
  if (!isDigest(value.digest)) return `${name}.digest must be a lowercase sha256 hex`;
  return null;
}

export function validateConnectParameters(value: unknown): string | null {
  if (!isPlainObject(value)) return 'parameters must be a single named object';
  const defect = checkExactKeys(value, ['sessionRef', 'approvedRouteRef', 'stage', 'laneSet', 'bindingRef']);
  if (defect) return defect;
  const sessionDefect = checkSessionRef(value.sessionRef);
  if (sessionDefect) return sessionDefect;
  const routeDefect = checkRevisionRef(value.approvedRouteRef, 'approvedRouteRef');
  if (routeDefect) return routeDefect;
  if (!STAGES.includes(value.stage as (typeof STAGES)[number])) return 'stage must be listing|bootstrap|bound';
  if (!Array.isArray(value.laneSet) || value.laneSet.length < 1 || value.laneSet.length > 4) return 'laneSet must hold 1..4 lanes';
  if (new Set(value.laneSet).size !== value.laneSet.length) return 'laneSet lanes must be unique';
  for (const lane of value.laneSet) {
    if (!LANES.includes(lane as SessionRelayLane)) return `unknown lane: ${String(lane)}`;
  }
  const binding = value.bindingRef;
  if (!isPlainObject(binding)) return 'bindingRef must be an object';
  switch (binding.kind) {
    case 'listing': {
      const d = checkExactKeys(binding, ['kind', 'listingGrantRef']);
      return d ?? checkRevisionRef(binding.listingGrantRef, 'bindingRef.listingGrantRef');
    }
    case 'bootstrap': {
      const d = checkExactKeys(binding, ['kind', 'approvedRegistrationRef']);
      return d ?? checkRevisionRef(binding.approvedRegistrationRef, 'bindingRef.approvedRegistrationRef');
    }
    case 'cli': {
      const d = checkExactKeys(binding, ['kind', 'targetDigest', 'admissionRef']);
      if (d) return d;
      if (!isDigest(binding.targetDigest)) return 'bindingRef.targetDigest must be a lowercase sha256 hex';
      return checkRevisionRef(binding.admissionRef, 'bindingRef.admissionRef');
    }
    case 'app-chat': {
      const d = checkExactKeys(binding, ['kind', 'chatBindingRef']);
      return d ?? checkRevisionRef(binding.chatBindingRef, 'bindingRef.chatBindingRef');
    }
    default:
      return 'bindingRef.kind must be listing|bootstrap|cli|app-chat';
  }
}

function validateLaneParameters(value: unknown, stream: boolean): string | null {
  if (!isPlainObject(value)) return 'parameters must be a single named object';
  const defect = checkExactKeys(value, ['routeId', 'pathParameters', 'body']);
  if (defect) return defect;
  const spec = relayRouteSpec(String(value.routeId));
  if (!spec) return `unknown routeId: ${String(value.routeId)}`;
  if (spec.stream !== stream) return `routeId ${String(value.routeId)} is ${spec.stream ? 'a stream' : 'not a stream'} route`;
  if (!isPlainObject(value.pathParameters)) return 'pathParameters must be an object';
  for (const key of Object.keys(value.pathParameters)) {
    if (!spec.pathParameters.includes(key)) return `unlisted path parameter: ${key}`;
  }
  for (const key of spec.pathParameters) {
    if (!(key in value.pathParameters)) return `missing path parameter: ${key}`;
    const v = value.pathParameters[key];
    if (REVISION_PATH_PARAMS.has(key)) {
      if (!isCounter(v)) return `pathParameters.${key} must be a Counter`;
    } else if (!isId(v)) {
      return `pathParameters.${key} must be an Id`;
    }
  }
  if (spec.bodyRequired) {
    if (!isPlainObject(value.body)) return 'body must be a record object for this route';
  } else if (value.body !== null) {
    return 'body must be null for this bodyless route';
  }
  return null;
}

export function validateLaneRequestParameters(value: unknown): string | null {
  return validateLaneParameters(value, false);
}

export function validateLaneStreamParameters(value: unknown): string | null {
  return validateLaneParameters(value, true);
}

export function validateLaneCloseParameters(value: unknown): string | null {
  if (!isPlainObject(value)) return 'parameters must be a single named object';
  const defect = checkExactKeys(value, ['reason']);
  if (defect) return defect;
  if (!SESSION_RELAY_CLOSE_REASONS.includes(value.reason as (typeof SESSION_RELAY_CLOSE_REASONS)[number])) {
    return `unknown close reason: ${String(value.reason)}`;
  }
  return null;
}

export function isRandomId(value: unknown): boolean {
  return typeof value === 'string' && RANDOM_ID_RE.test(value);
}

export { SESSION_RELAY_INNER_ROUTES };
