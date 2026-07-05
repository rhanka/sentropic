// Canonical inventory of the harness skill pack — the NATIVE superpowers-surface replacement.
//
// `harness skills install --host <h>` reports this plan; the pack ships in the npm tarball under
// `skills/<name>/SKILL.md` (see `package.json` `files`). The host loads each as `harness/<name>`.
// `using-harness` MUST be loaded first — it carries the supersede directive that makes `harness/*`
// take precedence over the superpowers skills it replaces.

export type HostId = 'claude' | 'codex' | 'gemini';

export interface SkillEntry {
  /** Skill id; loaded by a host under the `harness/<name>` namespace. */
  name: string;
  /** One-line purpose. */
  summary: string;
  /** The superpowers skill this supersedes (drives the supersede directive), if any. */
  supersedes?: string;
}

export const HARNESS_SKILLS: SkillEntry[] = [
  { name: 'using-harness', summary: 'index + supersede directive (load FIRST)', supersedes: 'using-superpowers' },
  { name: 'brainstorm', summary: 'spec-ladder STUDY→VOL→EVOL + ≥2-peer review + batched decisions', supersedes: 'brainstorming' },
  { name: 'test', summary: 'test-pyramid + scoped-test loop (not "tdd")', supersedes: 'test-driven-development' },
  { name: 'debug', summary: 'generic root-cause loop', supersedes: 'systematic-debugging' },
  { name: 'review', summary: '≥2-peer consensus review', supersedes: 'requesting-code-review' },
  { name: 'plan', summary: 'spec-ladder + BRANCH.md lots; completes with track', supersedes: 'writing-plans' },
  { name: 'adopt', summary: 'adapt the harness method to ANY repo (profile)' },
];

/** Host → the skills directory `skills install` copies the pack into. */
export const HOST_SKILL_DIR: Record<HostId, string> = {
  claude: '.claude/skills',
  codex: '.codex/skills',
  gemini: '.gemini/skills',
};

export function isHostId(s: string | undefined): s is HostId {
  return s === 'claude' || s === 'codex' || s === 'gemini';
}
