<script lang="ts">
  import { foldersStore, currentFolderId } from '$lib/stores/folders';
  import { onMount } from 'svelte';

  let showCreate = false;
  let name = '';
  let description = '';

  onMount(() => {
    foldersStore.set([
      { id: 'f1', name: 'Expérience client', description: 'Optimisation support', companyId: '1' },
      { id: 'f2', name: 'Industrie 4.0', description: 'Maintenance prédictive', companyId: '2' }
    ]);
  });

  const createFolder = () => {
    if (!name.trim()) return;
    foldersStore.update((items) => [
      ...items,
      { id: crypto.randomUUID(), name, description }
    ]);
    name = '';
    description = '';
    showCreate = false;
  };
</script>

<section class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-3xl font-semibold">Dossiers</h1>
    <button class="rounded bg-primary px-4 py-2 text-white" on:click={() => (showCreate = true)}>
      Nouveau dossier
    </button>
  </div>
  <div class="grid gap-4 md:grid-cols-2">
    {#each $foldersStore as folder}
      <article
        class="rounded border border-slate-200 bg-white p-4 shadow-sm transition hover:border-primary"
        on:click={() => currentFolderId.set(folder.id)}
      >
        <h2 class="text-xl font-medium">{folder.name}</h2>
        {#if folder.description}
          <p class="mt-2 text-sm text-slate-600">{folder.description}</p>
        {/if}
        <p class="mt-4 text-xs uppercase tracking-wide text-slate-400">
          ID: {folder.id}
        </p>
      </article>
    {/each}
  </div>

  {#if showCreate}
    <div class="fixed inset-0 bg-slate-900/40">
      <div class="mx-auto mt-24 max-w-lg rounded bg-white p-6 shadow-lg">
        <h2 class="text-lg font-semibold">Créer un dossier</h2>
        <div class="mt-4 space-y-3">
          <input
            class="w-full rounded border border-slate-300 p-2"
            placeholder="Nom du dossier"
            bind:value={name}
          />
          <textarea
            class="h-32 w-full rounded border border-slate-300 p-2"
            placeholder="Description"
            bind:value={description}
          ></textarea>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button class="rounded border border-slate-200 px-4 py-2" on:click={() => (showCreate = false)}>
            Annuler
          </button>
          <button class="rounded bg-primary px-4 py-2 text-white" on:click={createFolder}>
            Créer
          </button>
        </div>
      </div>
    </div>
  {/if}
</section>
