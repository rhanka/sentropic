import type { AuthHonoPorts } from '../ports.js';
import type { ServiceClientRecord } from './state-store-types.js';

/**
 * Shared confidential-client authentication core (m4): service-client lookup
 * plus secret-hash verification. Both the `client_credentials` handler and
 * the RFC 8693 exchange handler consume it; their divergent policies (public
 * client refusal, revocation, dual-credential refusal) stay in the callers.
 * Unknown client and secret mismatch are indistinguishable (undefined): the
 * callers map both to the same `invalid_client` refusal without oracle.
 */
export const resolveConfidentialClient = async (args: {
  ports: Pick<AuthHonoPorts, 'tokens'>;
  clientId: string;
  secret: string;
  findServiceClient: NonNullable<AuthHonoPorts['oauthStateStore']['findServiceClient']>;
}): Promise<ServiceClientRecord | undefined> => {
  const client = await args.findServiceClient(args.clientId);
  if (!client) return undefined;
  const secretHash = await args.ports.tokens.hashSecret(args.secret);
  if (!constantTimeEqual(secretHash, client.clientSecretHash)) return undefined;
  return client;
};

/**
 * Length-prefixed constant-time string comparison (m4): no early exit on the
 * first differing character, unlike `!==`. Implemented without `node:crypto`
 * so auth-hono stays runnable outside Node. Hash digests have a fixed length;
 * a length mismatch refuses (the stored digest is corrupt, not comparable).
 */
export const constantTimeEqual = (actual: string, expected: string): boolean => {
  const length = Math.max(actual.length, expected.length);
  let diff = actual.length ^ expected.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return diff === 0;
};
