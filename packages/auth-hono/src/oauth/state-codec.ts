export interface OAuthContinuationState {
  acr?: string;
  authTime?: string;
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  createdAt: string;
  dpopJkt: string | null;
  expiresAt: string;
  /**
   * BR-39r L3 (C2): set when the authorize flow was forced to re-authenticate by
   * `prompt=login` or `prompt=select_account`. Carried into the sealed (HMAC-signed → tamper-proof)
   * continuation so `resumeLoginContinuation` can reject a resume that still resolves to the SAME
   * pre-existing session id (`forceReauthSessionId`) — only a genuinely fresh login (new session id)
   * proceeds to consent.
   */
  forceReauth?: boolean;
  /** The current session id (if any) at force-reauth time; the id the resume must differ from. */
  forceReauthSessionId?: string;
  nonce: string | null;
  redirectUri: string;
  /**
   * ARCH-11 §4.2.4: the RAW `?tenant=` selection as the RP sent it, sealed at authorize time and
   * carried across the login round-trip. It is an unvalidated user intent, NOT an authorization —
   * `deriveAuthorizeTenantId` re-checks it against approved memberships on every use, and the HMAC
   * signature only makes it tamper-proof in transit. Without it, a multi-org user's explicit
   * selection is lost at resume (the resume URL carries `continue` alone), the derivation falls
   * through to "0 or >1 approved ⇒ null", and the token silently loses its `tid`.
   */
  requestedTenant?: string | null;
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
