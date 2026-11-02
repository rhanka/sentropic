import { createAuthEmailRouteHandlers, type AuthHonoRouteHandlers } from '@sentropic/auth-hono';
import { Hono } from 'hono';
import { runCmAuthHttp } from './cm-http';

export const cmEmailHandlers: AuthHonoRouteHandlers = {
  requestEmailCode: c => runCmAuthHttp(c, 'email_code_issue', binding =>
    new Hono().all('*', createAuthEmailRouteHandlers({ service: binding.emailVerification }).requestEmailCode!)),
  verifyEmailCode: c => runCmAuthHttp(c, 'email_code', binding =>
    new Hono().all('*', createAuthEmailRouteHandlers({ service: binding.emailVerification }).verifyEmailCode!)),
};
