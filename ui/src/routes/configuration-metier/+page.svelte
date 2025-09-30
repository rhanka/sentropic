<script lang="ts">
  import { businessStore } from '$lib/stores/business';
  import { onMount } from 'svelte';

  let sectorsInput = '';
  let processesInput = '';

  onMount(() => {
    businessStore.set({
      sectors: [
        { id: 's1', name: 'Banque' },
        { id: 's2', name: 'Industrie' }
      ],
      processes: [
        { id: 'p1', name: 'Support client' },
        { id: 'p2', name: 'Maintenance' }
      ]
    });
  });

  const addSector = () => {
    if (!sectorsInput.trim()) return;
    businessStore.update((current) => ({
      ...current,
      sectors: [...current.sectors, { id: crypto.randomUUID(), name: sectorsInput }]
    }));
    sectorsInput = '';
  };

  const addProcess = () => {
    if (!processesInput.trim()) return;
    businessStore.update((current) => ({
      ...current,
      processes: [...current.processes, { id: crypto.randomUUID(), name: processesInput }]
    }));
    processesInput = '';
  };
</script>

<section class="space-y-6">
  <h1 class="text-3xl font-semibold">Configuration métier</h1>
  <div class="grid gap-6 md:grid-cols-2">
    <section class="rounded border border-slate-200 bg-white p-4">
      <h2 class="text-lg font-medium">Secteurs</h2>
      <ul class="mt-3 space-y-2 text-sm text-slate-600">
        {#each $businessStore.sectors as sector}
          <li class="rounded border border-slate-200 p-2">{sector.name}</li>
        {/each}
      </ul>
      <div class="mt-4 flex gap-2">
        <input
          class="flex-1 rounded border border-slate-300 p-2"
          placeholder="Ajouter un secteur"
          bind:value={sectorsInput}
        />
        <button class="rounded bg-primary px-3 py-2 text-white" on:click={addSector}>Ajouter</button>
      </div>
    </section>
    <section class="rounded border border-slate-200 bg-white p-4">
      <h2 class="text-lg font-medium">Processus</h2>
      <ul class="mt-3 space-y-2 text-sm text-slate-600">
        {#each $businessStore.processes as process}
          <li class="rounded border border-slate-200 p-2">{process.name}</li>
        {/each}
      </ul>
      <div class="mt-4 flex gap-2">
        <input
          class="flex-1 rounded border border-slate-300 p-2"
          placeholder="Ajouter un processus"
          bind:value={processesInput}
        />
        <button class="rounded bg-primary px-3 py-2 text-white" on:click={addProcess}>Ajouter</button>
      </div>
    </section>
  </div>
</section>
