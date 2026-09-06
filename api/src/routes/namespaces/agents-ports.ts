import { LEGACY_PROMPT_CATALOG } from '../../config/default-chat-system';
import { postgresAgentTemplate, type PostgresAgentTemplate } from '../../services/flow';
import { executeWithToolsStream } from '../../services/tools';

export interface PromptProfile {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly variables: readonly string[];
}

export type AgentsFlowPort = Pick<
  PostgresAgentTemplate,
  'list' | 'upsertMany' | 'fork' | 'reset' | 'delete'
>;

export interface AgentsSkillsPort {
  testPrompt(question: string): Promise<{ readonly content: string; readonly streamId: string }>;
}

export interface AgentsCatalogPort {
  listPromptProfiles(): readonly PromptProfile[];
  updatePromptProfiles(profiles: readonly PromptProfile[]): Promise<readonly PromptProfile[]>;
}

export interface AgentsNamespacePorts {
  readonly flow: AgentsFlowPort;
  readonly skills: AgentsSkillsPort;
  readonly catalog: AgentsCatalogPort;
}

export const createProductAgentsPorts = (): AgentsNamespacePorts => ({
  flow: postgresAgentTemplate,
  skills: {
    async testPrompt(question) {
      const result = await executeWithToolsStream(question, {
        useWebSearch: true,
        streamId: `prompt_test_${Date.now()}`,
        reasoningSummary: 'auto',
      });
      return { content: result.content, streamId: result.streamId };
    },
  },
  catalog: {
    listPromptProfiles: () => LEGACY_PROMPT_CATALOG,
    async updatePromptProfiles(profiles) {
      return profiles;
    },
  },
});
