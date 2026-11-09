import { describe, expect, it } from 'vitest';
import {
  OPS_JOB_FAILURE_CONTRACT_V1,
  OPS_JOB_FAILURE_DETAIL_MAX_BYTES,
  opsIncidentKey,
  truncateOpsDetail,
  validateOpsJobFailureV1,
} from '../src/notifications/index.js';

const base = {
  v: 1 as const,
  eventId: 'k8s:job-abc123:failed',
  source: 'k8s' as const,
  targetKey: 'immo-prod',
  jobRef: { kind: 'CronJob' as const, name: 'radar-refresh-pv' },
  runId: 'job-abc123',
  outcome: 'failed' as const,
  reason: 'job-failed' as const,
  severity: 'warning' as const,
  occurredAt: '2026-11-09T10:00:00.000Z',
};

describe('OpsJobFailureV1 contract', () => {
  it('accepts a minimal failed event', () => {
    const result = validateOpsJobFailureV1(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.v).toBe(OPS_JOB_FAILURE_CONTRACT_V1);
      expect(result.event.detail).toBeUndefined();
    }
  });

  it('accepts the k8s watcher eventId shapes', () => {
    for (const eventId of [
      'k8s:job-uid-1:failed',
      'k8s:cronjob-uid-2:schedule-missed:2026-11-09T10:00:00Z',
      'k8s:cronjob-uid-3:no-success:2026-11-09T10:00:00Z',
    ]) {
      expect(validateOpsJobFailureV1({ ...base, eventId }).ok).toBe(true);
    }
  });

  it('rejects an eventId that does not start with the source', () => {
    const result = validateOpsJobFailureV1({ ...base, eventId: 'app:run-1:failed' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_event_id');
  });

  it('rejects an unknown version', () => {
    const result = validateOpsJobFailureV1({ ...base, v: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_version');
  });

  it('rejects a non-product target key', () => {
    for (const targetKey of ['', 'IMMO-PROD', 'immo prod', '-immo', 'x'.repeat(129)]) {
      const result = validateOpsJobFailureV1({ ...base, targetKey });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('bad_target_key');
    }
  });

  it('requires a reason on failed and forbids it on succeeded', () => {
    const { reason: _omitted, ...noReason } = base;
    expect(validateOpsJobFailureV1(noReason).ok).toBe(false);
    const missing = validateOpsJobFailureV1(noReason);
    if (!missing.ok) expect(missing.code).toBe('reason_required_on_failed');
    const succeeded = validateOpsJobFailureV1({
      ...base, outcome: 'succeeded', reason: undefined, severity: undefined, eventId: 'k8s:job-abc123:succeeded',
    });
    expect(succeeded.ok).toBe(true);
    const forbidden = validateOpsJobFailureV1({ ...base, outcome: 'succeeded', eventId: 'k8s:job-abc123:succeeded' });
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) expect(forbidden.code).toBe('reason_forbidden');
  });

  it('rejects open-taxonomy reasons (no unknown prefix)', () => {
    const result = validateOpsJobFailureV1({ ...base, reason: 'unknown-timeout' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_reason');
  });

  it('forbids severity on heartbeat and accepts heartbeat without reason', () => {
    const heartbeat = validateOpsJobFailureV1({
      ...base, outcome: 'heartbeat', reason: undefined, severity: undefined, eventId: 'k8s:cronjob-uid:schedule:2026-11-09T10:00:00Z',
    });
    expect(heartbeat.ok).toBe(true);
    const withSeverity = validateOpsJobFailureV1({
      ...base, outcome: 'heartbeat', reason: undefined, eventId: 'k8s:cronjob-uid:schedule:2026-11-09T10:00:00Z',
    });
    expect(withSeverity.ok).toBe(false);
    if (!withSeverity.ok) expect(withSeverity.code).toBe('severity_forbidden');
  });

  it('rejects a bad timestamp and bad links', () => {
    expect(validateOpsJobFailureV1({ ...base, occurredAt: 'not-a-date' }).ok).toBe(false);
    expect(validateOpsJobFailureV1({ ...base, links: { logs: '' } }).ok).toBe(false);
  });

  it('truncates the free detail to 1 KiB without splitting UTF-8', () => {
    expect(OPS_JOB_FAILURE_DETAIL_MAX_BYTES).toBe(1024);
    const detail = `é`.repeat(700);
    const truncated = truncateOpsDetail(detail);
    expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThanOrEqual(1024);
    expect(() => new TextDecoder('utf8', { fatal: true }).decode(Buffer.from(truncated, 'utf8'))).not.toThrow();
    const result = validateOpsJobFailureV1({ ...base, detail: 'x'.repeat(2000) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Buffer.byteLength(result.event.detail ?? '', 'utf8')).toBeLessThanOrEqual(1024);
  });

  it('keys incidents per target, namespace and job name', () => {
    expect(opsIncidentKey('immo-prod', 'immo', 'radar-refresh-pv')).toBe('immo-prod/immo/radar-refresh-pv');
    expect(opsIncidentKey('immo-prod', undefined, 'radar-refresh-pv')).toBe('immo-prod//radar-refresh-pv');
    expect(opsIncidentKey('immo-prod', undefined, 'radar-refresh-pv')).not.toBe(
      opsIncidentKey('immo-preprod', undefined, 'radar-refresh-pv'),
    );
  });
});
