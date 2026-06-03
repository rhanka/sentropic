import type { Component } from 'svelte';
import type { ChatUiLabelResolver } from '../hosts/createWebHost.js';
import type { ModelCatalogGroup, ModelCatalogModel, ModelProviderId } from '../utils/model-selection.js';

export type ModelSelectorProps = {
  /** The currently-selected 'provider::model' composite key (two-way bindable). */
  value?: string;
  /** Provider-grouped model list (use groupModelsByProvider()). */
  groups?: ModelCatalogGroup[];
  /** Flat model list — used only for fallback rendering when groups is empty. */
  models?: ModelCatalogModel[];
  /** Width of the <select> element in `ch` units (use computeModelSelectorWidthCh()). */
  widthCh?: number;
  /** i18n / label resolver injected by the host. */
  labels?: ChatUiLabelResolver;
  /**
   * Fires after the user picks a new selection that parses successfully.
   * Payload: { providerId, modelId }.
   */
  onChange?: (payload: { providerId: ModelProviderId; modelId: string }) => void;
};

declare const ModelSelector: Component<ModelSelectorProps>;

export default ModelSelector;
