import { DEVELOPMENT_EMAIL_TICKET_SEED, resolveDeploymentSecret } from '../../config/deployment-secrets';

/** Email-ticket signing key: `JWT_SECRET` in a deployed runtime (fail-closed), the inherited seed in dev/test. */
export const resolveEmailVerificationTokenSecret = (): string =>
  resolveDeploymentSecret('JWT_SECRET', DEVELOPMENT_EMAIL_TICKET_SEED);
