import type { Context } from 'hono';

import type { AuthHonoPorts } from '../ports.js';
import { createJwksService } from './jwks-service.js';
import { oauthJsonError } from './http-utils.js';
import {
  TOKEN_EXCHANGE_MAX_TTL_SECONDS,
  TOKEN_EXCHANGE_REQUESTED_TOKEN_TYPE,
  TOKEN_EXCHANGE_SUBJECT_TOKEN_TYPE,
  type ServiceClientRecord,
} from './state-store-types.js';

export interface TokenExchangeHandlerOptions {
  exchangeEnvironment?: string | null;
  issuer: string;
  ports: AuthHonoPorts;
}

export const handleTokenExchange = async (
  c: Context,
  form: URLSearchParams,
  options: TokenExchangeHandlerOptions
): Promise<Response> => {
  const subjectToken = form.get('subject_token') ?? '';
  const subjectType = form.get('subject_token_type') ?? '';
  if (!subjectToken || subjectType !== TOKEN_EXCHANGE_SUBJECT_TOKEN_TYPE) {
    return oauthJsonError(c, 400, 'invalid_request', 'A valid subject_token of access_token type is required.');
  }
  const requestedType = form.get('requested_token_type');
  if (requestedType && requestedType !== TOKEN_EXCHANGE_REQUESTED_TOKEN_TYPE) {
    return oauthJsonError(c, 400, 'invalid_request', 'Only access_token requested_token_type is supported.');
  }
  if (form.get('actor_token') ?? form.get('actor_token_type')) {
    return oauthJsonError(c, 400, 'invalid_request', 'Delegated actor tokens are not supported.');
  }
  if (c.req.header('dpop')) {
    return oauthJsonError(c, 400, 'invalid_request', 'DPoP-bound exchange is not supported.');
  }
  const target = resolveTarget(c, form);
  if (target instanceof Response) return target;
  const requestedScopes = parseScopes(form.get('scope'));
  if (requestedScopes.length === 0) {
    return oauthJsonError(c, 400, 'invalid_scope', 'A non-empty scope is required.');
  }

  const auth = await authenticateWorkload(c, form, options.ports);
  if (auth instanceof Response) return auth;
  const policy = auth.exchangePolicy;
  if (!policy || !policy.enabled) {
    return oauthJsonError(c, 400, 'invalid_grant', 'Token exchange is not enabled for this client.');
  }
  if (policy.environment && options.exchangeEnvironment && policy.environment !== options.exchangeEnvironment) {
    return oauthJsonError(c, 400, 'invalid_grant', 'Token exchange environment mismatch.');
  }
  if (!policy.allowedTargetAudiences.includes(target)) {
    return oauthJsonError(c, 400, 'invalid_target', 'Requested audience is not allowed for this client.');
  }
  const disallowed = requestedScopes.filter((scope) => !policy.allowedScopes.includes(scope));
  if (disallowed.length > 0) {
    return oauthJsonError(c, 400, 'invalid_scope', `Scope not allowed: ${disallowed.join(' ')}.`);
  }

  const verified = await verifySubject(c, subjectToken, auth, policy, options);
  if (verified instanceof Response) return verified;

  const issued = requestedScopes.filter((scope) => verified.subjectScopes.includes(scope));
  if (issued.length === 0) {
    return oauthJsonError(c, 400, 'invalid_scope', 'No requested scope is granted to the subject.');
  }
  const now = options.ports.clock.now();
  const subjectExpMs = verified.subjectExp * 1000 - now.getTime();
  const ceiling = Math.min(policy.maxTtlSeconds, TOKEN_EXCHANGE_MAX_TTL_SECONDS);
  const ttl = Math.min(ceiling, Math.floor(subjectExpMs / 1000));
  if (!(ceiling > 0) || !(ttl > 0)) {
    return oauthJsonError(c, 400, 'invalid_grant', 'Subject token expiry leaves no exchange lifetime.');
  }
  const expiresAt = options.ports.clock.addSeconds(now, ttl);
  const jwks = createJwksService({ clock: options.ports.clock, jwksPort: options.ports.jwks });
  const jti = options.ports.random.uuid();
  const accessToken = await jwks.signJwt(
    {
      act: { sub: policy.actorSub },
      client_id: auth.clientId,
      scope: issued.join(' '),
      ...(verified.tenantId ? { tid: verified.tenantId } : {}),
    },
    {
      audience: target,
      expiresAt,
      issuer: trimTrailingSlash(options.issuer),
      jti,
      subject: verified.subject,
      type: 'JWT',
    }
  );
  await options.ports.oauthStateStore.saveTokenMeta(
    jti,
    {
      audience: target,
      clientId: auth.clientId,
      createdAt: now,
      dpopJkt: null,
      expiresAt,
      jti,
      scope: issued.join(' '),
      tenantId: verified.tenantId,
      tokenType: 'access_token',
      userId: verified.subject,
    },
    ttl
  );
  return c.json({
    access_token: accessToken,
    expires_in: ttl,
    issued_token_type: TOKEN_EXCHANGE_REQUESTED_TOKEN_TYPE,
    scope: issued.join(' '),
    token_type: 'Bearer',
  });
};

const resolveTarget = (c: Context, form: URLSearchParams): string | Response => {
  const values = [...form.getAll('resource'), ...form.getAll('audience')].filter((v) => v.length > 0);
  if (new Set(values).size > 1) {
    return oauthJsonError(c, 400, 'invalid_target', 'Conflicting target audiences are not supported.');
  }
  if (values.length === 0) {
    return oauthJsonError(c, 400, 'invalid_target', 'A target audience is required.');
  }
  return values[0];
};

