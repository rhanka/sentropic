import type { ArtifactCapabilityName, ArtifactProviderProfile, EffectiveArtifactProfile, ArtifactSchema, OperationProfile } from './contracts.js';

const str = { type: 'string', minLength: 1 };
const integer = (minimum: number, maximum?: number) => ({ type: 'integer', minimum,
  ...(maximum === undefined ? {} : { maximum }) });
const obj = (properties: Record<string, unknown>, required: string[] = []): ArtifactSchema =>
  ({ type: 'object', properties, required, additionalProperties: false });
const id = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };
const primitiveRecord = { type: 'object',
  additionalProperties: { type: ['string', 'number', 'boolean', 'null'] }, default: {} };

/** Required configuration includes semantic limits absent from JSON Schema. */
export function assertCompleteOperation(config: OperationProfile): void {
  const required: Record<string, { limits: string[]; defaults: string[] }> = {
    ensure: { limits: ['bindingNameMinUnits', 'bindingNameMaxUnits', 'idempotencyKeyMaxUnits'],
      defaults: ['parameters'] },
    publish: { limits: ['idempotencyKeyMaxUnits', 'publishFilesMin', 'publishFilesMax',
      'maxDecodedFileBytes', 'maxDecodedTotalBytes'], defaults: ['profile'] },
    list: { limits: ['listLimitMin', 'listLimitMax'], defaults: ['limit', 'offset'] },
    commit_upload: { limits: ['idempotencyKeyMaxUnits'], defaults: ['profile'] },
  };
  const fields = required[config.operation];
  if (fields && (fields.limits.some((key) => !Object.hasOwn(config.limits, key)) ||
    fields.defaults.some((key) => !Object.hasOwn(config.defaults, key)))) {
    throw new Error(`incomplete operation profile: ${config.operation}`);
  }
}

export function operationProfile(profile: ArtifactProviderProfile, operation: string): OperationProfile {
  const configured = profile.operations.find((entry) => entry.operation === operation);
  if (!configured) throw new Error(`missing operation profile: ${operation}`);
  return configured;
}

/** Schemas are generated from the same limits/defaults read by normalization. */
export function capabilitySchema(name: ArtifactCapabilityName, profile: EffectiveArtifactProfile): ArtifactSchema {
  const operation = name.slice('artifacts_'.length);
  const config = operationProfile(profile, operation);
  const limits = config.limits;
  const key = { type: 'string', minLength: 1, maxLength: limits.idempotencyKeyMaxUnits,
    description: 'Nonblank by JavaScript trim(); length is UTF-16 units; original bytes retained.' };
  const idOnly = obj({ artifactId: id }, ['artifactId']);
  switch (operation) {
    case 'ensure': return obj({ bindingName: { type: 'string', minLength: limits.bindingNameMinUnits,
      maxLength: limits.bindingNameMaxUnits }, parameters: { ...obj({}), default: config.defaults.parameters },
      idempotencyKey: key }, ['bindingName', 'idempotencyKey']);
    case 'publish': {
      const reserved = profile.rules.reservedFirstSegments.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const path = { type: 'string', minLength: 1, maxLength: profile.rules.pathMaxBytes,
        allOf: [{ not: { pattern: profile.rules.forbiddenPathPattern } },
          { not: { pattern: '(^|/)(\\.\\.?|)(/|$)' } },
          { not: { pattern: `^(?:${reserved})(?:/|$)` } }],
        description: `At most ${profile.rules.pathMaxBytes} UTF-8 bytes; no empty/dot segments, colon or DEL.` };
      const file = { ...obj({ path, mimeType: { type: 'string', enum: profile.rules.mimeTypes },
        text: { type: 'string', maxLength: limits.maxDecodedFileBytes, description: 'UTF-8 decoded-byte budget applies.' },
        bytes: { type: 'array', maxItems: limits.maxDecodedFileBytes, items: integer(0, 255) } }, ['path', 'mimeType']),
        oneOf: [{ required: ['text'], not: { required: ['bytes'] } },
          { required: ['bytes'], not: { required: ['text'] } }] };
      return obj({ artifactId: id, idempotencyKey: key, files: { type: 'array', items: file,
        minItems: limits.publishFilesMin, maxItems: limits.publishFilesMax },
        profile: { ...primitiveRecord, default: config.defaults.profile } }, ['artifactId', 'files', 'idempotencyKey']);
    }
    case 'list': return obj({ limit: { ...integer(limits.listLimitMin, limits.listLimitMax), default: config.defaults.limit },
      offset: { ...integer(0), default: config.defaults.offset } });
    case 'get': case 'fork': case 'renew': case 'restore': return idOnly;
    case 'get_source': return obj({ artifactId: id, releaseId: id,
      paths: { type: 'array', minItems: 1, maxItems: 32, items: { ...str, maxLength: profile.rules.pathMaxBytes } } }, ['artifactId']);
    case 'delete': return obj({ artifactId: id, expectedCurrentReleaseId: { ...id, type: ['string', 'null'] },
      idempotencyKey: key, confirmationRef: { ...str, maxLength: 4096 } }, ['artifactId', 'expectedCurrentReleaseId', 'idempotencyKey']);
    case 'get_template': return obj({ templateId: str }, ['templateId']);
    case 'get_api_guide': return obj({ version: str });
    case 'create_upload': return obj({ artifactId: id, mimeType: str, maxSize: integer(1) }, ['artifactId', 'mimeType']);
    case 'commit_upload': return obj({ artifactId: id, uploadId: str, path: str, mimeType: str,
      digest: str, size: integer(0), profile: primitiveRecord, idempotencyKey: key },
    ['artifactId', 'uploadId', 'path', 'mimeType', 'digest', 'size', 'idempotencyKey']);
    case 'set_access': return { ...obj({ artifactId: id, action: { type: 'string', enum: ['grant', 'revoke'] },
      principalId: { ...str, maxLength: 256 }, grant: { type: 'string', enum: ['read'] }, idempotencyKey: key },
    ['artifactId', 'action', 'principalId', 'idempotencyKey']), oneOf: [
      { properties: { action: { enum: ['grant'] } }, required: ['grant'] },
      { properties: { action: { enum: ['revoke'] } }, not: { required: ['grant'] } },
    ] };
    case 'promote': return obj({ artifactId: id, releaseId: id, expectedCurrent: id }, ['artifactId', 'releaseId', 'expectedCurrent']);
    default: throw new Error(`unsupported operation profile: ${operation}`);
  }
}
