/**
 * Built-in skill bundles shipped with `@sentropic/skills`.
 *
 * Bundles group related skills migrated from the legacy
 * `api/src/services/tools.ts` registry. Each bundle is a self-contained
 * sub-tree (one folder per bundle) exposing:
 *   - A `Skill[]` list of bundled skills (`<bundle>_SKILLS`).
 *   - A `register<Bundle>Skills(registry)` helper to register the whole
 *     bundle into a `SkillRegistry` in one call.
 *
 * Current bundles (BR-19 Lot 5):
 *   - `foundation` — Wave A read-only navigation skills (`workspace`).
 */
export * from './foundation/index.js';
