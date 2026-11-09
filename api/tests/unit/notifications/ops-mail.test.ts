import { describe, expect, it, vi } from 'vitest';
import { renderOpsMail, sendOpsAlertMail } from '../../../src/services/notifications/ops-mail';
import type { OpsIncidentStateV1 } from '@sentropic/cluster-mesh/notifications';

vi.mock('../../../src/services/scw-tem-client', () => ({
  sendTransactionalEmail: vi.fn(),
}));

const state = (extra: Partial<OpsIncidentStateV1> = {}): OpsIncidentStateV1 => ({
  key: 'immo-prod/immo/radar-refresh-pv',
  targetKey: 'immo-prod',
  jobNamespace: 'immo',
  jobName: 'radar-refresh-pv',
  jobKind: 'CronJob',
  status: 'firing',
  firstSeenAt: '2026-11-09T10:00:00.000Z',
  lastSeenAt: '2026-11-09T10:05:00.000Z',
  occurrenceCount: 2,
  consecutiveFailures: 2,
  lastReason: 'job-failed',
  lastSeverity: 'warning',
  lastRunId: 'job-abc123',
  lastEventId: 'k8s:job-abc123:failed',
  lastLinks: { logs: 'https://logs.example.com/run-1' },
  lastMailAt: null,
  escalationLevel: 0,
  lastEscalationAt: null,
  resolvedAt: null,
  lastHeartbeatAt: null,
  ...extra,
});

describe('renderOpsMail', () => {
  it('renders one subject/body triple per mail kind', () => {
    for (const kind of ['firing', 'escalation', 'digest', 'recovery'] as const) {
      const rendered = renderOpsMail(kind, state());
      expect(rendered.subject).toContain('[job-failure]');
      expect(rendered.text).toContain('immo-prod');
      expect(rendered.text).toContain('radar-refresh-pv');
      expect(rendered.html).toContain('<p>');
    }
    expect(renderOpsMail('firing', state()).subject).toContain('firing');
    expect(renderOpsMail('recovery', state()).subject).toContain('recovered');
  });

  it('escapes untrusted cluster strings in html only', () => {
    const evil = state({ targetKey: 'immo-prod', jobName: '<script>alert(1)</script>', lastLinks: null, lastRunId: '<b>run</b>' });
    const rendered = renderOpsMail('firing', evil);
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
    expect(rendered.text).toContain('<script>');
  });

  it('carries no payload beyond job identity, counters and links', () => {
    const rendered = renderOpsMail('digest', state());
    expect(rendered.text).toContain('Occurrences: 2');
    expect(rendered.text).toContain('Reason: job-failed');
    expect(rendered.text).toContain('https://logs.example.com/run-1');
  });
});

describe('sendOpsAlertMail', () => {
  it('delegates to TEM and maps provider errors', async () => {
    const { sendTransactionalEmail } = await import('../../../src/services/scw-tem-client');
    vi.mocked(sendTransactionalEmail).mockResolvedValue({ messageId: 'mid-1' });
    const messageId = await sendOpsAlertMail({ to: 'a@example.com', subject: 's', text: 't', html: '<p>t</p>' });
    expect(messageId).toBe('mid-1');
    vi.mocked(sendTransactionalEmail).mockRejectedValue(new Error('HTTP 500'));
    await expect(sendOpsAlertMail({ to: 'a@example.com', subject: 's', text: 't', html: 'h' }))
      .rejects.toThrow('ops_mail_delivery_failed');
  });
});
