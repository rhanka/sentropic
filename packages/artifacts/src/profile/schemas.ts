import type { ArtifactCapabilityName, ArtifactProviderProfile, EffectiveArtifactProfile, ArtifactSchema, OperationProfile } from './contracts.js';

const str = { type: 'string', minLength: 1 };
const integer = (minimum: number, maximum?: number) => ({ type: 'integer', minimum,
  ...(maximum === undefined ? {} : { maximum }) });
const obj = (properties: Record<string, unknown>, required: string[] = []): ArtifactSchema =>
  ({ type: 'object', properties, required, additionalProperties: false });
const id = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };
const primitiveRecord = { type: 'object',
  additionalProperties: { type: ['string', 'number', 'boolean', 'null'] }, default: {} };
/** Artifact display metadata: one short word for the icon. */
const metadata = {
  title: { type: 'string', minLength: 1, maxLength: 160, description: 'Artifact display title.' },
  description: { type: 'string', maxLength: 2000, description: 'Short artifact description.' },
  icon: { type: ['string', 'null'], pattern: '^[a-z][a-z0-9-]{0,31}$',
    description: 'One short lowercase word.' },
} as const;

/** Required configuration includes semantic limits absent from JSON Schema. */
export function assertCompleteOperation(config: OperationProfile): void {
  const required: Record<string, { limits: string[]; defaults: string[] }> = {
    ensure: { limits: ['bindingNameMinUnits', 'bindingNameMaxUnits', 'idempotencyKeyMaxUnits'],
      defaults: ['parameters'] },
    publish: { limits: ['idempotencyKeyMaxUnits', 'publishFilesMin', 'publishFilesMax',
      'maxDecodedFileBytes', 'maxDecodedTotalBytes'], defaults: ['profile'] },
    list: { limits: ['listLimitMin', 'listLimitMax'], defaults: ['limit', 'offset'] },
    commit_upload: { limits: ['idempotencyKeyMaxUnits'], defaults: ['profile'] },
    revert: { limits: ['idempotencyKeyMaxUnits'], defaults: [] },
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
      idempotencyKey: key, ...metadata }, ['bindingName', 'idempotencyKey']);
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
      const edit = obj({ path, oldStr: { type: 'string', minLength: 1, maxLength: limits.maxDecodedFileBytes,
        description: 'Must occur exactly once in the current file text.' },
        newStr: { type: 'string', maxLength: limits.maxDecodedFileBytes } }, ['path', 'oldStr', 'newStr']);
      return obj({ artifactId: id, idempotencyKey: key,
        files: { type: 'array', items: file, minItems: limits.publishFilesMin, maxItems: limits.publishFilesMax,
          description: 'Full file set; required unless edits is supplied.' },
        edits: { type: 'array', items: edit, minItems: 1, maxItems: 100,
          description: 'Small old/new edits applied to the current release text files; required unless files is supplied.' },
        expectedCurrentReleaseId: { ...id, type: ['string', 'null'], description: 'Compare the current release atomically; null requires an unpublished artifact.' },
        profile: { ...primitiveRecord, default: config.defaults.profile },
        ...metadata }, ['artifactId', 'idempotencyKey', ...(profile.requireExpectedCurrentReleaseId ? ['expectedCurrentReleaseId'] : [])]);
    }
    case 'list': return obj({ limit: { ...integer(limits.listLimitMin, limits.listLimitMax), default: config.defaults.limit },
      offset: { ...integer(0), default: config.defaults.offset } });
    case 'get': case 'get_source': case 'list_versions': case 'fork': case 'renew': case 'delete': case 'restore': return idOnly;
    case 'revert': return obj({ artifactId: id, releaseId: id, expectedCurrentReleaseId: { ...id, type: ['string', 'null'] }, idempotencyKey: key },
      ['artifactId', 'releaseId', 'idempotencyKey', ...(profile.requireExpectedCurrentReleaseId ? ['expectedCurrentReleaseId'] : [])]);
    case 'get_template': return obj({ templateId: str }, ['templateId']);
    case 'get_api_guide': return obj({ version: str });
    case 'create_upload': return obj({ artifactId: id, mimeType: str, maxSize: integer(1) }, ['artifactId', 'mimeType']);
    case 'commit_upload': return obj({ artifactId: id, uploadId: str, path: str, mimeType: str,
      digest: str, size: integer(0), profile: primitiveRecord, idempotencyKey: key },
    ['artifactId', 'uploadId', 'path', 'mimeType', 'digest', 'size', 'idempotencyKey']);
    case 'set_access': return obj({ artifactId: id, action: { type: 'string', enum: ['grant', 'revoke', 'set-public'] },
      principalId: str, grant: { type: 'string', enum: ['read', 'source'] }, isPublic: { type: 'boolean' } }, ['artifactId', 'action']);
    case 'promote': return obj({ artifactId: id, releaseId: id, expectedCurrent: id }, ['artifactId', 'releaseId', 'expectedCurrent']);
    default: throw new Error(`unsupported operation profile: ${operation}`);
  }
}
