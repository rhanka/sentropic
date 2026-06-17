import { describe, expect, it } from 'vitest';

import {
  inferCodexAccountIdFromToken,
  inferTokenExpiresAt,
} from '../../src/services/llm-account-transports';

const jwtWithPayload = (payload: Record<string, unknown>): string =>
  `header.${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.signature`;

describe('llm account transports', () => {
  it('infers Codex account ids from access token claims', () => {
    const accessToken = jwtWithPayload({
      chatgpt_account_id: 'acct_codex_123',
      exp: 1_800_000_000,
    });

    expect(inferCodexAccountIdFromToken(accessToken, null)).toBe('acct_codex_123');
  });

  it('falls back to OpenAI auth and organization claims', () => {
    const accessToken = jwtWithPayload({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_auth_claim',
      },
    });
    const orgToken = jwtWithPayload({
      organizations: [{ id: 'org_fallback' }],
    });

    expect(inferCodexAccountIdFromToken(accessToken, null)).toBe('acct_auth_claim');
    expect(inferCodexAccountIdFromToken(jwtWithPayload({}), orgToken)).toBe('org_fallback');
  });

  it('infers token expiry from JWT exp claims', () => {
    const accessToken = jwtWithPayload({ exp: 1_800_000_000 });

    expect(inferTokenExpiresAt(accessToken, null)).toBe('2027-01-15T08:00:00.000Z');
  });
});
