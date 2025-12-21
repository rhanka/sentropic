import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../../src/app';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { createTestId } from '../utils/test-helpers';
import { db } from '../../src/db/client';
import { workspaces } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { ensureWorkspaceForUser } from '../../src/services/workspace-service';

type SseEvent = { event?: string; data?: any; raw?: string };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const parts = buffer.split('\n\n');
  const complete = parts.slice(0, -1);
  const rest = parts[parts.length - 1] ?? '';
  const events: SseEvent[] = [];
  for (const chunk of complete) {
    const lines = chunk.split('\n').filter(Boolean);
    let event: string | undefined;
    let dataLine: string | undefined;
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
      if (line.startsWith('data:')) dataLine = line.slice('data:'.length).trim();
    }
    let data: any = undefined;
    if (dataLine) {
      try {
        data = JSON.parse(dataLine);
      } catch {
        data = dataLine;
      }
    }
    events.push({ event, data, raw: chunk });
  }
  return { events, rest };
}

async function openSse(sessionToken: string, path: string) {
  const res = await app.request(path, {
    headers: { cookie: `session=${sessionToken}` },
  });
  expect(res.status).toBe(200);
  expect(res.body).toBeTruthy();
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  // Wait for ": connected" comment to ensure LISTEN is set.
  await Promise.race([reader.read(), sleep(500)]);
  return reader;
}

async function collectFor(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number): Promise<SseEvent[]> {
  const end = Date.now() + ms;
  const decoder = new TextDecoder();
  let buf = '';
  const out: SseEvent[] = [];
  while (Date.now() < end) {
    const remaining = end - Date.now();
    const res = await Promise.race([reader.read(), sleep(remaining)]);
    if (!res || typeof (res as any).done !== 'boolean') break;
    const r = res as ReadableStreamReadResult<Uint8Array>;
    if (r.done) break;
    buf += decoder.decode(r.value, { stream: true });
    const parsed = parseSse(buf);
    buf = parsed.rest;
    out.push(...parsed.events);
  }
  return out;
}

describe('Streams SSE tenancy', () => {
  afterEach(async () => {
    await cleanupAuthData();
  });

  it('should not leak company updates across workspaces (admin_app stays isolated by default)', async () => {
    const suffix = createTestId();
    const admin = await createAuthenticatedUser('admin_app', `admin-sse-${suffix}@example.com`);
    const user = await createAuthenticatedUser('editor', `user-sse-${suffix}@example.com`);

    // Create workspaces (createAuthenticatedUser does not go through auth middleware).
    await ensureWorkspaceForUser(admin.id);
    await ensureWorkspaceForUser(user.id);

    // Resolve user's workspace id
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.ownerUserId, user.id)).limit(1);
    expect(ws?.id).toBeTruthy();

    const adminReader = await openSse(admin.sessionToken!, '/api/v1/streams/sse');
    const userReader = await openSse(user.sessionToken!, '/api/v1/streams/sse');

    // Create a company in user's workspace (will trigger NOTIFY company_events)
    const companyRes = await authenticatedRequest(app, 'POST', '/api/v1/companies', user.sessionToken!, {
      name: `SSE Tenant ${suffix}`,
      industry: 'Test',
    });
    expect(companyRes.status).toBe(201);
    const company = await companyRes.json();

    // Collect SSE events briefly
    const userEvents = await collectFor(userReader, 1500);
    const adminEvents = await collectFor(adminReader, 1500);

    await userReader.cancel();
    await adminReader.cancel();

    const userCompanyUpdates = userEvents.filter((e) => e.event === 'company_update');
    expect(userCompanyUpdates.length).toBeGreaterThan(0);
    const userSawCompany = userCompanyUpdates.some((e) => e.data?.companyId === company.id);
    expect(userSawCompany).toBe(true);

    const adminCompanyUpdates = adminEvents.filter((e) => e.event === 'company_update');
    const adminSawCompany = adminCompanyUpdates.some((e) => e.data?.companyId === company.id);
    expect(adminSawCompany).toBe(false);
  });
});


