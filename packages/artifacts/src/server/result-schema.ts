/** Published domain-result envelope; error details are selected by code and variant. */
const string = { type: 'string' };
const nullable = { type: ['string', 'null'] };
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const error = (code: string, details: unknown) => object({
  code: { enum: [code] }, message: string, retriable: { type: 'boolean' }, details,
});
/** get_source file: verified raw bytes encoded as UTF-8 text or base64, never an integer array. */
const sourceFile = { type: 'object', additionalProperties: false,
  properties: { path: string, mimeType: string, size: { type: 'integer', minimum: 0 }, digest: string,
    encoding: { enum: ['utf8', 'base64'] }, text: string, base64: string },
  required: ['path', 'mimeType', 'size', 'digest', 'encoding'],
  oneOf: [{ required: ['text'], not: { required: ['base64'] } },
    { required: ['base64'], not: { required: ['text'] } }] };
const guideRef = object({ tool: string, version: string }, ['tool', 'version']);
const pointer = object({ variant: { enum: ['pointer_conflict'] }, artifactId: string,
  expectedCurrentReleaseId: nullable, currentReleaseId: nullable, currentDigest: nullable,
  currentSource: object({ artifactId: string, releaseId: string, digest: nullable,
    manifest: string, files: { type: 'array', items: sourceFile }, sourceRef: { type: ['object', 'null'] },
    guideRef, stableUrl: string, versionUrl: string },
    ['artifactId', 'releaseId', 'digest', 'manifest', 'files', 'sourceRef', 'guideRef']),
}, ['variant', 'artifactId', 'expectedCurrentReleaseId', 'currentReleaseId', 'currentDigest']);
const common = { invocationId: string,
  commitState: { enum: ['not_committed', 'committed', 'unknown'] } };
export const ARTIFACT_RESULT_SCHEMA = {
  type: 'object',
  oneOf: [
    object({ ok: { enum: [true] }, ...common, replayed: { type: 'boolean' }, output: { type: 'object' } }),
    object({ ok: { enum: [false] }, ...common, error: { oneOf: [
      error('conflict', { oneOf: [pointer, object({ variant: { enum: ['command_conflict', 'key_contention', 'quota_exhausted'] } })] }),
      error('edit_mismatch', object({ path: string, editIndex: { type: 'integer', minimum: 0 },
        reason: { enum: ['missing', 'ambiguous', 'not_text', 'file_missing'] }, occurrences: { type: 'integer' } })),
      error('release_unavailable', object({ reason: { enum: ['purged', 'not_retained', 'unpublished'] } })),
      error('precondition_required', object({ profileRevisionId: string, resultEnvelopeVersion: { enum: [1, 2] },
        requiredField: { enum: ['expectedCurrentReleaseId'] }, readTools: { type: 'array', items: string } })),
      error('confirmation_required', object({ confirmationRef: string, managementUrl: string, expiresAt: string })),
      object({ code: { type: 'string', not: { enum: ['conflict', 'edit_mismatch', 'release_unavailable',
        'precondition_required', 'confirmation_required'] } },
        message: string, retriable: { type: 'boolean' }, details: object({ variant: string }) }, ['code', 'message', 'retriable']),
    ] } }),
  ],
} as const;
