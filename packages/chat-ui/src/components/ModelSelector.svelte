<script lang="ts">
  /**
   * ModelSelector — a native <select> component for provider/model selection.
   *
   * Preserves native <select> semantics as specified in radar neg:chat-librarization-radar P1.
   * Extracted from AppChatPanel.svelte (lines 4159-4243, 5827-5849 on main).
   *
   * Contract:
   * - value is a 'provider::model' composite key (two-way bindable via bind:value).
   * - groups is the pre-computed ModelCatalogGroup[] (use groupModelsByProvider()).
   * - models is the flat ModelCatalogModel[] for fallback resolution.
   * - widthCh is the min-width in ch units (use computeModelSelectorWidthCh()).
   * - labels is an injected resolver (key: string) => string for all user-visible strings.
   *   No hardcoded user-facing string is emitted — all go through labels().
   * - onChange fires after a valid selection change with the new parsed pair.
   */

  import type { ChatUiLabelResolver } from '../hosts/createWebHost.js';
  import type {
    ModelCatalogGroup,
    ModelCatalogModel,
    ModelProviderId,
  } from '../utils/model-selection.js';
  import {
    formatModelSelectionKey,
    parseModelSelectionKey,
    providerGroupLabel,
    resolveFallbackModelOption,
  } from '../utils/model-selection.js';

  /** The currently-selected 'provider::model' composite key (bindable). */
  export let value: string = '';

  /** Provider-grouped model list (use groupModelsByProvider()). */
  export let groups: ModelCatalogGroup[] = [];

  /** Flat model list — used only for fallback rendering when groups is empty. */
  export let models: ModelCatalogModel[] = [];

  /** Width of the <select> element in `ch` units (use computeModelSelectorWidthCh()). */
  export let widthCh: number = 18;

  /**
   * i18n / label resolver injected by the host.
   * Receives a key string; returns the display string.
   * No user-facing string is hardcoded in this component.
   */
  export let labels: ChatUiLabelResolver | undefined = undefined;

  /**
   * Fires after the user picks a new selection that parses successfully.
   * Payload: { providerId, modelId }.
   */
  export let onChange:
    | ((payload: { providerId: ModelProviderId; modelId: string }) => void)
    | undefined = undefined;

  // ---------------------------------------------------------------------------
  // Derived: the currently-selected provider/model parsed from the composite key
  // ---------------------------------------------------------------------------
  $: parsed = parseModelSelectionKey(value);
  $: selectedProviderId = (parsed?.providerId ?? 'openai') as ModelProviderId;
  $: selectedModelId = parsed?.modelId ?? '';

  // ---------------------------------------------------------------------------
  // Fallback option (shown when groups is empty — catalog not yet loaded)
  // ---------------------------------------------------------------------------
  $: fallbackOption =
    groups.length === 0
      ? resolveFallbackModelOption(models, selectedProviderId, selectedModelId)
      : null;

  $: fallbackValue = fallbackOption
    ? formatModelSelectionKey(fallbackOption.provider_id, fallbackOption.model_id)
    : value;

  $: fallbackLabel = fallbackOption?.label ?? selectedModelId;

  // ---------------------------------------------------------------------------
  // Resolved labels — all user-visible strings go through the resolver
  // ---------------------------------------------------------------------------
  const resolveLabel = (key: string): string => labels?.(key) ?? key;

  // ---------------------------------------------------------------------------
  // Event handler
  // ---------------------------------------------------------------------------
  const handleChange = (event: Event) => {
    const target = event.currentTarget as HTMLSelectElement | null;
    if (!target) return;
    const next = parseModelSelectionKey(target.value);
    if (!next) return;
    value = target.value;
    onChange?.(next);
  };
</script>

<!--
  Native <select> — preserves browser a11y (keyboard navigation, screen-reader
  role="combobox", OS-native touch pickers). Do not replace with a custom listbox.
-->
<select
  id="chat-model-selection"
  {value}
  on:change={handleChange}
  class="w-auto px-2 py-0.5 text-[11px] text-slate-700 focus:outline-none"
  style={`width:${widthCh}ch;min-width:${widthCh}ch;`}
  aria-label={resolveLabel('chat.model.selector.label')}
>
  {#if groups.length === 0 && fallbackOption}
    <!-- Catalog not yet loaded: render a single option so the select is not empty -->
    <option value={fallbackValue}>{fallbackLabel}</option>
  {:else}
    {#each groups as group}
      <optgroup label={providerGroupLabel(group.provider)}>
        {#each group.models as modelOption}
          <option value={formatModelSelectionKey(modelOption.provider_id, modelOption.model_id)}>
            {modelOption.label}
          </option>
        {/each}
      </optgroup>
    {/each}
  {/if}
</select>
