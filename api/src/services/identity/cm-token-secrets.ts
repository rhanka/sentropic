import { env } from '../../config/env';

/** Preserve the exact inherited email-ticket signing seed through the custody cutover. */
export const resolveEmailVerificationTokenSecret = (): string =>
  env.JWT_SECRET || 'default-secret-change-in-production';
