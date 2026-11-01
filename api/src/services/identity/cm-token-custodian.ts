import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { compactVerify, errors, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { IdentityCustodyErrorV1, type IdentityDigestPortV1, type IdentityEmailTicketClaimsV1,
  type IdentityEmailTicketTokenPortV1, type IdentityLoginTokenPortV1,
  type SignedLoginBindingV1, type VerifiedLoginClaimsV1 } from '@sentropic/cluster-mesh';

const refuse = (code: 'login_binding_mismatch' | 'proof_binding_mismatch'): never => {
  throw new IdentityCustodyErrorV1(code);
};
const invalidToken = (error: unknown): boolean => error instanceof errors.JWTExpired
  || error instanceof errors.JWTClaimValidationFailed || error instanceof errors.JWSSignatureVerificationFailed
  || error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid || error instanceof errors.JOSEAlgNotAllowed;
const signedLogin = (value: unknown): SignedLoginBindingV1 | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<SignedLoginBindingV1>;
  return typeof candidate.mfaVerified === 'boolean' && Number.isSafeInteger(candidate.authTime)
    && Number.isSafeInteger(candidate.sessionVersion) && candidate.authTime! >= 0 && candidate.sessionVersion! >= 0
    ? { mfaVerified: candidate.mfaVerified, authTime: candidate.authTime!, sessionVersion: candidate.sessionVersion! } : null;
};

/** The root borrows the existing signing keys; no source key is changed or provisioned. */
export const createCmTokenCustodian = (input: {
  readonly sessionKey: Uint8Array;
  readonly ticketKey: Uint8Array;
  readonly emailCodeKeys?: ReadonlyMap<string, Uint8Array>;
}) => {
  const sessionKey = Buffer.from(input.sessionKey);
  const ticketKey = Buffer.from(input.ticketKey);
  const emailKeys = new Map([...input.emailCodeKeys ?? []].map(([ref, key]) => [ref, Buffer.from(key)]));
  let live = true;
  const assertLive = () => {
    if (!live) throw new IdentityCustodyErrorV1('identity_contract_unavailable');
  };
  const loginTokens: IdentityLoginTokenPortV1 = {
    async sign({ expiresAt, ...claims }) {
      assertLive();
      return new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setJti(randomUUID())
        .setIssuedAt().setExpirationTime(new Date(expiresAt)).sign(sessionKey);
    },
    async verify(token, expectedUse, now): Promise<VerifiedLoginClaimsV1> {
      assertLive();
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, sessionKey, { algorithms: ['HS256'], currentDate: new Date(now) }));
      } catch (error) {
        if (invalidToken(error)) return refuse('login_binding_mismatch');
        throw error;
      }
      if (typeof payload.userId !== 'string' || !payload.userId || typeof payload.sessionId !== 'string'
        || !payload.sessionId || !Number.isSafeInteger(payload.exp) || payload.exp! <= 0) return refuse('login_binding_mismatch');
      const login = signedLogin(payload.login);
      const common = { userId: payload.userId, sessionId: payload.sessionId, expiresAt: new Date(payload.exp! * 1000).toISOString() };
      if (expectedUse === 'refresh') {
        if (payload.tokenUse !== 'refresh' || !login) return refuse('login_binding_mismatch');
        return { ...common, tokenUse: 'refresh', login };
      }
      if (payload.tokenUse !== undefined && payload.tokenUse !== 'session') return refuse('login_binding_mismatch');
      return { ...common, tokenUse: 'session', login };
    },
  };
  const verifyTicket = async (token: Uint8Array): Promise<IdentityEmailTicketClaimsV1> => {
    assertLive();
    let bytes: Uint8Array | undefined;
    try {
      ({ payload: bytes } = await compactVerify(token, ticketKey, { algorithms: ['HS256'] }));
      const claims = JSON.parse(new TextDecoder().decode(bytes)) as JWTPayload;
      if (typeof claims.email !== 'string' || !claims.email || typeof claims.codeId !== 'string' || !claims.codeId
        || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)
        || claims.iat! < 0 || claims.exp! <= claims.iat!) return refuse('proof_binding_mismatch');
      return { email: claims.email, codeProofId: claims.codeId,
        issuedAt: new Date(claims.iat! * 1000).toISOString(), expiresAt: new Date(claims.exp! * 1000).toISOString() };
    } catch (error) {
      if (invalidToken(error) || error instanceof SyntaxError) return refuse('proof_binding_mismatch');
      throw error;
    } finally { bytes?.fill(0); }
  };
  const ticketTokens: IdentityEmailTicketTokenPortV1 = {
    async sign(claims) {
      assertLive();
      return new SignJWT({ email: claims.email, codeId: claims.codeProofId }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(Math.floor(Date.parse(claims.issuedAt) / 1000))
        .setExpirationTime(Math.floor(Date.parse(claims.expiresAt) / 1000)).sign(ticketKey);
    },
    verifyForImport: verifyTicket,
    async verify(token, now) {
      const claims = await verifyTicket(token);
      if (Date.parse(claims.expiresAt) <= Date.parse(now)) return refuse('proof_binding_mismatch');
      return claims;
    },
  };
  const digest: IdentityDigestPortV1 = {
    async sha256(bytes) { assertLive(); return createHash('sha256').update(bytes).digest('hex'); },
    async hmacSha256(ref, bytes) {
      assertLive();
      const key = emailKeys.get(ref);
      if (!key) throw new IdentityCustodyErrorV1('identity_contract_unavailable');
      return createHmac('sha256', key).update(bytes).digest('hex');
    },
    equal(left, right) { assertLive(); return left.byteLength === right.byteLength && timingSafeEqual(left, right); },
  };
  return { loginTokens, ticketTokens, digest, dispose() {
    live = false;
    sessionKey.fill(0); ticketKey.fill(0);
    for (const key of emailKeys.values()) key.fill(0);
    emailKeys.clear();
  } };
};
