import type { Context } from 'hono';

export const appendParams = (
  target: string,
  params: Record<string, string | null | undefined>,
  baseUrl: string
): string => {
  const url = new URL(target, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
};

export const oauthJsonError = (
  c: Context,
  status: 400 | 401,
  code: string,
  message: string
): Response =>
  c.json(
    {
      error: {
        code,
        message,
      },
    },
    status
  );

export const redirectWithOAuthError = (
  redirectUri: string,
  code: string,
  state: string | null,
  baseUrl: string,
  // RFC 9207: the authorization-server issuer identifier, echoed on the error authorization
  // response so a mix-up-defending client can bind the response to the AS it started with.
  issuer?: string | null
): Response =>
  Response.redirect(
    appendParams(
      redirectUri,
      {
        error: code,
        iss: issuer,
        state,
      },
      baseUrl
    ),
    302
  );

export const redirectOrJson = (c: Context, redirectTo: string): Response => {
  const accept = c.req.header('accept') ?? '';
  if (accept.includes('application/json')) {
    return c.json({ redirectTo });
  }

  return c.redirect(redirectTo, 302);
};
