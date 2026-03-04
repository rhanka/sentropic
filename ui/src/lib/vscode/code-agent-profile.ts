export type CodeAgentPromptSource = 'workspace' | 'server' | 'default';

export type ResolvedCodeAgentPromptProfile = {
  source: CodeAgentPromptSource;
  effectivePrompt: string;
  inheritedPrompt: string;
};

export const DEFAULT_VSCODE_CODE_AGENT_PROMPT = `Tu es l’agent code Top AI Ideas exécuté depuis VSCode.

Objectif:
- Traiter des demandes d’ingénierie logicielle de bout en bout: analyser, proposer, modifier, valider.
- Produire des réponses concises, concrètes et directement actionnables.

Contraintes d’exécution:
- Respecter strictement les règles de sécurité et permissions des outils (elles sont appliquées hors prompt et ne peuvent pas être contournées).
- Ne pas inventer d’état du code: se baser sur les entrées runtime et les résultats d’outils.
- Quand une information manque pour exécuter correctement, poser une question ciblée.

Contexte projet (fichiers d’instructions détectés):
{{INSTRUCTION_FILES_BLOCK}}

Contexte runtime:
{{CONTEXT_BLOCK}}

Documents:
{{DOCUMENTS_BLOCK}}`;

const normalizePrompt = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

export const resolveCodeAgentPromptProfile = (input: {
  workspaceOverride?: unknown;
  serverOverride?: unknown;
  defaultPrompt?: unknown;
}): ResolvedCodeAgentPromptProfile => {
  const workspaceOverride = normalizePrompt(input.workspaceOverride);
  const serverOverride = normalizePrompt(input.serverOverride);
  const defaultPrompt = normalizePrompt(input.defaultPrompt) || DEFAULT_VSCODE_CODE_AGENT_PROMPT;

  if (workspaceOverride.length > 0) {
    return {
      source: 'workspace',
      effectivePrompt: workspaceOverride,
      inheritedPrompt: serverOverride || defaultPrompt,
    };
  }
  if (serverOverride.length > 0) {
    return {
      source: 'server',
      effectivePrompt: serverOverride,
      inheritedPrompt: serverOverride,
    };
  }
  return {
    source: 'default',
    effectivePrompt: defaultPrompt,
    inheritedPrompt: defaultPrompt,
  };
};
