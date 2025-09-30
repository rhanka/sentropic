import { writable } from 'svelte/store';

export type Settings = {
  openaiModels: Record<string, string>;
  prompts: Record<string, unknown>;
  generationLimits: Record<string, unknown>;
};

export const settingsStore = writable<Settings>({
  openaiModels: {},
  prompts: {},
  generationLimits: {}
});
