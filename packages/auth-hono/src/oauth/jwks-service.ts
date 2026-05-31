import {
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  SignJWT,
  type JWTVerifyOptions,
  type JWTVerifyResult,
  type JWTPayload,
} from 'jose';

import type { AuthHonoClockPort } from '../ports.js';
import type { JwksPort } from './state-store-types.js';

export interface CreateJwksServiceOptions {
  clock: AuthHonoClockPort;
  jwksPort: JwksPort;
}

export interface JwksSignOptions {
  audience?: string | string[];
  expiresAt?: Date;
  issuer?: string;
  jti?: string;
  subject?: string;
  type?: string;
}

export interface PublicJwks {
  keys: Array<Record<string, unknown>>;
}

export interface JwksService {
  getPublicJwks(): Promise<PublicJwks>;
  signJwt(payload: JWTPayload, options?: JwksSignOptions): Promise<string>;
  verifyJwt<T extends JWTPayload = JWTPayload>(
    jwt: string,
    options?: JWTVerifyOptions
  ): Promise<JWTVerifyResult<T>>;
}

export const createJwksService = ({ clock, jwksPort }: CreateJwksServiceOptions): JwksService => ({
  async getPublicJwks() {
    const keys = await jwksPort.listPublicKeys();

    return {
      keys: keys.map((key) => {
        const { d: _privateExponent, ...publicJwk } = key.publicJwk;
        return {
          ...publicJwk,
          alg: key.alg,
          crv: key.crv,
          kid: key.kid,
          kty: publicJwk.kty,
          status: key.active ? 'active' : 'rotated',
          use: 'sig',
        };
      }),
    };
  },

  async signJwt(payload, options = {}) {
    const activeKey = await jwksPort.getActiveKey();
    if (!activeKey) {
      throw new Error('No active JWKS signing key is configured.');
    }
    if (!activeKey.privateKey) {
      throw new Error(`Active JWKS signing key ${activeKey.kid} has no private key material.`);
    }

    let jwt = new SignJWT(payload).setProtectedHeader({
      alg: activeKey.alg,
      kid: activeKey.kid,
      ...(options.type ? { typ: options.type } : {}),
    });

    jwt = jwt.setIssuedAt(toEpochSeconds(clock.now()));
    if (options.audience) jwt = jwt.setAudience(options.audience);
    if (options.expiresAt) jwt = jwt.setExpirationTime(toEpochSeconds(options.expiresAt));
    if (options.issuer) jwt = jwt.setIssuer(options.issuer);
    if (options.jti) jwt = jwt.setJti(options.jti);
    if (options.subject) jwt = jwt.setSubject(options.subject);

    return jwt.sign(activeKey.privateKey);
  },

  async verifyJwt(jwt, options = {}) {
    const protectedHeader = decodeProtectedHeader(jwt);
    const kid = protectedHeader.kid;
    if (!kid) {
      throw new Error('JWT protected header is missing kid.');
    }

    const key = await jwksPort.findKeyByKid(kid);
    if (!key) {
      throw new Error(`Unknown JWKS kid: ${kid}`);
    }

    const publicKey = await importJWK(key.publicJwk, key.alg);
    return jwtVerify(jwt, publicKey, options);
  },
});

const toEpochSeconds = (date: Date): number => Math.floor(date.getTime() / 1000);
