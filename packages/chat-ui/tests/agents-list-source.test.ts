import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/AgentsList.svelte'), 'utf8');
describe('AgentsList UAT-1 source wiring', () => {
  it('uses DS typed icons, a DS-owned menu surface, and remote-only connection details', () => {
    expect(source).toContain('Icon,');
    expect(source).not.toContain('Avatar');
    expect(source).toContain('const ICON_BY_KIND');
    expect(source).toContain('{#if row.entry.kind === \'remote\'}');
    expect(source).toContain('placement="bottom-end"');
    expect(source).toContain('dense');
  });

  it('keeps resumeable sessions neutral and top-aligns compact activity rows', () => {
    expect(source).toContain('const displayStatusFor');
    expect(source).toContain("? 'active'");
    expect(source).toContain('align-self: flex-start');
    expect(source).toContain('--st-component-selectableRow-captionFontSize');
    expect(source).toContain('--st-semantic-text-muted');
  });
});
