import { and, eq, sql } from 'drizzle-orm';

import { db } from '../../db/client';
import { jobQueue } from '../../db/schema';
import type { StreamsJobsPort } from './streams-ports';

interface JobSnapshotRow {
  id: string;
  type: string;
  data: unknown;
  status: string;
  createdAt: unknown;
  startedAt: unknown;
  completedAt: unknown;
  error: unknown;
}

export const productStreamsJobsPort: StreamsJobsPort = {
  async canRead({ jobId, workspaceId }) {
    const [row] = await db
      .select({ id: jobQueue.id })
      .from(jobQueue)
      .where(and(eq(jobQueue.id, jobId), eq(jobQueue.workspaceId, workspaceId)))
      .limit(1);
    return !!row;
  },
  async listActive({ workspaceId, limit }) {
    const rows = await db.all(sql`
      SELECT id FROM job_queue
      WHERE status IN ('pending', 'processing') AND workspace_id = ${workspaceId}
      ORDER BY created_at DESC LIMIT ${limit}
    `) as Array<{ id: string }>;
    return rows.map(({ id }) => id).filter(Boolean);
  },
  async readSnapshot({ jobId, workspaceId }) {
    const row = await db.get(sql`
      SELECT id, type, data, status, created_at AS "createdAt", started_at AS "startedAt",
        completed_at AS "completedAt", error
      FROM job_queue WHERE id = ${jobId} AND workspace_id = ${workspaceId}
    `) as JobSnapshotRow | undefined;
    if (!row?.id) return null;
    return {
      id: row.id,
      type: row.type,
      data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
      status: row.status,
      createdAt: row.createdAt,
      startedAt: row.startedAt || undefined,
      completedAt: row.completedAt || undefined,
      error: row.error || undefined,
    };
  },
};
