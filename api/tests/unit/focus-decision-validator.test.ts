import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventStore } from '@sentropic/track';
import { ingest } from '@sentropic/track/ingest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TrackDecisionValidator } from '../../src/services/focus/decision-validator';

describe('TrackDecisionValidator (Fail-Closed Matrix)', () => {
  let tmpDir: string;
  let eventsPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'track-validator-test-'));
    eventsPath = join(tmpDir, 'events.jsonl');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const seedDecisionInStore = (workspace: string, accountableEmail: string): string => {
    const store = new EventStore(eventsPath);
    const itemRes = ingest(
      [
        {
          v: 1,
          kind: 'item.create',
          payload: {
            kind: 'chore',
            title: 'Target Item',
            workspace,
          },
        },
      ],
      {
        by: `human:${accountableEmail}`,
        workspace,
        prov: { transport: 'cli', proposed: false, auth: 'local-user' },
      },
      store,
    );

    const decRes = ingest(
      [
        {
          v: 1,
          kind: 'decision.create',
          payload: {
            decisionKind: 'orientation',
            title: 'Orientation Decision',
            workspace,
            targets: [itemRes.ids[0]!],
            dossier: {
              context: 'Test context',
              options: [
                { id: 'opt-1', title: 'Option 1', summary: 'Summary 1' },
                { id: 'opt-2', title: 'Option 2', summary: 'Summary 2' },
              ],
              qa: [],
              recommendation: { optionId: 'opt-1', rationale: 'Rationale 1' },
            },
            accountable: `human:${accountableEmail}`,
          },
        },
      ],
      {
        by: `human:${accountableEmail}`,
        workspace,
        prov: { transport: 'cli', proposed: false, auth: 'local-user' },
      },
      store,
    );

    return decRes.ids[0]!;
  };

  it('1. unset store → deny', async () => {
    const validator = new TrackDecisionValidator({ eventsPath: join(tmpDir, 'non-existent.jsonl') });
    const res = await validator.validate({
      workspace: 'ws:sha256-ws1',
      decisionId: 'dec-1',
      userId: 'user-1',
      userEmail: 'owner@example.com',
    });
    expect(res.authorized).toBe(false);
    expect(res.reason).toBe('track-store-unconfigured');
  });

  it('1b. unreadable Track log → deny', async () => {
    writeFileSync(eventsPath, '{not-json}\n');
    const res = await new TrackDecisionValidator({ eventsPath }).validate({
      workspace: 'ws:sha256-ws1',
      decisionId: 'dec-1',
      userId: 'user-1',
      userEmail: 'owner@example.com',
    });
    expect(res).toEqual({ authorized: false, reason: 'decision-validation-failed' });
  });

  it('2. not-found → deny', async () => {
    seedDecisionInStore('ws:sha256-ws1', 'owner@example.com');
    const validator = new TrackDecisionValidator({ eventsPath });
    const res = await validator.validate({
      workspace: 'ws:sha256-ws1',
      decisionId: 'dec-non-existent',
      userId: 'user-1',
      userEmail: 'owner@example.com',
    });
    expect(res.authorized).toBe(false);
    expect(res.reason).toBe('decision-not-found');
  });

  it('3. workspace-mismatch → deny', async () => {
    const decId = seedDecisionInStore('ws:sha256-ws1', 'owner@example.com');
    const validator = new TrackDecisionValidator({ eventsPath });
    const res = await validator.validate({
      workspace: 'ws:sha256-ws2-mismatch',
      decisionId: decId,
      userId: 'user-1',
      userEmail: 'owner@example.com',
    });
    expect(res.authorized).toBe(false);
    expect(res.reason).toBe('workspace-mismatch');
  });

  it('4. non-owner (case-only Rhanka vs rhanka) → deny', async () => {
    const decId = seedDecisionInStore('ws:sha256-ws1', 'rhanka@example.com');
    const validator = new TrackDecisionValidator({ eventsPath });
    const res = await validator.validate({
      workspace: 'ws:sha256-ws1',
      decisionId: decId,
      userId: 'user-1',
      userEmail: 'Rhanka@example.com', // exact case required
    });
    expect(res.authorized).toBe(false);
    expect(res.reason).toBe('not-decision-owner');
  });

  it('4b. non-owner (whitespace x vs " x ") → deny', async () => {
    const decId = seedDecisionInStore('ws:sha256-ws1', 'owner@example.com');
    const validator = new TrackDecisionValidator({ eventsPath });
    const res = await validator.validate({
      workspace: 'ws:sha256-ws1',
      decisionId: decId,
      userId: 'user-1',
      userEmail: ' owner@example.com ',
    });
    expect(res.authorized).toBe(false);
    expect(res.reason).toBe('not-decision-owner');
  });

  it('5. exact-match → authorized', async () => {
    const decId = seedDecisionInStore('ws:sha256-ws1', 'owner@example.com');
    const validator = new TrackDecisionValidator({ eventsPath });
    const res = await validator.validate({
      workspace: 'ws:sha256-ws1',
      decisionId: decId,
      userId: 'user-1',
      userEmail: 'owner@example.com',
    });
    expect(res.authorized).toBe(true);
  });
});
