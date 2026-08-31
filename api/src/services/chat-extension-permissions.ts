import { and, desc, eq } from 'drizzle-orm';

import { db } from '../db/client';
import { extensionToolPermissions } from '../db/schema';
import { createId } from '../utils/id';

const TOOL_PATTERN_REGEX = /^[a-z0-9:_*-]{1,96}$/i;
const HOSTNAME_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const IPV4_REGEX =
  /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

const normalizeToolPattern = (raw: string): string | null => {
  const value = raw.trim().toLowerCase();
  if (!value || !TOOL_PATTERN_REGEX.test(value) || value.includes('**')) return null;
  return value;
};

const isValidHostname = (host: string): boolean => {
  const value = host.trim().toLowerCase();
  if (!value) return false;
  if (value === 'localhost' || IPV4_REGEX.test(value)) return true;
  const labels = value.split('.');
  return labels.length >= 2
    && labels.every((label) => HOSTNAME_LABEL_REGEX.test(label));
};

const normalizeRuntimeOrigin = (raw: string): string | null => {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const port = url.port ? `:${url.port}` : '';
    return `${url.protocol}//${url.hostname.toLowerCase()}${port}`;
  } catch {
    return null;
  }
};

const normalizeOriginPattern = (raw: string): string | null => {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value === '*') return value;
  const schemeAnyHost = value.match(/^(https?:)\/\/\*$/);
  if (schemeAnyHost) return `${schemeAnyHost[1]}//*`;
  if (value.startsWith('*.')) {
    const suffix = value.slice(2);
    return isValidHostname(suffix) ? `*.${suffix}` : null;
  }
  const wildcardScheme = value.match(/^(https?:)\/\/\*\.(.+)$/);
  if (wildcardScheme) {
    const suffix = wildcardScheme[2];
    return isValidHostname(suffix) ? `${wildcardScheme[1]}//*.${suffix}` : null;
  }
  return isValidHostname(value) ? value : normalizeRuntimeOrigin(value);
};

const normalizedInput = (input: { toolName: string; origin: string }) => {
  const toolName = normalizeToolPattern(input.toolName);
  if (!toolName) throw new Error('Invalid tool pattern');
  const origin = normalizeOriginPattern(input.origin);
  if (!origin) throw new Error('Invalid origin pattern');
  return { toolName, origin };
};

export const chatExtensionPermissionService = {
  async list(input: { userId: string; workspaceId: string }) {
    const rows = await db
      .select({
        toolName: extensionToolPermissions.toolName,
        origin: extensionToolPermissions.origin,
        policy: extensionToolPermissions.policy,
        updatedAt: extensionToolPermissions.updatedAt,
      })
      .from(extensionToolPermissions)
      .where(and(
        eq(extensionToolPermissions.userId, input.userId),
        eq(extensionToolPermissions.workspaceId, input.workspaceId),
      ))
      .orderBy(desc(extensionToolPermissions.updatedAt));
    return rows.map((row) => ({
      toolName: row.toolName,
      origin: row.origin,
      policy: row.policy,
      updatedAt: row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : new Date(row.updatedAt as unknown as string).toISOString(),
    }));
  },

  async upsert(input: {
    userId: string;
    workspaceId: string;
    toolName: string;
    origin: string;
    policy: 'allow' | 'deny';
  }) {
    const { toolName, origin } = normalizedInput(input);
    const now = new Date();
    await db.insert(extensionToolPermissions).values({
      id: createId(),
      userId: input.userId,
      workspaceId: input.workspaceId,
      toolName,
      origin,
      policy: input.policy,
      updatedAt: now,
      createdAt: now,
    }).onConflictDoUpdate({
      target: [
        extensionToolPermissions.userId,
        extensionToolPermissions.workspaceId,
        extensionToolPermissions.toolName,
        extensionToolPermissions.origin,
      ],
      set: { policy: input.policy, updatedAt: now },
    });
    return { toolName, origin, policy: input.policy, updatedAt: now.toISOString() };
  },

  async delete(input: {
    userId: string;
    workspaceId: string;
    toolName: string;
    origin: string;
  }): Promise<void> {
    const { toolName, origin } = normalizedInput(input);
    await db.delete(extensionToolPermissions).where(and(
      eq(extensionToolPermissions.userId, input.userId),
      eq(extensionToolPermissions.workspaceId, input.workspaceId),
      eq(extensionToolPermissions.toolName, toolName),
      eq(extensionToolPermissions.origin, origin),
    ));
  },
};
