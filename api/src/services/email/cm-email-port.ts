/**
 * CMP-E1 API adapter: CM email port backed by the TEM client.
 *
 * Flag-gated: creation refuses unless `CM_EMAIL_PORT_ENABLED === '1'`.
 * Existing callers of `sendTransactionalEmail` are unchanged (additive).
 */
import { createEmailPort, createEmailRateLimiter, type EmailPort } from '@sentropic/cluster-mesh';
import { sendTransactionalEmail } from '../scw-tem-client';

export const isCmEmailPortEnabled = (): boolean =>
  process.env.CM_EMAIL_PORT_ENABLED === '1';

/** Comma-separated allowlist; empty refuses every sender (fail closed). */
export const cmEmailAllowlist = (env: NodeJS.ProcessEnv = process.env): readonly string[] =>
  (env.CM_EMAIL_ALLOWED_SENDERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** Builds the enforced port; refuses when the flag is off. No state move. */
export const createCmEmailPort = (overrides?: {
  readonly allowlist?: readonly string[];
  readonly maxPerWindow?: number;
  readonly windowMs?: number;
}): EmailPort => {
  if (!isCmEmailPortEnabled()) throw new Error('CM email port not enabled');
  return createEmailPort({
    allowedSenders: overrides?.allowlist ?? cmEmailAllowlist(),
    limiter: createEmailRateLimiter({
      maxPerWindow: overrides?.maxPerWindow ?? 60,
      windowMs: overrides?.windowMs ?? 60_000,
    }),
    transport: { send: (req) => sendTransactionalEmail(req) },
  });
};
