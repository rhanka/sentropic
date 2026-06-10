import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runHarnessCli } from '../../src/cli/run.js';
import { HARNESS_SKILLS, HOST_SKILL_DIR } from '../../src/skills/manifest.js';

function capture(argv: string[]): { code: number; text: string } {
  const lines: string[] = [];
  const code = runHarnessCli(argv, (s) => lines.push(s));
  return { code, text: lines.join('\n') };
}

describe('harness skills install', () => {
  it('lists the whole pack for the chosen host dir', () => {
    const { code, text } = capture(['skills', 'install', '--host', 'claude']);
    expect(code).toBe(0);
    expect(text).toContain(HOST_SKILL_DIR.claude);
    for (const s of HARNESS_SKILLS) expect(text).toContain(`harness-${s.name}/SKILL.md`);
  });

  it('--json WorkEvent carries host, dir and the skill list', () => {
    const { text } = capture(['skills', 'install', '--host', 'gemini', '--json']);
    const obj = JSON.parse(text) as { detail: { host: string; dir: string; skills: string[] } };
    expect(obj.detail.host).toBe('gemini');
    expect(obj.detail.dir).toBe(HOST_SKILL_DIR.gemini);
    expect(obj.detail.skills).toEqual(HARNESS_SKILLS.map((s) => s.name));
  });
});

describe('harness skill pack inventory', () => {
  it('using-harness is first and supersedes using-superpowers', () => {
    expect(HARNESS_SKILLS[0].name).toBe('using-harness');
    expect(HARNESS_SKILLS[0].supersedes).toBe('using-superpowers');
  });

  it('every manifest entry ships a SKILL.md with matching frontmatter name', () => {
    for (const s of HARNESS_SKILLS) {
      const path = `skills/${s.name}/SKILL.md`;
      expect(existsSync(path), `missing ${path}`).toBe(true);
      expect(readFileSync(path, 'utf8')).toContain(`name: ${s.name}`);
    }
  });
});
