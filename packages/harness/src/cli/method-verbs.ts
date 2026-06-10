// Method / recorder verbs of the harness CLI.
//
// These verbs do NOT compute a pass/fail verdict — they record a neutral `WorkEvent` and print
// guidance + the `harness/*` skill pointer that carries the LLM reasoning. They stay PURE: no
// git/docker/fs side-effects (a worktree, a test run, a skills copy are make/host recipes the
// verb PRINTS, never performs). The reasoning lives in the skill; the binary only scaffolds +
// records (see SPEC_DECISION_SCOPE_OWNERSHIP_HARNESS_TRACK_STP.md).

import { toWorkEvent } from '../run/work-event.js';
import type { WorkEventContext, WorkEventInput } from '../run/work-event.js';
import type { WorkEventValue } from '../artifacts/work-event.js';
import { str, type FlagValue } from './args.js';

const PLACEHOLDER_TS = '1970-01-01T00:00:00.000Z';

/** The recorder verbs handled here (not the `check`/`verify`/`init`/`audit` producers). */
export const METHOD_VERBS = ['brainstorm', 'debug', 'review', 'plan', 'test', 'branch', 'skills'] as const;
export type MethodVerb = (typeof METHOD_VERBS)[number];

export function isMethodVerb(v: string | undefined): v is MethodVerb {
  return v !== undefined && (METHOD_VERBS as readonly string[]).includes(v);
}

/** Pure work-event context — the caller injects commit/branch/env; the driver passes placeholders. */
export function workContext(flags: Record<string, FlagValue>): WorkEventContext {
  return {
    runId: 'cli',
    commit: str(flags.commit) ?? 'unknown',
    branch: str(flags['current-branch']) ?? 'unknown',
    env: str(flags.env) ?? 'cli',
    runner: 'harness',
    at: PLACEHOLDER_TS,
  };
}

interface Built {
  input?: WorkEventInput;
  lines: string[];
  code: number;
}

function num(v: FlagValue | undefined): number | undefined {
  const s = str(v);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function prune(detail: Record<string, WorkEventValue | undefined>): Record<string, WorkEventValue> {
  const out: Record<string, WorkEventValue> = {};
  for (const [k, v] of Object.entries(detail)) if (v !== undefined) out[k] = v;
  return out;
}

function header(verb: string, status: string, skill?: string): string {
  return `harness ${verb} — ${status}${skill ? ` (skill: ${skill})` : ''}`;
}

function build(verb: MethodVerb, positionals: string[], flags: Record<string, FlagValue>): Built {
  const subject = positionals[1];

  switch (verb) {
    case 'brainstorm': {
      const detail = prune({ peers: num(flags.peers), ladder: str(flags.ladder) });
      return {
        input: { verb, status: 'opened', subject, skill: 'harness/brainstorm', detail },
        lines: [
          header('brainstorm', 'opened', 'harness/brainstorm'),
          '  load harness/brainstorm: spec-ladder STUDY→VOL→EVOL, ≥2-peer adversarial review, batched decisions.',
        ],
        code: 0,
      };
    }
    case 'debug': {
      return {
        input: { verb, status: 'opened', subject, skill: 'harness/debug', detail: {} },
        lines: [
          header('debug', 'opened', 'harness/debug'),
          '  load harness/debug: reproduce → evidence → one hypothesis → one fix → re-observe → regression test.',
        ],
        code: 0,
      };
    }
    case 'review': {
      const consensus = flags.consensus === true;
      const detail = prune({ consensus, peers: num(flags.peers) ?? (consensus ? 2 : undefined) });
      return {
        input: { verb, status: 'requested', subject, skill: 'harness/review', detail },
        lines: [
          header('review', 'requested', 'harness/review'),
          consensus
            ? '  load harness/review: ≥2 independent peers, distinct lenses, reconcile findings.'
            : '  load harness/review (single pass; add --consensus for ≥2-peer reconciliation).',
        ],
        code: 0,
      };
    }
    case 'plan': {
      const detail = prune({ lots: num(flags.lots) });
      return {
        input: { verb, status: 'opened', subject, skill: 'harness/plan', detail },
        lines: [
          header('plan', 'opened', 'harness/plan'),
          '  load harness/plan: spec-ladder + BRANCH.md lots; harness writes BRANCH.md, then `track branch import`.',
        ],
        code: 0,
      };
    }
    case 'test': {
      const detail = prune({ category: str(flags.category), watch: flags.watch === true });
      return {
        input: { verb, status: 'requested', subject, skill: 'harness/test', detail },
        lines: [
          header('test', 'requested', 'harness/test'),
          '  load harness/test: test-pyramid + scoped loop; run `make test-<area> SCOPE=… ENV=test-<slug>`.',
        ],
        code: 0,
      };
    }
    case 'branch': {
      const sub = positionals[1];
      if (sub !== 'init' && sub !== 'close') {
        return { lines: ['usage: harness branch <init|close> [<slug>]'], code: 2 };
      }
      const slug = positionals[2];
      const status = sub === 'init' ? 'opened' : 'closed';
      const recipe =
        sub === 'init'
          ? '  recipe: git worktree add -b feat/<slug> tmp/<slug> origin/main; scaffold BRANCH.md from plan/BRANCH_TEMPLATE.md.'
          : '  recipe: run the lot-gate roll-up, scope-check staged files, then open/refresh the PR from BRANCH.md.';
      return {
        input: { verb, status, subject: slug, detail: { sub } },
        lines: [header(`branch ${sub}`, status), recipe],
        code: 0,
      };
    }
    case 'skills': {
      const sub = positionals[1];
      if (sub !== 'install') {
        return { lines: ['usage: harness skills install --host <claude|codex|gemini>'], code: 2 };
      }
      const host = str(flags.host);
      if (host !== 'claude' && host !== 'codex' && host !== 'gemini') {
        return { lines: ['usage: harness skills install --host <claude|codex|gemini>'], code: 2 };
      }
      return {
        input: { verb, status: 'requested', subject: 'install', skill: 'harness/using-harness', detail: { host } },
        lines: [
          header('skills install', 'requested', 'harness/using-harness'),
          `  install plan: copy the harness/* skill pack into the ${host} host skills dir; using-harness supersedes superpowers.`,
        ],
        code: 0,
      };
    }
  }
}

/**
 * Handle a method/recorder verb. Returns the exit code; emits a `WorkEvent` (JSON with `--json`)
 * or human-readable guidance via `out`. `null` is returned when `verb` is not a method verb.
 */
export function handleMethodVerb(
  positionals: string[],
  flags: Record<string, FlagValue>,
  out: (s: string) => void,
): number | null {
  const verb = positionals[0];
  if (!isMethodVerb(verb)) return null;

  const built = build(verb, positionals, flags);
  if (built.code !== 0 || !built.input) {
    for (const l of built.lines) out(l);
    return built.code;
  }

  if (flags.json === true) {
    out(JSON.stringify(toWorkEvent(built.input, workContext(flags)), null, 2));
  } else {
    for (const l of built.lines) out(l);
  }
  return 0;
}
