export interface OAuthContinuationState {
  acr?: string;
  authTime?: string;
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  createdAt: string;
  dpopJkt: string | null;
  expiresAt: string;
  nonce: string | null;
  redirectUri: string;
  /** RFC 8707 resource sealed at authorize time (BR-39l Lot 2); carried authorize → consent → code. */
  resource?: string | null;
  scope: string;
  state: string | null;
  tenantId: string | null;
  userId?: string;
}

export interface OAuthContinuationCodec {
  seal(payload: OAuthContinuationState): Promise<string> | string;
  unseal(token: string): Promise<OAuthContinuationState | null> | OAuthContinuationState | null;
}

export interface CreateOAuthHmacStateCodecOptions {
  secret: string;
}

export const createOAuthHmacStateCodec = ({
  secret,
}: CreateOAuthHmacStateCodecOptions): OAuthContinuationCodec => {
  if (!secret) {
    throw new Error('OAuth state codec secret is required.');
  }

  return {
    async seal(payload) {
      const body = base64urlEncode(textEncoder.encode(JSON.stringify(payload)));
      return `${body}.${await sign(body, secret)}`;
    },

    async unseal(token) {
      const [body, signature, extra] = token.split('.');
      if (!body || !signature || extra !== undefined) return null;

      const expected = await sign(body, secret);
      const actualBytes = base64urlDecode(signature);
      const expectedBytes = base64urlDecode(expected);
      if (!timingSafeEqual(actualBytes, expectedBytes)) return null;

      try {
        return JSON.parse(textDecoder.decode(base64urlDecode(body))) as OAuthContinuationState;
      } catch {
        return null;
      }
    },
  };
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const sign = async (body: string, secret: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(body));
  return base64urlEncode(new Uint8Array(signature));
};

const timingSafeEqual = (actual: Uint8Array, expected: Uint8Array): boolean => {
  if (actual.byteLength !== expected.byteLength) return false;
  let diff = 0;
  for (let index = 0; index < actual.byteLength; index += 1) {
    diff |= actual[index] ^ expected[index];
  }
  return diff === 0;
};

const base64urlEncode = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
};

const base64urlDecode = (value: string): Uint8Array => {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};
