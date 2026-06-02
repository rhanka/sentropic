import type {
  AuthCodePayload,
  OauthClientRecord,
  OauthStateStorePort,
  TokenMeta,
} from '../../src/index.js';

export interface MemoryOauthStateStorePort extends OauthStateStorePort {
  authCodes: Map<string, { expiresAt: Date; payload: AuthCodePayload; used: boolean }>;
  clients: Map<string, OauthClientRecord>;
  dpopProofs: Map<string, Date>;
  revokedTokens: Map<string, Date>;
  tokens: Map<string, { expiresAt: Date; meta: TokenMeta }>;
  upsertClient(client: OauthClientRecord): void;
}

export const createMemoryOauthStateStore = (options: {
  clients?: OauthClientRecord[];
  now?: () => Date;
} = {}): MemoryOauthStateStorePort => {
  const now = options.now ?? (() => new Date());
  const store: MemoryOauthStateStorePort = {
    authCodes: new Map(),
    clients: new Map(options.clients?.map((client) => [client.clientId, client]) ?? []),
    dpopProofs: new Map(),
    revokedTokens: new Map(),
    tokens: new Map(),

    async consumeAuthCode(code) {
      const entry = store.authCodes.get(code);
      if (!entry || entry.used || entry.expiresAt <= now()) return null;
      entry.used = true;
      return entry.payload;
    },

    async findClient(clientId) {
      return store.clients.get(clientId) ?? null;
    },

    async findTokenMeta(jti) {
      const entry = store.tokens.get(jti);
      if (!entry || entry.expiresAt <= now()) return null;
      return entry.meta;
    },

    async isTokenRevoked(jti) {
      const expiresAt = store.revokedTokens.get(jti);
      return Boolean(expiresAt && expiresAt > now());
    },

    async purgeExpired() {
      let count = 0;
      for (const [code, entry] of store.authCodes) {
        if (entry.expiresAt < now()) {
          store.authCodes.delete(code);
          count += 1;
        }
      }
      for (const [jti, entry] of store.tokens) {
        if (entry.expiresAt < now()) {
          store.tokens.delete(jti);
          count += 1;
        }
      }
      for (const [jti, expiresAt] of store.dpopProofs) {
        if (expiresAt < now()) {
          store.dpopProofs.delete(jti);
          count += 1;
        }
      }
      for (const [jti, expiresAt] of store.revokedTokens) {
        if (expiresAt < now()) {
          store.revokedTokens.delete(jti);
          count += 1;
        }
      }
      return count;
    },

    async recordDpopJti(jti, expiresAt) {
      if (store.dpopProofs.has(jti)) return false;
      store.dpopProofs.set(jti, expiresAt);
      return true;
    },

    async revokeToken(jti) {
      store.revokedTokens.set(jti, store.tokens.get(jti)?.expiresAt ?? now());
      return true;
    },

    async saveAuthCode(code, payload, ttlSec) {
      store.authCodes.set(code, {
        expiresAt: new Date(now().getTime() + ttlSec * 1000),
        payload,
        used: false,
      });
    },

    async saveTokenMeta(jti, meta, ttlSec) {
      store.tokens.set(jti, {
        expiresAt: new Date(now().getTime() + ttlSec * 1000),
        meta,
      });
    },

    upsertClient(client) {
      store.clients.set(client.clientId, client);
    },
  };

  return store;
};
