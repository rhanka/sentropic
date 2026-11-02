import { logger } from '../../logger';
import { createOauthStateStoreAdapter } from './oauth-state-adapter';
import { runCmIdentityWrite } from '../identity/cm-transaction';

export const OAUTH_TOKEN_PURGE_INTERVAL_MS = 5 * 60 * 1000;

export const purgeExpiredOAuthTokens = async (): Promise<number> => {
  const deleted = await runCmIdentityWrite(transaction => createOauthStateStoreAdapter({ transaction }).purgeExpired());
  if (deleted > 0) {
    logger.info({ deleted }, 'Purged expired OAuth state records');
  }
  return deleted;
};

export const createOAuthTokenPurgeJob = () => ({
  intervalMs: OAUTH_TOKEN_PURGE_INTERVAL_MS,
  name: 'oauth-token-purge',
  run: purgeExpiredOAuthTokens,
});
