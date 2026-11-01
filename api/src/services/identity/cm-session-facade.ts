import type { AuthHonoSessionService } from '@sentropic/auth-hono';
import { withAppCmAuth } from './cm-auth-runtime';

/** Root calls enter CM; transaction-bound consumers use binding.sessions directly. */
export const cmAuthSessionService: AuthHonoSessionService = {
  createSession: input => withAppCmAuth(runner => runner.request(binding => binding.sessions.createSession(input))),
  listUserSessions: userId => withAppCmAuth(runner => runner.request(binding => binding.sessions.listUserSessions(userId))),
  revokeSession: sessionId => withAppCmAuth(runner => runner.request(binding => binding.sessions.revokeSession(sessionId))),
  revokeAllSessions: userId => withAppCmAuth(runner => runner.request(binding => binding.sessions.revokeAllSessions(userId))),
  refreshSession: token => withAppCmAuth(async runner => {
    const result = await runner.complete('session_refresh', binding => binding.sessions.refreshSession(token));
    return result.committed ? result.value : null;
  }),
  validateSessionToken: token => withAppCmAuth(async runner => {
    const result = await runner.complete('session_validate', binding => binding.sessions.validateSessionToken(token));
    return result.committed ? result.value : null;
  }),
};
