// @sentropic/llm-mesh/node/cli/cloud-code-record.ts
//
// Allowlist-only public record construction and CAS persistence helpers for
// `llm-mesh-enroll enroll --provider cloud-code`. Never spreads untrusted or
// legacy records, and never defaults labels to an email address.

import type { ResolvedProviderMetadata } from '../../enrollment/contracts.js';

export const ACCOUNT_INDEX_KEY = 'sentropic-llm-mesh:accounts:index';

export interface StoredPublicRecord {
  accountId: string;
  accountLabel?: string;
  providerId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  removalBarrierRef?: string;
  account: Record<string, unknown>;
}

export const sanitizeUpstreamStatus = (error: unknown): string => {
  const status = (error as { status?: unknown; statusCode?: unknown })?.status
    ?? (error as { statusCode?: unknown })?.statusCode;
  if (typeof status === 'number') return ` (status ${status})`;
  const match = /\((\d{3})\)/.exec(error instanceof Error ? error.message : '');
  return match ? ` (status ${match[1]})` : '';
};

export const parseAccountIndex = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
};

export const ownerClaimJson = (accountId: string, ownerScope: string): string =>
  JSON.stringify({ v: 1, accountId, ownerScopeRef: ownerScope });

/** Allowlist-only public record construction: never spreads existing records or metadata. */
export const buildAllowlistedPublicRecord = (input: {
  accountId: string;
  ownerScope: string;
  explicitLabel?: string;
  existingPublic: StoredPublicRecord | null;
  metadata: ResolvedProviderMetadata;
  now: string;
}): { publicRecord: StoredPublicRecord; label: string; project?: string; tier?: string } => {
  const project = typeof input.metadata.cloudaicompanionProject === 'string' && input.metadata.cloudaicompanionProject.trim()
    ? input.metadata.cloudaicompanionProject.trim()
    : undefined;
  const tier = typeof input.metadata.cloudCodeTier === 'string' && input.metadata.cloudCodeTier.trim()
    ? input.metadata.cloudCodeTier.trim()
    : undefined;
  const uaVersion = typeof input.metadata.cloudCodeUserAgentVersion === 'string' && input.metadata.cloudCodeUserAgentVersion.trim()
    ? input.metadata.cloudCodeUserAgentVersion.trim()
    : undefined;
  const existingLabel = typeof input.existingPublic?.accountLabel === 'string' && input.existingPublic.accountLabel.trim()
    ? input.existingPublic.accountLabel.trim()
    : undefined;
  const label = input.explicitLabel?.trim()
    || existingLabel
    || (project ? `Cloud Code (${project})` : `Cloud Code (${input.accountId})`);
  const nextMetadata: Record<string, unknown> = {};
  if (project) nextMetadata.cloudaicompanionProject = project;
  if (uaVersion) nextMetadata.cloudCodeUserAgentVersion = uaVersion;
  if (tier) nextMetadata.cloudCodeTier = tier;
  const oldAcct = input.existingPublic?.account;
  const nextAccount: Record<string, unknown> = {
    accountId: input.accountId,
    ownerScopeRef: input.ownerScope,
    accountLabel: label,
    targetProviderId: 'gemini',
    transportProviderId: 'cloud-code',
    status: 'active',
    lastError: null,
    enrollmentCompletedAt: input.now,
    metadata: nextMetadata,
  };
  if (oldAcct && Array.isArray(oldAcct.modelIds) && oldAcct.modelIds.every((m) => typeof m === 'string')) {
    nextAccount.modelIds = [...oldAcct.modelIds];
  }
  if (oldAcct && typeof oldAcct.priority === 'number' && Number.isFinite(oldAcct.priority)) {
    nextAccount.priority = oldAcct.priority;
  }
  if (oldAcct && typeof oldAcct.weight === 'number' && Number.isFinite(oldAcct.weight)) {
    nextAccount.weight = oldAcct.weight;
  }
  const createdAt = typeof input.existingPublic?.createdAt === 'string' && input.existingPublic.createdAt
    ? input.existingPublic.createdAt
    : input.now;
  const barrier = typeof input.existingPublic?.removalBarrierRef === 'string' && input.existingPublic.removalBarrierRef
    ? input.existingPublic.removalBarrierRef
    : undefined;
  const publicRecord: StoredPublicRecord = {
    accountId: input.accountId,
    accountLabel: label,
    providerId: 'cloud-code',
    status: 'active',
    createdAt,
    updatedAt: input.now,
    ...(barrier ? { removalBarrierRef: barrier } : {}),
    account: nextAccount,
  };
  return { publicRecord, label, ...(project ? { project } : {}), ...(tier ? { tier } : {}) };
};
