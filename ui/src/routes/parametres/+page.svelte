<script lang="ts">
  import { settingsStore } from '$lib/stores/settings';
  import { get } from 'svelte/store';

  let draft = get(settingsStore);
  let openaiModelsText = JSON.stringify(draft.openaiModels, null, 2);

  const save = () => {
    try {
      draft = {
        ...draft,
        openaiModels: JSON.parse(openaiModelsText)
      };
      settingsStore.set(draft);
      alert('Paramètres enregistrés (placeholder).');
    } catch (error) {
      alert('JSON invalide pour les modèles OpenAI.');
    }
  };
</script>

<section class="space-y-6">
  <h1 class="text-3xl font-semibold">Paramètres</h1>
  <div class="space-y-4 rounded border border-slate-200 bg-white p-6">
    <label class="block space-y-2">
      <span class="text-sm font-medium text-slate-700">Modèles OpenAI</span>
      <textarea
        class="h-32 w-full rounded border border-slate-300 p-2 font-mono text-sm"
        bind:value={openaiModelsText}
      ></textarea>
    </label>
    <button class="rounded bg-primary px-4 py-2 text-white" on:click={save}>Enregistrer</button>
  </div>
</section>
