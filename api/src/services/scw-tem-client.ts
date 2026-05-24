import { env } from '../config/env';

/**
 * Scaleway Transactional Email (TEM) HTTP API client.
 *
 * SMTP egress is blocked at the Kapsule platform level (BR37b-FL1), so all
 * outbound mail is sent through the TEM HTTP API:
 *   POST {SCW_TEM_API_BASE_URL}/transactional-email/v1alpha1/regions/{region}/emails
 *   X-Auth-Token: {SCW_TEM_SECRET_KEY}
 *
 * In dev/test the api targets the local `scw-tem-mock` service, which exposes
 * the same surface and forwards each payload to maildev over SMTP.
 */

interface SendTransactionalEmailParams {
  to: string;
  subject: string;
  html?: string;
  text: string;
  fromEmail?: string;
  fromName?: string;
}

interface SendTransactionalEmailResult {
  messageId: string;
}

interface TemSuccessResponse {
  emails: Array<{
    id?: string;
    message_id?: string;
    status?: string;
  }>;
}

/**
 * Send a transactional email via the Scaleway TEM HTTP API.
 *
 * @throws Error on any non-2xx response, including the HTTP status and a
 *   truncated excerpt of the response body for diagnostics.
 */
export async function sendTransactionalEmail(
  params: SendTransactionalEmailParams
): Promise<SendTransactionalEmailResult> {
  const { to, subject, html, text, fromEmail, fromName } = params;

  const url = `${env.SCW_TEM_API_BASE_URL}/transactional-email/v1alpha1/regions/${env.SCW_TEM_REGION}/emails`;

  const body = {
    from: {
      email: fromEmail ?? env.SCW_TEM_FROM_EMAIL,
      name: fromName ?? env.SCW_TEM_FROM_NAME,
    },
    to: [{ email: to }],
    project_id: env.SCW_TEM_PROJECT_ID,
    subject,
    text,
    ...(html ? { html } : {}),
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Auth-Token': env.SCW_TEM_SECRET_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    const excerpt = raw.slice(0, 500);
    throw new Error(
      `Scaleway TEM send failed: HTTP ${response.status} ${response.statusText} - ${excerpt}`
    );
  }

  const data = (await response.json()) as TemSuccessResponse;
  const messageId = data.emails?.[0]?.message_id ?? data.emails?.[0]?.id ?? '';

  return { messageId };
}
