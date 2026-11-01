import type { AuthHonoPorts } from '../ports.js';

export interface OAuthRefreshRecord {
  id: string;
  tokenHash: string;
  familyId: string;
  parentId: string | null;
  replacedById: string | null;
  generation: number;
  clientId: string;
  userId: string;
  tenantId: string | null;
  scope: string;
  offlineGrantId: string;
  issuer: string;
  audience: string;
  resource: string | null;
  dpopJkt: string | null;
  acr: string;
  amr: string[];
  authTime: Date;
  sessionId: string | null;
  createdAt: Date;
  expiresAt: Date;
  familyExpiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
}

export interface OAuthRefreshLock {
  clientId: string;
  userId: string;
  familyId?: string;
}

export interface OAuthRefreshStorePort {
  findByHash(tokenHash: string): Promise<OAuthRefreshRecord | null>;
  findAnchor(familyId: string): Promise<OAuthRefreshRecord | null>;
  save(record: OAuthRefreshRecord): Promise<void>;
  consume(id: string, childId: string, now: Date): Promise<boolean>;
  revokeFamily(familyId: string, reason: string, now: Date): Promise<void>;
  transaction<T>(lock: OAuthRefreshLock, work: (ports: AuthHonoPorts) => Promise<T>): Promise<T>;
}
