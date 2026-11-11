/**
 * CMP-P1 API adapter: seeds the CM prompt registry from settings content.
 *
 * Pure module (no database import): the caller passes the settings record,
 * so tests run without a database. No table, no migration (GD-7 target).
 */
import {
  InMemoryPromptRegistry, type PromptRegistry, promptContentDigest,
} from '@sentropic/cluster-mesh';

export interface CmPromptSettingsVersions {
  readonly [promptId: string]: {
    readonly title: string;
    readonly description?: string;
    readonly versions: {
      readonly [version: string]: {
        readonly content: string;
        readonly author: string;
        readonly approvedBy?: string;
      };
    };
  };
}

export const createCmPromptRegistry = (): PromptRegistry => new InMemoryPromptRegistry();

/** Seeds definitions + versions from the settings record; returns version count. */
export const seedCmPromptsFromSettings = (
  registry: PromptRegistry,
  record: CmPromptSettingsVersions,
): number => {
  let count = 0;
  for (const [promptId, def] of Object.entries(record)) {
    registry.registerDefinition({
      promptId, title: def.title, ...(def.description ? { description: def.description } : {}),
    });
    for (const [version, v] of Object.entries(def.versions)) {
      registry.registerVersion({
        promptId, version, content: v.content, author: v.author,
        ...(v.approvedBy ? { approvedBy: v.approvedBy } : {}),
      });
      count += 1;
    }
  }
  return count;
};

/** Digest-verified read: recomputes the digest, fails closed on mismatch. */
export const getCmPromptContent = (
  registry: PromptRegistry,
  promptId: string,
  version?: string,
): { readonly content: string; readonly digest: string; readonly version: string } | undefined => {
  const found = registry.get(promptId, version);
  if (!found) return undefined;
  if (promptContentDigest(found.content) !== found.digest) {
    throw new Error(`prompt digest mismatch: ${promptId}@${found.version}`);
  }
  return { content: found.content, digest: found.digest, version: found.version };
};
