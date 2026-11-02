/** Published domain-result envelope; error details are selected by code and variant. */
const string = { type: 'string' };
const nullable = { type: ['string', 'null'] };
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const error = (code: string, details: unknown) => object({
  code: { enum: [code] }, message: string, retriable: { type: 'boolean' }, details,
});
const pointer = object({ variant: { enum: ['pointer_conflict'] }, artifactId: string,
  expectedCurrentReleaseId: nullable, currentReleaseId: nullable, currentDigest: nullable,
  currentSource: object({ artifactId: string, releaseId: string, digest: nullable,
    manifest: string, files: { type: 'array', items: { type: 'object' } }, sourceRef: { type: ['object', 'null'] },
    stableUrl: string, pinnedUrl: string }, ['artifactId', 'releaseId', 'digest', 'manifest', 'files', 'sourceRef']),
}, ['variant', 'artifactId', 'expectedCurrentReleaseId', 'currentReleaseId', 'currentDigest']);
const common = { invocationId: string,
  commitState: { enum: ['not_committed', 'committed', 'unknown'] } };
export const ARTIFACT_RESULT_SCHEMA = {
  oneOf: [
    object({ ok: { enum: [true] }, ...common, replayed: { type: 'boolean' }, output: { type: 'object' } }),
    object({ ok: { enum: [false] }, ...common, error: { oneOf: [
      error('conflict', { oneOf: [pointer, object({ variant: { enum: ['command_conflict', 'key_contention', 'quota_exhausted'] } })] }),
      error('edit_mismatch', object({ path: string, editIndex: { type: 'integer', minimum: 0 },
        reason: { enum: ['missing', 'ambiguous', 'not_text', 'file_missing'] }, occurrences: { type: 'integer' } })),
      error('release_unavailable', object({ reason: { enum: ['purged', 'not_retained', 'unpublished'] } })),
      object({ code: { type: 'string', not: { enum: ['conflict', 'edit_mismatch', 'release_unavailable'] } },
        message: string, retriable: { type: 'boolean' }, details: object({ variant: string }) }, ['code', 'message', 'retriable']),
    ] } }),
  ],
} as const;
