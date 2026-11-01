import { describe, expect, it } from 'vitest';

// REGISTRY-LISTING UI selector contract for the Sessions navigation surface.
// The Sessions list renders only the frozen coarse allowlist per row; the UI
// never receives forbidden detail fields. Activated rows add read-scoped
// detail through a separate authorized record; losing read authority
// downgrades the row to its coarse shape while the listing grant stays
// current, and removes the row once listing itself lapses.

const COARSE_FIELDS = ['engineKind', 'originRevision', 'providerClass', 'sessionRef', 'state'] as const;

const FORBIDDEN_ROW_FIELDS = [
  'cwd',
  'path',
  'title',
  'prompt',
  'cliModel',
  'cliVersion',
  'agentName',
  'agentRole',
  'waitingInput',
  'permissionDetail',
  'typedLogLocator',
  'contentHash',
] as const;

type GrantState = 'no-grant' | 'listing' | 'activated' | 'read-lost' | 'withdrawn';

interface SessionRow {
  readonly projection: Record<string, unknown>;
  readonly visibility: 'listing' | 'activated';
}

function selectSessionRow(input: {
  readonly grantState: GrantState;
  readonly projection: Record<string, unknown>;
}): SessionRow | null {
  if (input.grantState === 'no-grant' || input.grantState === 'withdrawn') return null;
  const coarse: Record<string, unknown> = {};
  for (const field of COARSE_FIELDS) {
    coarse[field] = input.projection[field];
  }
  if (input.grantState === 'activated') {
    return { projection: { ...coarse, detail: input.projection.detail }, visibility: 'activated' };
  }
  return { projection: coarse, visibility: 'listing' };
}

const fullProjection: Record<string, unknown> = {
  sessionRef: { originInstanceId: 'origin-B', sessionId: 'session-1', incarnation: 'incarnation-1' },
  engineKind: 'cli',
  providerClass: 'claude',
  originRevision: 3,
  state: 'running',
  cwd: '/home/owner/work',
  path: '/home/owner/work/secret.txt',
  title: 'Quarterly review notes',
  prompt: 'summarize the inbox',
  cliModel: 'claude-opus-4-6',
  cliVersion: '1.2.3',
  agentName: 'ops-agent',
  agentRole: 'owner-delegate',
  waitingInput: true,
  permissionDetail: { tool: 'exec', target: '/bin/rm' },
  typedLogLocator: 'cli-jsonl-transcript#42',
  contentHash: 'a'.repeat(64),
  detail: { channel: 'retained-read', revision: 3 },
};

describe('RC2.registry REGISTRY-LISTING navigation rows', () => {
  it('should render no row without a listing grant', () => {
    expect(selectSessionRow({ grantState: 'no-grant', projection: fullProjection })).toBeNull();
  });

  it('should render a coarse row with exactly the allowlist fields', () => {
    const row = selectSessionRow({ grantState: 'listing', projection: fullProjection });
    expect(row?.visibility).toBe('listing');
    expect(Object.keys(row?.projection ?? {}).sort()).toEqual([...COARSE_FIELDS].sort());
    const serialized = JSON.stringify(row?.projection);
    for (const field of FORBIDDEN_ROW_FIELDS) {
      expect(serialized).not.toContain(`"${field}"`);
    }
  });

  it('should downgrade an activated row to coarse fields on read loss', () => {
    const activated = selectSessionRow({ grantState: 'activated', projection: fullProjection });
    expect(activated?.visibility).toBe('activated');
    const downgraded = selectSessionRow({ grantState: 'read-lost', projection: fullProjection });
    expect(downgraded?.visibility).toBe('listing');
    expect(downgraded?.projection).not.toHaveProperty('detail');
    expect(Object.keys(downgraded?.projection ?? {}).sort()).toEqual([...COARSE_FIELDS].sort());
  });

  it('should remove the row once the listing grant is withdrawn', () => {
    expect(selectSessionRow({ grantState: 'withdrawn', projection: fullProjection })).toBeNull();
  });
});
