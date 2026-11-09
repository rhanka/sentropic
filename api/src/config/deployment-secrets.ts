import { env, requiresOAuthProductionSecrets } from './env';

/**
 * Public development seeds. They are committed to this repository, so they can never key anything in
 * a deployed runtime; outside one they keep dev and test data and tokens byte-identical. This module
 * is the ONLY place that spells them (a unit test enforces it): no other file may carry a literal key.
 */
export const DEVELOPMENT_SECRET_SEED = 'dev-secret-key-change-in-production-please';
/** The inherited email-ticket seed, kept distinct so dev email tickets survive unchanged. */
export const DEVELOPMENT_EMAIL_TICKET_SEED = 'default-secret-change-in-production';
const PUBLIC_SEEDS: ReadonlySet<string> = new Set([
  DEVELOPMENT_SECRET_SEED,
  DEVELOPMENT_EMAIL_TICKET_SEED,
  // The standalone IdP dev compose default (docker-compose.idp.yml).
  'dev-idp-jwt-secret-change-in-production',
]);

export type DeploymentSecretName = 'JWT_SECRET' | 'SECRET_ENCRYPTION_KEY';

/** A deployed runtime lacks a provisioned key. Carries the variable NAME only, never a value. */
export class MissingDeploymentSecretError extends Error {
  readonly secret: DeploymentSecretName;

  constructor(secret: DeploymentSecretName) {
    super(`${secret} must be provisioned (non-blank, not a public development seed) in a deployed runtime.`);
    this.name = 'MissingDeploymentSecretError';
    this.secret = secret;
  }
}

/** True only for a non-blank value that is not one of the committed development seeds. */
export const isProvisionedDeploymentSecret = (value: string | undefined): boolean => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 && !PUBLIC_SEEDS.has(trimmed);
};

/**
 * The key a host signs or seals with.
 *
 * A deployed runtime (`requiresOAuthProductionSecrets`) gets the delivered value or a refusal: no
 * literal fallback. Dev and test get the delivered value, else the named development seed; `||` (not
 * `??`) because the secret bundle emits present-but-EMPTY keys. The value is returned as delivered:
 * never trimmed or normalised, since either would move every key derived from it.
 */
export const resolveDeploymentSecret = (name: DeploymentSecretName, developmentSeed: string): string => {
  const value = env[name];
  if (isProvisionedDeploymentSecret(value)) return value as string;
  if (requiresOAuthProductionSecrets()) throw new MissingDeploymentSecretError(name);
  return value || developmentSeed;
};

/** Boot gate for the api and IdP listeners: refuse to serve rather than sign or seal with a public key. */
export const assertDeploymentSecrets = (): void => {
  resolveDeploymentSecret('JWT_SECRET', DEVELOPMENT_SECRET_SEED);
  resolveDeploymentSecret('SECRET_ENCRYPTION_KEY', DEVELOPMENT_SECRET_SEED);
};
