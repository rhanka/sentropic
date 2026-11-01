// Shared A2.0b custody helpers: no profile dependency in either direction.

import { createHash } from 'node:crypto';
import type { IdentityStorageProfileV1 } from '../../identity-contracts/custody.js';
import { identitySchemaStatements } from './schema.js';

/** Private whole-callback social-race retry signal (never a public error). */
export class IdentitySocialRaceRetrySignal extends Error {
  constructor() {
    super('identity social race: retry whole callback');
    this.name = 'IdentitySocialRaceRetrySignal';
  }
}

export const isSocialRaceRetry = (error: unknown): boolean => error instanceof IdentitySocialRaceRetrySignal;

export interface IdentityCustodySchemaAssetV1 {
  readonly migrationId: 'A2.0b/1';
  readonly contractVersion: '1.1.0';
  readonly profile: IdentityStorageProfileV1;
  readonly assetSha256: string;
  readonly statements: readonly string[];
}

export interface IdentityCustodySchemaReceiptV1 {
  readonly migrationId: 'A2.0b/1';
  readonly contractVersion: '1.1.0';
  readonly profile: IdentityStorageProfileV1;
  readonly assetSha256: string;
  readonly appliedAt: string;
}

const sha256HexOfText = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/** Canonical custody schema asset for one profile. */
export const identityCustodySchemaAssetV1 = (profile: IdentityStorageProfileV1): IdentityCustodySchemaAssetV1 => {
  const statements = identitySchemaStatements(profile, 'cm_identity');
  return { migrationId: 'A2.0b/1', contractVersion: '1.1.0', profile, assetSha256: sha256HexOfText(statements.join(';\n')), statements };
};
