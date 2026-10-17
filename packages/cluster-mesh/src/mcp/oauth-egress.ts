import { createTokenExchangeClient, SubjectVerificationError } from '../token-exchange.js';
import { ACCESS_TOKEN_TYPE, RFC8693_GRANT_TYPE } from '../trust.js';
import { oauthAuthority, type OAuthRequestAuthority } from './oauth-context.js';
import { compileOAuthProfiles, McpOAuthEgressError } from './oauth-profiles.js';
import type { McpOAuthCallContext, McpOAuthNamespaceOptions } from './oauth-contracts.js';

const MAX_RESPONSE_BYTES = 1024 * 1024;

/** One bounded exchange cache per composition, never per handler or session. */
export function createOAuthEgress(options: McpOAuthNamespaceOptions) {
  const compiled = compileOAuthProfiles(options);
  const configuration = options.exchange;
  const issuer = configuration?.issuer;
  const client = configuration && issuer ? createTokenExchangeClient({
    issuer: {
      verify: async (token) => {
        const subject = await issuer.verify(token);
        const current = oauthAuthority.getStore()?.principal;
        if (!current || !options.authorizationServers.includes(subject.issuer)
          || subject.subject !== current.sub || (subject.tenantId ?? null) !== current.tid
          || (subject.clientId !== undefined && subject.clientId !== current.clientId)
          || (options.subjectClientId !== undefined && subject.clientId !== options.subjectClientId)) {
          throw new SubjectVerificationError('invalid_issuer');
        }
        return subject;
      },
      mint: (input) => issuer.mint(input),
    },
    subjectAudience: options.resource, audiences: compiled.audiences,
    workloadClientId: configuration.workloadClientId, workloadActorSub: configuration.workloadActorSub,
    environment: options.environment, policyRevision: configuration.policyRevision, nowMs: configuration.nowMs,
  }) : undefined;
  const fetchFn = configuration?.fetchFn ?? fetch;
  const controllers = new Set<AbortController>();
  let closed = false;
  return {
    bind(authority: OAuthRequestAuthority, tool: string) {
      const controller = new AbortController();
      controllers.add(controller);
      const lifetime = AbortSignal.any([authority.signal, controller.signal]);
      let active = true;
      const check = () => {
        if (!active || closed || lifetime.aborted) throw new McpOAuthEgressError('invocation_inactive');
      };
      const capability: McpOAuthCallContext['egress'] = Object.freeze({
        async request(id: string, params: Readonly<Record<string, string>>) {
          check();
          const { profile, url } = compiled.resolve(id, tool, params);
          if (!client || profile.requiredScopes.some((scope) => !authority.principal.scopes.includes(scope))) {
            throw new McpOAuthEgressError('profile_denied');
          }
          let token;
          try {
            token = await oauthAuthority.run(authority, () => client.exchange({
              grantType: RFC8693_GRANT_TYPE, subjectToken: authority.subjectToken,
              subjectTokenType: ACCESS_TOKEN_TYPE, requestedTokenType: ACCESS_TOKEN_TYPE,
              audience: profile.audience, scope: [...profile.requiredScopes],
            }));
            if (profile.requiredScopes.some((scope) => !token.scope.includes(scope))) throw new Error();
          } catch {
            throw new McpOAuthEgressError('exchange_refused');
          }
          check();
          const signal = AbortSignal.any([lifetime, AbortSignal.timeout(10_000)]);
          let response: Response;
          try {
            response = await fetchFn(url, { method: profile.method,
              headers: { accept: 'application/json', authorization: `Bearer ${token.accessToken}` },
              redirect: 'manual', signal,
            });
          } catch {
            throw new McpOAuthEgressError('downstream_unavailable');
          }
          check();
          if (response.status >= 300 && response.status < 400) {
            await response.body?.cancel().catch(() => undefined);
            throw new McpOAuthEgressError('downstream_unavailable');
          }
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          let text = '';
          let bytes = 0;
          try {
            if (!reader || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw new Error();
            for (;;) {
              check();
              const chunk = await reader.read();
              if (chunk.done) break;
              bytes += chunk.value.byteLength;
              if (bytes > MAX_RESPONSE_BYTES) throw new Error();
              text += decoder.decode(chunk.value, { stream: true });
            }
            text += decoder.decode();
            check();
            return Object.freeze({ status: response.status, body: JSON.parse(text) as unknown });
          } catch {
            throw new McpOAuthEgressError('invalid_response');
          } finally {
            await reader?.cancel().catch(() => undefined);
            reader?.releaseLock();
          }
        },
      });
      return { capability, release() { active = false; controller.abort(); controllers.delete(controller); } };
    },
    close() {
      closed = true;
      for (const controller of controllers) controller.abort();
      controllers.clear();
      client?.invalidateTokenExchangeCache('all');
    },
  };
}
