/**
 * L-5a — public artifact client builders (spec-v8 §9).
 *
 * No I/O, no server, driver or cluster-mesh imports: this module builds
 * validated ensure requests and parses ensure responses for any transport
 * (HTTP in L-5c, MCP in L-5e). Parameter values are validated against the
 * provider's schema up front; response identities are checked to be
 * server-allocated UUIDs clients cannot forge.
 */
import { isArtifactId } from './contracts.js';
import { validateParameters, type ParameterSchema } from './parameters.js';

export interface EnsureRequest {
  bindingName: string;
  storageScopeId: string;
  idempotencyKey: string;
  paramsHash: string;
  parameters: Record<string, string | number | boolean | null>;
}

export interface EnsureResponse {
  artifactId: string;
  created: boolean;
  replayed: boolean;
}

/** Build a validated ensure request for a provider's parameter schema. */
export function buildEnsureRequest(
  schema: ParameterSchema,
  input: {
    bindingName: string;
    storageScopeId: string;
    idempotencyKey: string;
    paramsHash: string;
    parameters: Record<string, string | number | boolean | null | undefined>;
  },
): EnsureRequest {
  if (input.bindingName.length === 0) throw new Error('invalid ensure request: empty bindingName');
  if (input.storageScopeId.length === 0) throw new Error('invalid ensure request: empty storageScopeId');
  if (input.idempotencyKey.length === 0) throw new Error('invalid ensure request: empty idempotencyKey');
  const parameters = validateParameters(schema, input.parameters) as EnsureRequest['parameters'];
  return {
    bindingName: input.bindingName,
    storageScopeId: input.storageScopeId,
    idempotencyKey: input.idempotencyKey,
    paramsHash: input.paramsHash,
    parameters,
  };
}

/** Parse and validate an ensure response (server-allocated identity). */
export function parseEnsureResponse(raw: unknown): EnsureResponse {
  if (typeof raw !== 'object' || raw === null) throw new Error('invalid ensure response: not an object');
  const response = raw as Record<string, unknown>;
  if (!isArtifactId(response['artifactId'])) throw new Error('invalid ensure response: forged artifactId');
  if (typeof response['created'] !== 'boolean' || typeof response['replayed'] !== 'boolean') {
    throw new Error('invalid ensure response: bad flags');
  }
  return {
    artifactId: response['artifactId'] as string,
    created: response['created'] as boolean,
    replayed: response['replayed'] as boolean,
  };
}
