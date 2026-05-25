import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock env to control the TEM client configuration without real credentials.
vi.mock('../../../src/config/env', () => ({
  env: {
    SCW_TEM_API_BASE_URL: 'https://api.scaleway.com',
    SCW_TEM_REGION: 'fr-par',
    SCW_TEM_PROJECT_ID: 'project-123',
    SCW_TEM_SECRET_KEY: 'secret-token',
    SCW_TEM_FROM_EMAIL: 'no-reply@sent-tech.ca',
    SCW_TEM_FROM_NAME: 'Sentropic',
  },
}));

import { sendTransactionalEmail } from '../../../src/services/scw-tem-client';

describe('sendTransactionalEmail', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs the TEM payload to the regional emails endpoint with the auth header', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            emails: [{ id: 'e1', message_id: 'mid-1', status: 'sending' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

    const result = await sendTransactionalEmail({
      to: 'user@example.com',
      subject: 'Hello',
      text: 'plain body',
      html: '<p>html body</p>',
    });

    expect(result).toEqual({ messageId: 'mid-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails'
    );
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Auth-Token']).toBe(
      'secret-token'
    );
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json'
    );

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      from: { email: 'no-reply@sent-tech.ca', name: 'Sentropic' },
      to: [{ email: 'user@example.com' }],
      project_id: 'project-123',
      subject: 'Hello',
      text: 'plain body',
      html: '<p>html body</p>',
    });
  });

  it('omits the html field when not provided and honors from overrides', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ emails: [{ message_id: 'mid-2' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    await sendTransactionalEmail({
      to: 'user@example.com',
      subject: 'No HTML',
      text: 'text only',
      fromEmail: 'custom@sent-tech.ca',
      fromName: 'Custom Sender',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.html).toBeUndefined();
    expect(body.from).toEqual({
      email: 'custom@sent-tech.ca',
      name: 'Custom Sender',
    });
  });

  it('throws with status and body excerpt on a non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'denied', type: 'permissions_denied' }), {
        status: 403,
        statusText: 'Forbidden',
      })
    );

    await expect(
      sendTransactionalEmail({
        to: 'user@example.com',
        subject: 'Boom',
        text: 'body',
      })
    ).rejects.toThrow(/HTTP 403/);
  });
});
