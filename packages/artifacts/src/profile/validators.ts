import { ArtifactProfileInputError, type ArtifactSchema, type CompiledArtifactsProfile,
  type CompiledValidators } from './contracts.js';
import { copyJson, isRecord } from './json.js';
import { matchesSchema } from './validation.js';
import { createArtifactCommand, type ArtifactCommandInput } from '../server/command-identity.js';

/** Validators close over the same immutable schemas, limits and command compiler. */
export function compileValidators(profile: CompiledArtifactsProfile): CompiledValidators {
  const field = (schema: ArtifactSchema | undefined, key: string): ArtifactSchema | undefined =>
    (schema?.properties as Record<string, ArtifactSchema> | undefined)?.[key];
  const accepts = (check: () => boolean): boolean => {
    try { return check(); } catch (error) {
      if (error instanceof ArtifactProfileInputError) return false;
      throw error;
    }
  };
  const keySchemas = Object.values(profile.schemas).flatMap((schema) => {
    const key = field(schema, 'idempotencyKey');
    return key ? [key] : [];
  });
  return {
    validateBindingName: (value) => accepts(() => {
      const schema = field(profile.schemas.artifacts_ensure, 'bindingName');
      return !!schema && matchesSchema(copyJson(value), schema);
    }),
    validateCallerKey: (value) => accepts(() => typeof value === 'string' && !!value.trim() &&
      keySchemas.length > 0 && keySchemas.every((schema) => matchesSchema(copyJson(value), schema))),
    validateFileEntry: (entry) => accepts(() => {
      const schema = field(profile.schemas.artifacts_publish, 'files')?.items as ArtifactSchema | undefined;
      const file = copyJson(entry);
      if (!schema || !isRecord(file) || !matchesSchema(file, schema)) return false;
      const limits = profile.operations.find((op) => op.operation === 'publish')!.limits;
      const size = Object.hasOwn(file, 'text') ? Buffer.byteLength(file.text as string, 'utf8') :
        (file.bytes as number[]).length;
      return Buffer.byteLength(file.path as string, 'utf8') <= profile.rules.pathMaxBytes &&
        size <= limits.maxDecodedFileBytes;
    }),
    normalizeCommand(value) {
      if (!isRecord(value) || typeof value.capability !== 'string' || !isRecord(value.authority) ||
        !isRecord(value.derivation) || typeof value.derivation.derive !== 'function' ||
        (value.envelopeKey !== undefined && typeof value.envelopeKey !== 'string') ||
        Object.keys(value).some((key) => !['capability', 'args', 'authority', 'derivation', 'envelopeKey'].includes(key))) {
        throw new ArtifactProfileInputError();
      }
      const input = value as unknown as ArtifactCommandInput;
      return createArtifactCommand(profile, input.capability, input.args, input.authority,
        input.derivation, input.envelopeKey);
    },
  };
}
