import { describe, expect, it, vi } from 'vitest';
import {
  isOpsMailRetryableError,
  OpsMailError,
  opsSendBackoffMs,
  renderOpsConfigMail,
  renderOpsMail,
  sanitizeOpsSubject,
  sendOpsAlertMail,
} from '../../../src/services/notifications/ops-mail';
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
  lastDetail: null,
  lastMailAt: null,
  escalationLevel: 0,
  lastEscalationAt: null,
  resolvedAt: null,
  lastHeartbeatAt: null,
  lastOccurredAt: '2026-11-09T10:00:00.000Z',
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
  it('delegates to TEM and keeps retryability on provider errors', async () => {
    const { sendTransactionalEmail } = await import('../../../src/services/scw-tem-client');
    vi.mocked(sendTransactionalEmail).mockResolvedValue({ messageId: 'mid-1' });
    const messageId = await sendOpsAlertMail({ to: 'a@example.com', subject: 's', text: 't', html: '<p>t</p>' });
    expect(messageId).toBe('mid-1');
    vi.mocked(sendTransactionalEmail).mockRejectedValue(new Error('Scaleway TEM send failed: HTTP 500 boom'));
    const transient = await sendOpsAlertMail({ to: 'a@example.com', subject: 's', text: 't', html: 'h' })
      .catch((error: unknown) => error);
    expect(transient).toBeInstanceOf(OpsMailError);
    expect((transient as OpsMailError).retryable).toBe(true);
    vi.mocked(sendTransactionalEmail).mockRejectedValue(new Error('Scaleway TEM send failed: HTTP 400 bad'));
    const permanent = await sendOpsAlertMail({ to: 'a@example.com', subject: 's', text: 't', html: 'h' })
      .catch((error: unknown) => error);
    expect((permanent as OpsMailError).retryable).toBe(false);
  });
});

describe('ops mail hardening', () => {
  it('reduces subjects to one sanitized line', () => {
    expect(sanitizeOpsSubject('[job-failure] a/b\nBcc: evil@example.com')).toBe('[job-failure] a/b Bcc: evil@example.com');
    expect(sanitizeOpsSubject('  spaced   out  ')).toBe('spaced out');
    expect(sanitizeOpsSubject('x'.repeat(300))).toHaveLength(200);
    const evil = state({ targetKey: 'immo-prod', jobName: 'a\nBcc: evil@example.com' });
    expect(renderOpsMail('firing', evil).subject).not.toContain('\n');
  });

  it('classifies retryable faults and backs off bounded', () => {
    expect(isOpsMailRetryableError(new OpsMailError('x', true, 500))).toBe(true);
    expect(isOpsMailRetryableError(new OpsMailError('x', false, 400))).toBe(false);
    expect(isOpsMailRetryableError(new Error('Scaleway TEM send failed: HTTP 503 x'))).toBe(true);
    expect(isOpsMailRetryableError(new Error('Scaleway TEM send failed: HTTP 400 x'))).toBe(false);
    expect(isOpsMailRetryableError(new Error('socket hang up'))).toBe(true);
    expect(opsSendBackoffMs(1)).toBe(2 * 60 * 1000);
    expect(opsSendBackoffMs(99)).toBe(60 * 60 * 1000);
  });

  it('renders a config alert without job detail', () => {
    const rendered = renderOpsConfigMail('immo-prod', 'immo-prod/immo/radar', 'no usable recipient');
    expect(rendered.subject).toContain('misconfigured');
    expect(rendered.text).toContain('immo-prod');
    expect(rendered.text).toContain('OPS_JOB_FAILURE_TARGETS_JSON');
    expect(rendered.text).not.toContain('radar-refresh');
  });
});