const parseScopes = (raw: string | null): string[] => (raw ?? '').split(/\s+/).filter(Boolean);

const authenticateWorkload = async (
  c: Context,
  form: URLSearchParams,
  ports: AuthHonoPorts
): Promise<ServiceClientRecord | Response> => {
  const { clientId, secret } = parseCredentials(c.req.header('authorization'), form);
  if (!clientId || !secret) return oauthJsonError(c, 401, 'invalid_client', 'Client authentication is required.');
  const findServiceClient = ports.oauthStateStore.findServiceClient;
  if (!findServiceClient) return oauthJsonError(c, 401, 'invalid_client', 'Client authentication failed.');
  if (await ports.oauthStateStore.findClient(clientId)) {
    return oauthJsonError(c, 401, 'invalid_client', 'Public clients cannot perform token exchange.');
  }
  const client = await findServiceClient(clientId);
  if (!client) return oauthJsonError(c, 401, 'invalid_client', 'Client authentication failed.');
  if ((await ports.tokens.hashSecret(secret)) !== client.clientSecretHash) {
    return oauthJsonError(c, 401, 'invalid_client', 'Client authentication failed.');
  }
  return client;
};

const parseCredentials = (
  authorization: string | undefined,
  form: URLSearchParams
): { clientId: string | null; secret?: string } => {
  if (authorization?.startsWith('Basic ')) {
    const decoded = atob(authorization.slice('Basic '.length));
    const separator = decoded.indexOf(':');
    return {
      clientId: separator >= 0 ? decoded.slice(0, separator) : decoded,
      secret: separator >= 0 ? decoded.slice(separator + 1) : '',
    };
  }
  return { clientId: form.get('client_id'), secret: form.get('client_secret') ?? undefined };
};

const verifySubject = async (
  c: Context,
  subjectToken: string,
  workload: ServiceClientRecord,
  policy: NonNullable<ServiceClientRecord['exchangePolicy']>,
  options: TokenExchangeHandlerOptions
): Promise<{ subject: string; subjectExp: number; subjectScopes: string[]; tenantId: string | null } | Response> => {
  const now = options.ports.clock.now();
  const jwks = createJwksService({ clock: options.ports.clock, jwksPort: options.ports.jwks });
  let payload: Record<string, unknown>;
  try {
    const verified = await jwks.verifyJwt(subjectToken, {
      currentDate: now,
      issuer: trimTrailingSlash(options.issuer),
    });
    payload = verified.payload as Record<string, unknown>;
  } catch {
    return oauthJsonError(c, 400, 'invalid_grant', 'Subject token is invalid or expired.');
  }
  if (payload.act != null) {
    return oauthJsonError(c, 400, 'invalid_grant', 'Already-exchanged tokens do not qualify.');
  }
  if (payload.cnf != null) {
    return oauthJsonError(c, 400, 'invalid_grant', 'Proof-bound subject tokens are not supported.');
  }
  const subject = payload.sub;
  const audience = payload.aud;
  const clientId = payload.client_id;
  const scopeRaw = payload.scope;
  const subjectExp = payload.exp;
  if (typeof subject !== 'string' || !subject) {
    return oauthJsonError(c, 400, 'invalid_grant', 'Subject token has no human subject.');
  }
  if (typeof audience !== 'string' || !policy.allowedSubjectAudiences.includes(audience)) {
    return oauthJsonError(c, 400, 'invalid_grant', 'Subject token audience is not allowed.');
  }
  if (typeof clientId !== 'string' || !policy.allowedSubjectClients.includes(clientId)) {
    return oauthJsonError(c, 400, 'invalid_grant', 'Subject token client is not allowed.');
  }
  if (typeof subjectExp !== 'number' || !(subjectExp * 1000 > now.getTime())) {
    return oauthJsonError(c, 400, 'invalid_grant', 'Subject token is expired.');
  }
  const subjectScopes = typeof scopeRaw === 'string' ? scopeRaw.split(/\s+/).filter(Boolean) : [];
  if (subjectScopes.length === 0) {
    return oauthJsonError(c, 400, 'invalid_grant', 'Subject token carries no scope.');
  }
  const jti = payload.jti;
  if (typeof jti === 'string' && jti) {
    const meta = await options.ports.oauthStateStore.findTokenMeta(jti);
    if (!meta) return oauthJsonError(c, 400, 'invalid_grant', 'Subject token is unknown.');
    if (await options.ports.oauthStateStore.isTokenRevoked(jti)) {
      return oauthJsonError(c, 400, 'invalid_grant', 'Subject token is revoked.');
    }
  }
  const user = await options.ports.users.findById(subject);
  if (!user) return oauthJsonError(c, 400, 'invalid_grant', 'Subject identity is unknown.');
  void workload;
  const tid = payload.tid;
  if (typeof tid === 'string' && tid) {
    if (options.ports.tenant && !(await options.ports.tenant.isApprovedMember(subject, tid))) {
      return oauthJsonError(c, 400, 'invalid_grant', 'Subject membership is not approved.');
    }
    return { subject, subjectExp, subjectScopes, tenantId: tid };
  }
  return { subject, subjectExp, subjectScopes, tenantId: null };
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/u, '');
