<script lang="ts">
  import { companiesStore } from '$lib/stores/companies';
  import { onMount } from 'svelte';

  let showForm = false;
  let draft = { name: '', industry: '' };

  onMount(() => {
    companiesStore.set([
      { id: '1', name: 'DemoCorp', industry: 'Tech' },
      { id: '2', name: 'HealthPlus', industry: 'Health' }
    ]);
  });

  const createCompany = () => {
    if (!draft.name.trim()) return;
    companiesStore.update((items) => [
      ...items,
      { id: crypto.randomUUID(), ...draft }
    ]);
    draft = { name: '', industry: '' };
    showForm = false;
  };
</script>

<section class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-3xl font-semibold">Entreprises</h1>
    <button class="rounded bg-primary px-4 py-2 text-white" on:click={() => (showForm = true)}>
      Ajouter
    </button>
  </div>
  <div class="grid gap-4 md:grid-cols-2">
    {#each $companiesStore as company}
      <article class="rounded border border-slate-200 bg-white p-4 shadow-sm">
        <h2 class="text-xl font-medium">{company.name}</h2>
        {#if company.industry}
          <p class="mt-2 text-sm text-slate-600">Secteur: {company.industry}</p>
        {/if}
      </article>
    {/each}
  </div>

  {#if showForm}
    <div class="fixed inset-0 bg-slate-900/40">
      <div class="mx-auto mt-24 max-w-md rounded bg-white p-6 shadow-lg">
        <h2 class="text-lg font-semibold">Nouvelle entreprise</h2>
        <div class="mt-4 space-y-3">
          <input
            class="w-full rounded border border-slate-300 p-2"
            placeholder="Nom"
            bind:value={draft.name}
          />
          <input
            class="w-full rounded border border-slate-300 p-2"
            placeholder="Secteur"
            bind:value={draft.industry}
          />
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button class="rounded border border-slate-200 px-4 py-2" on:click={() => (showForm = false)}>
            Annuler
          </button>
          <button class="rounded bg-primary px-4 py-2 text-white" on:click={createCompany}>
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  {/if}
</section>
