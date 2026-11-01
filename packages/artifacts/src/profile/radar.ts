import type { EffectiveArtifactProfile } from './contracts.js';
import { freezeDeep } from './json.js';

/** Explicit host input, never an implicit fallback for a missing selection. */
export const RADAR_ARTIFACTS_PROFILE: EffectiveArtifactProfile = freezeDeep<EffectiveArtifactProfile>({
  version: 'artifacts-profile/v1',
  selectedCapabilities: ['artifacts_ensure', 'artifacts_publish', 'artifacts_list', 'artifacts_get'],
  operations: [
    { operation: 'ensure', limits: { bindingNameMinUnits: 1, bindingNameMaxUnits: 128,
      idempotencyKeyMaxUnits: 256 }, defaults: { parameters: {} } },
    { operation: 'publish', limits: { idempotencyKeyMaxUnits: 256, publishFilesMin: 1, publishFilesMax: 32,
      maxDecodedFileBytes: 262144, maxDecodedTotalBytes: 262144 }, defaults: { profile: {} } },
    { operation: 'list', limits: { listLimitMin: 1, listLimitMax: 100 }, defaults: { limit: 20, offset: 0 } },
    { operation: 'get', limits: {}, defaults: {} },
    { operation: 'list_versions', limits: {}, defaults: {} },
    { operation: 'get_source', limits: {}, defaults: {} },
    { operation: 'revert', limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} },
  ],
  rules: { lengthUnit: 'utf16', textEncoding: 'utf8', callerKeyNormalization: 'none',
    rejectLoneSurrogates: true, provenance: 'inline-original', keyDerivationAlgorithm: 'radar-derive-idempotency-v1', pathMaxBytes: 1024,
    forbiddenPathPattern: '[\\\\%?#:\\u0000-\\u001f\\u007f]',
    reservedFirstSegments: ['api', '__artifacts', 'livez', 'health'],
    mimeTypes: ['text/html', 'text/css', 'text/javascript', 'application/json'] },
  contractRevisions: { profile: 'artifacts-profile/v1', command: 'artifacts-command/v1',
    authorization: 'artifacts-authorization/v1', outcome: 'artifacts-outcome/v1' },
});
