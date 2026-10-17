import type { ScopeGrant } from '../authority.js';
import type { StagedBeginInput, StagedCommitRoot } from '../staged-units.js';
import type { PgCore } from './core.js';
import type { PgProjectionContext, PgSession } from './protocol.js';
import type { PgUnit } from './units.js';
import { ownPgValue } from './ordinary-transactions.js';
import { validatePgPurgePolicy } from './module-effects.js';
export interface PgStagedModuleRequest {
  readonly phase: 'begin' | 'fragment' | 'seal' | 'commit';
  readonly unitId: string; readonly begin: StagedBeginInput;
  readonly root?: StagedCommitRoot; readonly fragment?: { readonly ordinal: string; readonly digest: string };
  readonly barriers: number; readonly purges: number;
}
export interface PgStagedModule {
  authorize(input: PgStagedModuleRequest, context: PgProjectionContext): Promise<void>;
  policy(input: PgStagedModuleRequest, context: PgProjectionContext): Promise<void>;
}
export const checkPgStagedModule = async (core: PgCore, session: PgSession, grant: ScopeGrant<unknown>, unit: PgUnit, phase: PgStagedModuleRequest['phase'], root?: StagedCommitRoot, fragment?: PgStagedModuleRequest['fragment'], policy = false): Promise<void> => {
  const m = unit.metadata; const registry = core.options.stagedModules;
  const module = registry && Object.hasOwn(registry, m.begin.contractDigest) ? registry[m.begin.contractDigest] : undefined;
  const current = await core.roots.capture(session, grant.scope);
  if (!module) { if (policy) await validatePgPurgePolicy(core, session, grant, m.progress?.prepared ?? current.root, m.barriers, m.purges); return; }
  const input = ownPgValue({ phase, unitId: unit.id, begin: m.begin, root, fragment, barriers: m.barriers, purges: m.purges });
  const context = Object.freeze({ session, root: m.progress?.prepared ?? current.root, layout: core.options.layout, grant,
    stream: Object.freeze({ moduleId: core.options.moduleId, scope: grant.scope, incarnation: core.incarnation, stream: core.incarnation }) });
  await module.authorize(input, context);
  if (policy) await module.policy(input, context);
};
