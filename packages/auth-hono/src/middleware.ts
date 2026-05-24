import type { Context, MiddlewareHandler, Next } from 'hono';

import type {
  AuthHonoPorts,
  AuthHonoSessionClaims,
  AuthHonoSessionRecord,
  AuthHonoUserRecord,
} from './ports.js';

export interface AuthHonoAuthContext {
  role: string;
  session: AuthHonoSessionClaims;
  sessionRecord: AuthHonoSessionRecord;
  token: string;
  user: AuthHonoUserRecord;
}

export interface AuthHonoMiddlewareVariables {
  auth: AuthHonoAuthContext;
  session: AuthHonoSessionClaims;
  user: AuthHonoUserRecord;
}

export interface AuthHonoMiddlewareEnv {
  Variables: AuthHonoMiddlewareVariables;
}

export interface CreateAuthMiddlewareOptions {
  ports: AuthHonoPorts;
  unauthorizedCode?: string;
  unauthorizedMessage?: string;
}

type AuthResult =
  | { kind: 'authenticated'; auth: AuthHonoAuthContext }
  | { kind: 'missing' }
  | { kind: 'rejected'; code: string; message: string; status: 401 | 403 };

export const createRequireAuth = (options: CreateAuthMiddlewareOptions): MiddlewareHandler => {
  return async (c, next) => {
    const result = await authenticateRequest(c, options);

    if (result.kind === 'missing') {
      return authError(c, {
        code: options.unauthorizedCode ?? 'unauthorized',
        message: options.unauthorizedMessage ?? 'Authentication required.',
        status: 401,
      });
    }

    if (result.kind === 'rejected') {
      return authError(c, result);
    }

    setAuthContext(c, result.auth);
    await next();
  };
};

export const createOptionalAuth = (options: CreateAuthMiddlewareOptions): MiddlewareHandler => {
  return async (c, next) => {
    const result = await authenticateRequest(c, options);

    if (result.kind === 'rejected') {
      return authError(c, result);
    }

    if (result.kind === 'authenticated') {
      setAuthContext(c, result.auth);
    }

    await next();
  };
};

const authenticateRequest = async (
  c: Context,
  options: CreateAuthMiddlewareOptions
): Promise<AuthResult> => {
  const token = readBearerToken(c.req.raw) ?? options.ports.cookies.readSessionToken(c.req.raw);

  if (!token) {
    return { kind: 'missing' };
  }

  const now = options.ports.clock.now();
  const claims = await options.ports.tokens.verifySessionToken(token);

  if (!claims) {
    return invalidSession();
  }

  const tokenHash = await options.ports.tokens.hashSecret(token);
  const sessionRecord = await options.ports.sessions.findByTokenHash(tokenHash);

  if (
    !sessionRecord ||
    sessionRecord.id !== claims.sessionId ||
    sessionRecord.userId !== claims.userId ||
    sessionRecord.revokedAt ||
    sessionRecord.expiresAt <= now
  ) {
    return invalidSession();
  }

  const user = await options.ports.users.findById(claims.userId);

  if (!user) {
    return invalidSession();
  }

  const decision = await options.ports.accountPolicy.canAuthenticate(user, now);

  if (!decision.allowed) {
    return {
      kind: 'rejected',
      code: decision.code ?? 'forbidden',
      message: decision.message ?? 'Authentication is not allowed for this account.',
      status: decision.status === 401 ? 401 : 403,
    };
  }

  const role = await options.ports.accountPolicy.resolveSessionRole(user, now);
  const session = { ...claims, role };

  await options.ports.sessions.touch(sessionRecord.id, now);

  return {
    kind: 'authenticated',
    auth: {
      role,
      session,
      sessionRecord,
      token,
      user,
    },
  };
};

const invalidSession = (): AuthResult => ({
  kind: 'rejected',
  code: 'invalid_session',
  message: 'Session is invalid or expired.',
  status: 401,
});

const readBearerToken = (request: Request): string | null => {
  const header = request.headers.get('Authorization');

  if (!header) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
};

const setAuthContext = (c: Context, auth: AuthHonoAuthContext): void => {
  const typedContext = c as Context<AuthHonoMiddlewareEnv>;
  typedContext.set('auth', auth);
  typedContext.set('session', auth.session);
  typedContext.set('user', auth.user);
};

const authError = (
  c: Context,
  error: { code: string; message: string; status: 401 | 403 }
): Response => {
  return c.json(
    {
      error: {
        code: error.code,
        message: error.message,
      },
    },
    error.status
  );
};
