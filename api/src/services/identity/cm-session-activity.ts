import { pool } from '../../db/client';
import { logger } from '../../logger';

/** Activity is best-effort and must not abort a validated authentication decision. */
export const touchCmSessionActivity = async (id: string, at: Date): Promise<void> => {
  try {
    await pool.query(
      'UPDATE "cm_identity"."identity_login_token_bindings" SET "last_activity_at" = $2 WHERE "session_id" = $1',
      [id, at.toISOString()],
    );
  } catch (error) {
    logger.warn({ err: error, sessionId: id }, 'CM session activity touch unavailable');
  }
};
