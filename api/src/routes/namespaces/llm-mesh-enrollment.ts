import type { LlmMeshEnrollmentPort } from '@sentropic/llm-mesh/hono';

import {
  completeAntigravityEnrollment,
  completeClaudeCodeEnrollment,
  completeCodexEnrollment,
  disconnectAntigravityEnrollment,
  disconnectClaudeCodeEnrollment,
  disconnectCodexEnrollment,
  importAntigravityEnrollment,
  importClaudeCodeEnrollment,
  startAntigravityEnrollment,
  startClaudeCodeEnrollment,
  startCodexEnrollment,
} from '../../services/provider-connections';
import { parseLlmMeshEnrollmentIntent } from './llm-mesh-enrollment-intent';

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

const text = (value: unknown): string => typeof value === 'string' ? value : '';
const optionalText = (value: unknown): string | null => typeof value === 'string' ? value : null;
const optionalNumber = (value: unknown): number | undefined => typeof value === 'number' ? value : undefined;

const executeEnrollment = async (
  key: string,
  payload: Record<string, unknown>,
  userId: string,
) => {
  switch (key) {
    case 'codex:start':
      return startCodexEnrollment({ accountLabel: optionalText(payload.accountLabel), updatedByUserId: userId });
    case 'codex:complete':
      return completeCodexEnrollment({
        enrollmentId: text(payload.enrollmentId),
        accountLabel: optionalText(payload.accountLabel),
        updatedByUserId: userId,
      });
    case 'codex:disconnect':
      return disconnectCodexEnrollment({ updatedByUserId: userId });
    case 'anthropic:start':
      return startClaudeCodeEnrollment({ accountLabel: optionalText(payload.accountLabel), updatedByUserId: userId });
    case 'anthropic:complete':
      return completeClaudeCodeEnrollment({
        enrollmentId: text(payload.enrollmentId),
        authorizationCode: text(payload.authorizationCode),
        accountLabel: optionalText(payload.accountLabel),
        updatedByUserId: userId,
      });
    case 'anthropic:disconnect':
      return disconnectClaudeCodeEnrollment({ updatedByUserId: userId });
    case 'anthropic:import':
      return importClaudeCodeEnrollment({
        accessToken: text(payload.accessToken), refreshToken: text(payload.refreshToken),
        expiresAt: optionalText(payload.expiresAt), subscriptionType: optionalText(payload.subscriptionType),
        rateLimitTier: optionalText(payload.rateLimitTier), accountLabel: optionalText(payload.accountLabel),
        updatedByUserId: userId,
      });
    case 'antigravity:start': {
      const redirectPort = optionalNumber(payload.redirectPort);
      return startAntigravityEnrollment({
        accountLabel: optionalText(payload.accountLabel),
        ...(redirectPort === undefined ? {} : { redirectPort }),
        updatedByUserId: userId,
      });
    }
    case 'antigravity:complete':
      return completeAntigravityEnrollment({
        enrollmentId: text(payload.enrollmentId), authorizationCode: text(payload.authorizationCode),
        accountLabel: optionalText(payload.accountLabel), updatedByUserId: userId,
      });
    case 'antigravity:disconnect':
      return disconnectAntigravityEnrollment({ updatedByUserId: userId });
    case 'antigravity:import':
      return importAntigravityEnrollment({
        accessToken: text(payload.accessToken), refreshToken: text(payload.refreshToken),
        expiresAt: optionalText(payload.expiresAt), project: optionalText(payload.project),
        accountLabel: optionalText(payload.accountLabel), updatedByUserId: userId,
      });
    default:
      return undefined;
  }
};

const CLIENT_ERROR_KEYS = new Set([
  'codex:complete',
  'anthropic:complete',
  'anthropic:import',
  'antigravity:complete',
  'antigravity:import',
]);

export const productLlmMeshEnrollmentPort: LlmMeshEnrollmentPort = {
  async handle({ principal, providerId, action, request }) {
    const key = `${providerId}:${action}`;
    const disconnect = action === 'disconnect'
      && ['codex', 'anthropic', 'antigravity'].includes(providerId);
    const intent = disconnect
      ? { payload: {} as Record<string, unknown> }
      : await parseLlmMeshEnrollmentIntent(providerId, action, request);
    if (!intent) return json({ message: 'Invalid enrollment request' }, 400);

    try {
      const provider = await executeEnrollment(key, intent.payload, principal.userId);
      return provider
        ? json({ provider })
        : json({ message: 'Enrollment route not found' }, 404);
    } catch (error) {
      if (!CLIENT_ERROR_KEYS.has(key)) throw error;
      const message = error instanceof Error ? error.message : 'Enrollment operation failed';
      return json({ message }, 400);
    }
  },
};
