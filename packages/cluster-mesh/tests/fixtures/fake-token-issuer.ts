import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import {
  SubjectVerificationError,
  type MintedToken,
  type MintExchangedTokenInput,
  type TokenExchangeIssuer,
  type VerifiedSubjectToken,
} from '../../src/index.js';

/**
 * Test-only issuer double for the RFC 8693 exchange client (lot 2a-fix). Signs and
 * verifies HS256 JWTs with throwaway key material. The `act` claim always carries
 * the workload identity from the mint input (never a caller value), mirroring the
 * #674 issuer contract. The real IdP binding replaces this double in lot 2-IdP;
 * this file must never move into `src/`.
 */
export interface FakeIssuerOptions {
  readonly issuer: string;
  readonly secret?: string;
  readonly nowMs?: () => number;
}

export interface FakeSubjectInput {
  readonly subject: string;
  readonly audience?: readonly string[];
  readonly scope?: readonly string[];
  readonly expiresInSec?: number;
  readonly issuer?: string;
  readonly clientId?: string;
  readonly tenantId?: string;
  readonly jti?: string;
}

export class FakeTokenIssuer implements TokenExchangeIssuer {
  readonly issuer: string;
  private readonly key: Uint8Array;
  private readonly nowMs: () => number;
  mintCalls = 0;

  constructor(options: FakeIssuerOptions) {
    this.issuer = options.issuer;
    this.key = new TextEncoder().encode(options.secret ?? 'lot-2a-test-only-secret');
    this.nowMs = options.nowMs ?? Date.now;
  }

  async issueSubject(input: FakeSubjectInput): Promise<string> {
    const nowSec = Math.floor(this.nowMs() / 1000);
    return new SignJWT({
      scope: [...(input.scope ?? [])].join(' '),
      ...(input.clientId ? { client_id: input.clientId } : {}),
      ...(input.tenantId ? { tid: input.tenantId } : {}),
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(input.issuer ?? this.issuer)
      .setSubject(input.subject)
      .setAudience(input.audience ?? ['https://mesh.example.test'])
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + (input.expiresInSec ?? 3600))
      .setJti(input.jti ?? randomUUID())
      .sign(this.key);
  }

  async verify(subjectToken: string): Promise<VerifiedSubjectToken> {
    let payload;
    try {
      const verified = await jwtVerify(subjectToken, this.key, {
        issuer: this.issuer,
        currentDate: new Date(Math.floor(this.nowMs() / 1000) * 1000),
      });
      payload = verified.payload;
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        const code = (error as { code?: string }).code;
        if (code === 'ERR_JWT_EXPIRED') throw new SubjectVerificationError('expired');
        if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
          throw new SubjectVerificationError('invalid_signature');
        }
        if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
          const claim = (error as { claim?: string }).claim;
          if (claim === 'iss') throw new SubjectVerificationError('invalid_issuer');
          if (claim === 'aud') throw new SubjectVerificationError('invalid_audience');
        }
      }
      throw new SubjectVerificationError('malformed');
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new SubjectVerificationError('missing_subject');
    }
    if (payload.act != null) throw new SubjectVerificationError('actor_chained');
    if (payload.cnf != null) throw new SubjectVerificationError('proof_bound');
    if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number') {
      throw new SubjectVerificationError('malformed');
    }
    const audience = Array.isArray(payload.aud)
      ? payload.aud.filter((entry): entry is string => typeof entry === 'string')
      : typeof payload.aud === 'string'
        ? [payload.aud]
        : [];
    const scope =
      typeof payload.scope === 'string'
        ? payload.scope.split(' ').filter(Boolean)
        : Array.isArray(payload.scope)
          ? payload.scope.filter((entry): entry is string => typeof entry === 'string')
          : [];
    return {
      issuer: payload.iss ?? '',
      subject: payload.sub,
      audience,
      issuedAtSec: payload.iat,
      expiresAtSec: payload.exp,
      scope,
      ...(typeof payload.client_id === 'string' ? { clientId: payload.client_id } : {}),
      ...(typeof payload.tid === 'string' ? { tenantId: payload.tid } : {}),
      ...(typeof payload.jti === 'string' ? { jti: payload.jti } : {}),
    };
  }

  async mint(input: MintExchangedTokenInput): Promise<MintedToken> {
    this.mintCalls += 1;
    const expiresAtSec = input.nowSec + input.ttlSec;
    const accessToken = await new SignJWT({
      scope: [...input.scope].join(' '),
      act: { sub: input.actorSub },
      client_id: input.workloadClientId,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(this.issuer)
      .setSubject(input.subject.subject)
      .setAudience(input.audience)
      .setIssuedAt(input.nowSec)
      .setExpirationTime(expiresAtSec)
      .setJti(randomUUID())
      .sign(this.key);
    return {
      accessToken,
      tokenType: 'Bearer',
      issuedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      expiresAtSec,
      scope: [...input.scope],
      verified: {
        issuer: this.issuer,
        subject: input.subject.subject,
        audience: input.audience,
        clientId: input.workloadClientId,
        actorSub: input.actorSub,
        scope: [...input.scope],
        issuedAtSec: input.nowSec,
        expiresAtSec,
      },
    };
  }
}
