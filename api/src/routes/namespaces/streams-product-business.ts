import { and, eq, sql } from 'drizzle-orm';

import { db } from '../../db/client';
import { folders, initiatives, organizations } from '../../db/schema';
import { hydrateInitiative } from '../api/initiatives';
import { hydrateOrganization } from '../../services/business/organizations';
import type { StreamsBusinessPort } from './streams-ports';

const parseJsonObject = (value: unknown): Record<string, unknown> | null => {
  if (value == null) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const hydrateFolder = (row: Record<string, unknown>): Record<string, unknown> => ({
  id: row.id,
  name: row.name,
  description: row.description ?? null,
  organizationId: (row.organizationId ?? row.organization_id ?? null) as string | null,
  matrixConfig: parseJsonObject(row.matrixConfig ?? row.matrix_config),
  executiveSummary: parseJsonObject(
    row.executiveSummary ?? row.executive_summary ?? row.exec_summary,
  ),
  status: row.status ?? null,
  createdAt: row.createdAt ?? row.created_at ?? null,
});

export const productStreamsBusinessPort: StreamsBusinessPort = {
  async canRead({ kind, id, workspaceId }) {
    if (kind === 'organization') {
      const [row] = await db.select({ id: organizations.id }).from(organizations)
        .where(and(eq(organizations.id, id), eq(organizations.workspaceId, workspaceId))).limit(1);
      return !!row;
    }
    if (kind === 'folder') {
      const [row] = await db.select({ id: folders.id }).from(folders)
        .where(and(eq(folders.id, id), eq(folders.workspaceId, workspaceId))).limit(1);
      return !!row;
    }
    const [row] = await db.select({ id: initiatives.id }).from(initiatives)
      .where(and(eq(initiatives.id, id), eq(initiatives.workspaceId, workspaceId))).limit(1);
    return !!row;
  },
  async readOrganization({ id, workspaceId }) {
    const [row] = await db.select().from(organizations)
      .where(and(eq(organizations.id, id), eq(organizations.workspaceId, workspaceId)));
    return row?.id ? hydrateOrganization(row) : null;
  },
  async readFolder({ id, workspaceId }) {
    const row = await db.get(sql`
      SELECT * FROM folders WHERE id = ${id} AND workspace_id = ${workspaceId}
    `) as Record<string, unknown> | undefined;
    return row?.id ? hydrateFolder(row) : null;
  },
  async readInitiative({ id, workspaceId }) {
    const [row] = await db.select().from(initiatives)
      .where(and(eq(initiatives.id, id), eq(initiatives.workspaceId, workspaceId)));
    return row?.id ? hydrateInitiative(row) : null;
  },
};
