<script lang="ts">
  import { companiesStore, currentCompanyId } from '$lib/stores/companies';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  let currentInput = '';
  let createNewFolder = true;

  onMount(() => {
    // Placeholder for fetching companies
    companiesStore.set([
      { id: '1', name: 'DemoCorp', industry: 'Tech' },
      { id: '2', name: 'HealthPlus', industry: 'Healthcare' }
    ]);
  });

  const handleSubmit = async () => {
    if (!currentInput.trim()) {
      alert('Veuillez préciser un contexte.');
      return;
    }
    // Placeholder navigation
    goto('/cas-usage');
  };
</script>

<section class="space-y-6">
  <h1 class="text-3xl font-semibold">Générez vos cas d'usage</h1>
  <div class="space-y-4 rounded border border-slate-200 bg-white p-6 shadow-sm">
    <label class="block space-y-2">
      <span class="text-sm font-medium text-slate-700">Décrivez votre contexte</span>
      <textarea
        class="h-40 w-full rounded border border-slate-300 p-3"
        bind:value={currentInput}
        placeholder="Ex: Optimisation du support client dans la banque retail"
      ></textarea>
    </label>
    <label class="block space-y-2">
      <span class="text-sm font-medium text-slate-700">Entreprise (optionnel)</span>
      <select
        class="w-full rounded border border-slate-300 p-2"
        bind:value={$currentCompanyId}
      >
        <option value="">Non spécifié</option>
        {#each $companiesStore as company}
          <option value={company.id}>{company.name}</option>
        {/each}
      </select>
    </label>
    <label class="flex items-center gap-2 text-sm text-slate-600">
      <input type="checkbox" bind:checked={createNewFolder} />
      Créer automatiquement un nouveau dossier
    </label>
    <button class="rounded bg-primary px-4 py-2 text-white" on:click={handleSubmit}>
      Générer vos cas d'usage
    </button>
  </div>
</section>
