import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { SeatCli } from '../../src/enrollment/seat-bundle.js';
import {
  CODEX_TRUST_DIALOG_PROBE,
  projectClaudeOnboarding,
  projectCodexIntent,
  projectMuseTrust,
  renderCodexSeatConfig,
  SeatOnboardingError,
} from '../../src/enrollment/seat-onboarding-projections.js';
import { captureSeatOnboarding } from '../../src/node/seat-onboarding-capture.js';
import {
  materialiseCellHome,
  materialiseSeatEnvelopes,
} from '../../src/node/seat-onboarding-materialize.js';
import { mkRoot, oversizeClaudeJson, synthBlock, synthEnvelope } from './seat-onboarding-testkit.js';

describe('projectClaudeOnboarding', () => {
  it('projects an oversize synthetic .claude.json to the two-field canonical form', () => {
    const source = oversizeClaudeJson();
    expect(source.length).toBeGreaterThan(48 * 1024);
    const projected = projectClaudeOnboarding(source);
    expect(JSON.parse(projected)).toEqual({ hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.0' });
    expect(projected).not.toContain('oauthAccount');
    expect(projected).not.toContain('foreign');
  });

  it('refuses a source whose onboarding is not completed', () => {
    expect(() => projectClaudeOnboarding(JSON.stringify({ hasCompletedOnboarding: false, lastOnboardingVersion: '2.1.0' })))
      .toThrowError(expect.objectContaining({ code: 'onboarding-incomplete' }) as never);
  });

  it('refuses a malformed lastOnboardingVersion and non-JSON input', () => {
    expect(() => projectClaudeOnboarding(JSON.stringify({ hasCompletedOnboarding: true, lastOnboardingVersion: '2.1' })))
      .toThrowError(expect.objectContaining({ code: 'onboarding-shape-unverified' }) as never);
    expect(() => projectClaudeOnboarding('not json'))
      .toThrowError(SeatOnboardingError);
  });
});

describe('projectMuseTrust', () => {
  it('keeps only the schema_version from a measured-shape trust.json', () => {
    const projects: Record<string, unknown> = {};
    for (let i = 0; i < 23; i += 1) projects[`/foreign/owner/path-${i}`] = { decision: 'trusted' };
    const projected = projectMuseTrust(JSON.stringify({ schema_version: 1, projects }));
    expect(JSON.parse(projected)).toEqual({ schema_version: 1 });
    expect(projected).not.toContain('foreign');
  });

  it('refuses an unknown schema_version', () => {
    expect(() => projectMuseTrust(JSON.stringify({ schema_version: 999, projects: {} })))
      .toThrowError(expect.objectContaining({ code: 'onboarding-shape-unverified' }) as never);
  });
});

describe('projectCodexIntent', () => {
  it('accepts a valid intent and canonicalizes it', () => {
    const projected = projectCodexIntent({ approvalPolicy: 'on-request', mcpServerNames: ['h2a'] });
    expect(JSON.parse(projected)).toEqual({ approvalPolicy: 'on-request', mcpServerNames: ['h2a'] });
  });

  it('refuses an unknown policy, malformed names and extra keys', () => {
    expect(() => projectCodexIntent({ approvalPolicy: 'always', mcpServerNames: ['h2a'] }))
      .toThrowError(expect.objectContaining({ code: 'onboarding-shape-unverified' }) as never);
    expect(() => projectCodexIntent({ approvalPolicy: 'on-request', mcpServerNames: ['h2a', 'h2a'] }))
      .toThrowError(SeatOnboardingError);
    expect(() => projectCodexIntent({ approvalPolicy: 'on-request', mcpServerNames: [], extra: 1 }))
      .toThrowError(SeatOnboardingError);
  });
});

describe('renderCodexSeatConfig', () => {
  const intent = JSON.stringify({ approvalPolicy: 'on-request', mcpServerNames: ['h2a'] });

  it('renders only the cell project, the supplied servers and the policy value', () => {
    const toml = renderCodexSeatConfig(intent, '/cell/ws', {
      projectTrust: true,
      mcpServers: [{ name: 'h2a', command: '/bench/w.sh', args: ['--serve'], defaultToolsApprovalMode: 'approve' }],
    });
    expect(toml).toContain('approval_policy = "on-request"');
    expect(toml).toContain('[projects."/cell/ws"]');
    expect(toml).toContain('trust_level = "trusted"');
    expect(toml).toContain('[mcp_servers.h2a]');
    expect(toml).toContain('default_tools_approval_mode = "approve"');
    expect(toml).not.toContain('foreign');
  });

  it('omits the project trust section and the approval mode when not asked', () => {
    const toml = renderCodexSeatConfig(intent, '/cell/ws', {
      projectTrust: false,
      mcpServers: [{ name: 'h2a', command: '/bench/w.sh', args: [] }],
    });
    expect(toml).not.toContain('[projects.');
    expect(toml).not.toContain('default_tools_approval_mode');
  });

  it('refuses a server outside the intent set', () => {
    expect(() => renderCodexSeatConfig(intent, '/cell/ws', {
      projectTrust: true,
      mcpServers: [{ name: 'outside', command: '/bin/x', args: [] }],
    })).toThrowError(SeatOnboardingError);
  });
});

describe('CODEX_TRUST_DIALOG_PROBE', () => {
  it('is recorded as unverified, keeping the typed blocker as fallback', () => {
    expect(CODEX_TRUST_DIALOG_PROBE.status).toBe('unverified');
    expect(CODEX_TRUST_DIALOG_PROBE.fallbackBlocker).toBe('codex-mcp-approval-unresolved');
  });
});

describe('captureSeatOnboarding for claude, muse and codex (L4)', () => {
  const base = {
    seatRef: 'seat-synth-claude-01',
    ownerScope: 'owner-synth-01',
    accountBinding: 'mesh-account-synth-01',
    nativeCliVersion: '1.4.12',
    os: 'linux' as const,
    capturedAt: '2026-11-02T00:00:00Z',
    lineage: { epoch: 1, generation: 1, operationId: 'op-synth-claude-01' },
  };

  it('captures an oversize claude source to the two-field projection without oauthAccount', async () => {
    const root = await mkRoot();
    await writeFile(join(root, '.claude.json'), oversizeClaudeJson());
    const res = await captureSeatOnboarding({
      ...base, cli: 'claude', sourceHome: root, selector: { sourceRelPath: '.claude.json' },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const content = Buffer.from(res.block.files[0].contentBase64, 'base64').toString('utf8');
    expect(JSON.parse(content)).toEqual({ hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.0' });
    expect(JSON.stringify(res.block)).not.toContain('oauthAccount');
    expect(res.block.cellSynthesis).toEqual([]);
  });

  it('captures a muse trust source to the schema_version-only projection', async () => {
    const root = await mkRoot();
    const dir = join(root, '.config', 'muse');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'trust.json'), JSON.stringify({ schema_version: 1, projects: { '/foreign/x': { decision: 'trusted' } } }));
    const res = await captureSeatOnboarding({
      ...base, cli: 'muse', seatRef: 'seat-synth-muse-01', lineage: { epoch: 1, generation: 1, operationId: 'op-synth-muse-01' },
      sourceHome: root, selector: { sourceRelPath: '.config/muse/trust.json' },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const content = Buffer.from(res.block.files[0].contentBase64, 'base64').toString('utf8');
    expect(JSON.parse(content)).toEqual({ schema_version: 1 });
  });

  it('captures codex from the explicit intent without reading any file', async () => {
    const res = await captureSeatOnboarding({
      ...base, cli: 'codex', seatRef: 'seat-synth-codex-01', lineage: { epoch: 1, generation: 1, operationId: 'op-synth-codex-01' },
      sourceHome: '/nonexistent-home', selector: undefined as never,
      intent: { approvalPolicy: 'on-request', mcpServerNames: ['h2a'] },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const content = Buffer.from(res.block.files[0].contentBase64, 'base64').toString('utf8');
    expect(JSON.parse(content)).toEqual({ approvalPolicy: 'on-request', mcpServerNames: ['h2a'] });
  });

  it('refuses codex capture without the explicit intent', async () => {
    const res = await captureSeatOnboarding({
      ...base, cli: 'codex', seatRef: 'seat-synth-codex-01', lineage: { epoch: 1, generation: 1, operationId: 'op-synth-codex-01' },
      sourceHome: '/nonexistent-home', selector: undefined as never,
    });
    expect(res.ok).toBe(false);
  });
});
