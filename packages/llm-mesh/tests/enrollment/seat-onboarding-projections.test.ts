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

describe('stage 2 Q2 limited trust write', () => {
  async function stageAndCell(cli: SeatCli, content: string, cellSynthesis: string[]) {
    const root = await mkRoot();
    const seatDir = join(root, 'seat');
    const stage = await materialiseSeatEnvelopes({
      seats: [{ envelope: synthEnvelope(cli, synthBlock(cli, content, cellSynthesis)), seatDir }],
      ownerScope: 'owner-synth-01',
      expectedNativeCliVersions: { [cli]: '1.4.12' },
    });
    if (!stage.ok) throw new Error(`stage failed: ${stage.code}`);
    const cellHome = join(root, 'cell');
    const workspaceDir = join(root, 'ws');
    await mkdir(workspaceDir, { recursive: true });
    const input = {
      seatDir, cellHome, workspaceDir,
      configDirs: { claudeConfigDir: join(cellHome, '.claude'), codexHome: join(cellHome, '.codex'), xdgConfigHome: join(cellHome, '.config') },
      expectedNativeCliVersion: '1.4.12',
      ownerScope: 'owner-synth-01',
    };
    return { root, input };
  }

  it('refuses the trust write when the workspace is not the empty bench-created directory', async () => {
    const { input } = await stageAndCell('claude', JSON.stringify({ hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.0' }), ['claude-workspace-trust']);
    await writeFile(join(input.workspaceDir, 'pre-existing.txt'), 'x');
    const res = await materialiseCellHome(input);
    expect(res.ok).toBe(false);
    await expect(lstat(input.cellHome)).rejects.toThrow();
  });

  it('writes exactly the cell workspace trust entry for claude and no foreign path', async () => {
    const { input } = await stageAndCell('claude', JSON.stringify({ hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.0' }), ['claude-workspace-trust']);
    const res = await materialiseCellHome(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const composed = JSON.parse(await readFile(join(input.configDirs.claudeConfigDir, '.claude.json'), 'utf8'));
    expect(Object.keys(composed.projects)).toEqual([input.workspaceDir]);
    expect(composed.projects[input.workspaceDir]).toEqual({ hasTrustDialogAccepted: true });
  });

  it('writes no trust entry for claude, muse or codex when cellSynthesis is empty', async () => {
    for (const [cli, content] of [
      ['claude', JSON.stringify({ hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.0' })],
      ['muse', JSON.stringify({ schema_version: 1 })],
      ['codex', JSON.stringify({ approvalPolicy: 'on-request', mcpServerNames: ['h2a'] })],
    ] as const) {
      const { input } = await stageAndCell(cli, content, []);
      const res = await materialiseCellHome(input);
      expect(res.ok).toBe(true);
      if (!res.ok) continue;
      if (cli === 'claude') {
        const composed = JSON.parse(await readFile(join(input.configDirs.claudeConfigDir, '.claude.json'), 'utf8'));
        expect(composed.projects).toBeUndefined();
      } else if (cli === 'muse') {
        await expect(lstat(join(input.configDirs.xdgConfigHome, 'muse', 'trust.json'))).rejects.toThrow();
      } else {
        const toml = await readFile(join(input.configDirs.codexHome, 'config.toml'), 'utf8');
        expect(toml).not.toContain('[projects.');
      }
    }
  });

  it('muse materialisation contains exactly one project, the cell workspace', async () => {
    const { input } = await stageAndCell('muse', JSON.stringify({ schema_version: 1 }), ['muse-workspace-trust']);
    const res = await materialiseCellHome(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const trust = JSON.parse(await readFile(join(input.configDirs.xdgConfigHome, 'muse', 'trust.json'), 'utf8'));
    expect(Object.keys(trust.projects)).toEqual([input.workspaceDir]);
  });
});
