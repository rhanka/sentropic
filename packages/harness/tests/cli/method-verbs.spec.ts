import { describe, expect, it } from 'vitest';
import { runHarnessCli } from '../../src/cli/run.js';

function capture(argv: string[]): { code: number; text: string } {
  const lines: string[] = [];
  const code = runHarnessCli(argv, (s) => lines.push(s));
  return { code, text: lines.join('\n') };
}

function json(argv: string[]): { code: number; obj: Record<string, unknown> } {
  const { code, text } = capture(argv);
  return { code, obj: JSON.parse(text) as Record<string, unknown> };
}

describe('harness method verbs (WorkEvent recorders)', () => {
  it('usage banner lists the method verbs', () => {
    const { text } = capture([]);
    for (const v of ['brainstorm', 'test', 'debug', 'review', 'plan', 'branch', 'skills']) {
      expect(text).toContain(`harness ${v}`);
    }
  });

  it('brainstorm — prints the skill pointer and exits 0', () => {
    const { code, text } = capture(['brainstorm', 'resource-plane']);
    expect(code).toBe(0);
    expect(text).toMatch(/harness brainstorm — opened \(skill: harness\/brainstorm\)/);
  });

  it('brainstorm --json emits a WorkEvent with subject + detail', () => {
    const { code, obj } = json(['brainstorm', 'resource-plane', '--peers', '3', '--ladder', 'evol', '--json']);
    expect(code).toBe(0);
    expect(obj).toMatchObject({
      kind: 'work-event',
      verb: 'brainstorm',
      status: 'opened',
      subject: 'resource-plane',
      skill: 'harness/brainstorm',
    });
    expect((obj.detail as Record<string, unknown>).peers).toBe(3);
    expect((obj.detail as Record<string, unknown>).ladder).toBe('evol');
  });

  it('review --consensus records consensus + a default peer count of 2', () => {
    const { obj } = json(['review', 'PR-290', '--consensus', '--json']);
    expect(obj.verb).toBe('review');
    expect(obj.status).toBe('requested');
    expect((obj.detail as Record<string, unknown>).consensus).toBe(true);
    expect((obj.detail as Record<string, unknown>).peers).toBe(2);
  });

  it('debug / test / plan route to their skills', () => {
    expect(capture(['debug', 'stream-freeze']).text).toContain('skill: harness/debug');
    expect(capture(['test', '--category', 'unit']).text).toContain('skill: harness/test');
    expect(capture(['plan', 'SPEC_X', '--lots', '4']).text).toContain('skill: harness/plan');
  });

  it('branch init — sub-verb is a positional, status opened', () => {
    const { code, obj } = json(['branch', 'init', 'feat/x', '--json']);
    expect(code).toBe(0);
    expect(obj).toMatchObject({ verb: 'branch', status: 'opened', subject: 'feat/x' });
    expect((obj.detail as Record<string, unknown>).sub).toBe('init');
  });

  it('branch close — status closed', () => {
    const { obj } = json(['branch', 'close', '--json']);
    expect(obj).toMatchObject({ verb: 'branch', status: 'closed' });
  });

  it('branch without a valid sub-verb is a usage error (exit 2)', () => {
    const { code, text } = capture(['branch', '--init']);
    expect(code).toBe(2);
    expect(text).toMatch(/usage: harness branch <init\|close>/);
  });

  it('skills install --host claude records the install request', () => {
    const { code, obj } = json(['skills', 'install', '--host', 'claude', '--json']);
    expect(code).toBe(0);
    expect(obj).toMatchObject({ verb: 'skills', status: 'requested', subject: 'install', skill: 'harness/using-harness' });
    expect((obj.detail as Record<string, unknown>).host).toBe('claude');
  });

  it('skills install without a valid --host is a usage error (exit 2)', () => {
    expect(capture(['skills', 'install']).code).toBe(2);
    expect(capture(['skills', 'install', '--host', 'bogus']).code).toBe(2);
  });
});
