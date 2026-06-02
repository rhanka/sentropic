import type { JWK, KeyLike } from 'jose';

export type OauthTokenType = 'access_token' | 'id_token';

export interface OauthClientRecord {
  id: string;
  clientId: string;
  clientSecretHash: string | null;
  name: string;
  redirectUris: string[];
  allowedScopes: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: 'client_secret_basic' | 'none' | (string & {});
  dpopBoundAccessTokens: boolean;
  requirePkce: boolean;
  tenantId: string | null;
  ownerUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthCodePayload {
  clientId: string;
  userId: string;
  tenantId: string | null;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  dpopJkt: string | null;
  nonce: string | null;
  acr: string;
  authTime: Date;
  expiresAt: Date;
  createdAt: Date;
}

export interface TokenMeta {
  jti: string;
  tokenType: OauthTokenType;
  clientId: string;
  userId: string;
  tenantId: string | null;
  scope: string;
  audience: string;
  dpopJkt: string | null;
  expiresAt: Date;
  createdAt: Date;
}

export interface DpopProofRecord {
  jti: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface OauthStateStorePort {
  findClient(clientId: string): Promise<OauthClientRecord | null>;
  saveAuthCode(code: string, payload: AuthCodePayload, ttlSec: number): Promise<void>;
  consumeAuthCode(code: string): Promise<AuthCodePayload | null>;
  saveTokenMeta(jti: string, meta: TokenMeta, ttlSec: number): Promise<void>;
  findTokenMeta(jti: string): Promise<TokenMeta | null>;
  revokeToken(jti: string): Promise<boolean>;
  isTokenRevoked(jti: string): Promise<boolean>;
  recordDpopJti(jti: string, expiresAt: Date): Promise<boolean>;
  purgeExpired(): Promise<number>;
}

export type JwksPublicJwk = JWK & {
  alg?: 'EdDSA' | (string & {});
  crv: 'Ed25519' | (string & {});
  kid?: string;
  kty: 'OKP' | (string & {});
  use?: 'sig' | (string & {});
  x: string;
};

export interface JwksKeyRecord {
  kid: string;
  alg: 'EdDSA' | (string & {});
  crv: 'Ed25519' | (string & {});
  publicJwk: JwksPublicJwk;
  privateKey?: KeyLike | Uint8Array;
  active: boolean;
  createdAt: Date;
  rotatedAt: Date | null;
}

export interface JwksPort {
  getActiveKey(): Promise<JwksKeyRecord | null>;
  findKeyByKid(kid: string): Promise<JwksKeyRecord | null>;
  listPublicKeys(): Promise<JwksKeyRecord[]>;
}
