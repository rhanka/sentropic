import type { AuthHonoDeviceInfo, AuthHonoSessionService } from '@sentropic/auth-hono';
import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';
import { withAppCmAuth } from './cm-auth-runtime';
import { touchCmSessionActivity } from './cm-session-activity';

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
    // Page loads share the same login row. Keep validation read-only, then
    // record liveness outside its serializable snapshot, as HTTP auth does.
    const result = await runner.complete('session_validate', binding => binding.sessions.validateSessionToken(token));
    if (result.committed && result.value) await touchCmSessionActivity(result.value.sessionRecord.id, new Date());
    return result.committed ? result.value : null;
  }),
};

export const createCmLoginForSubject = (userId: string, deviceInfo?: AuthHonoDeviceInfo) =>
  withAppCmAuth(runner => runner.request(async binding => {
    const user = await binding.ports.users.findById(userId);
    if (!user) throw new IdentityCustodyErrorV1('identity_material_missing');
    return binding.sessions.createSession({ user, deviceInfo, mfaVerified: false });
  }));
