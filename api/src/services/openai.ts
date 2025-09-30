import { env } from '../config/env';

export type GenerateUseCasesParams = {
  input: string;
  createNewFolder: boolean;
  companyId?: string;
};

export const generateUseCases = async (_params: GenerateUseCasesParams) => {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  // TODO: Implement OpenAI orchestration
  return {
    created_folder_id: undefined,
    created_use_case_ids: [],
    summary: 'Generation workflow not implemented yet.'
  };
};
