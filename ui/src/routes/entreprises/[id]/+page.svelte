<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { fetchCompanies, updateCompany, deleteCompany, type Company } from '$lib/stores/companies';
  import { goto } from '$app/navigation';

  let company: Company | null = null;
  let isEditing = false;
  let draft: Partial<Company> = {};
  let isSaving = false;
  let error = '';

  onMount(async () => {
    const companyId = $page.params.id;
    if (!companyId) return;

    try {
      const companies = await fetchCompanies();
      company = companies.find(c => c.id === companyId) || null;
      if (!company) {
        error = 'Entreprise non trouvée';
        return;
      }
      draft = { ...company };
    } catch (err) {
      console.error('Failed to fetch company:', err);
      error = 'Erreur lors du chargement de l\'entreprise';
    }
  });

  const handleSave = async () => {
    if (!company) return;
    
    isSaving = true;
    try {
      const updatedCompany = await updateCompany(company.id, draft);
      company = updatedCompany;
      isEditing = false;
      error = '';
    } catch (err) {
      console.error('Failed to update company:', err);
      error = err instanceof Error ? err.message : 'Erreur lors de la sauvegarde';
    } finally {
      isSaving = false;
    }
  };

  const handleDelete = async () => {
    if (!company) return;
    
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette entreprise ?')) return;
    
    try {
      await deleteCompany(company.id);
      goto('/entreprises');
    } catch (err) {
      console.error('Failed to delete company:', err);
      error = err instanceof Error ? err.message : 'Erreur lors de la suppression';
    }
  };

  const handleCancel = () => {
    if (company) {
      draft = { ...company };
    }
    isEditing = false;
    error = '';
  };
</script>

{#if error}
  <div class="rounded bg-red-50 border border-red-200 p-4 text-red-700 mb-6">
    {error}
  </div>
{/if}

{#if company}
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-semibold">
          {#if isEditing}
            <input 
              class="text-3xl font-semibold bg-transparent border-b-2 border-blue-500 outline-none"
              bind:value={draft.name}
            />
          {:else}
            {company.name}
          {/if}
        </h1>
        {#if company.industry || isEditing}
          <p class="text-lg text-slate-600 mt-1">
            {#if isEditing}
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">Secteur d'activité</label>
                <input 
                  class="text-lg text-slate-600 bg-transparent border-b border-slate-300 outline-none w-full"
                  placeholder="Secteur d'activité"
                  bind:value={draft.industry}
                />
              </div>
            {:else}
              <span class="font-medium">Secteur:</span> {company.industry}
            {/if}
          </p>
        {/if}
      </div>
      
      <div class="flex gap-2">
        {#if isEditing}
          <button 
            class="rounded bg-green-500 px-4 py-2 text-white disabled:opacity-50"
            on:click={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'Sauvegarde...' : 'Sauvegarder'}
          </button>
          <button 
            class="rounded border border-slate-300 px-4 py-2"
            on:click={handleCancel}
          >
            Annuler
          </button>
        {:else}
          <button 
            class="rounded bg-blue-500 px-4 py-2 text-white"
            on:click={() => isEditing = true}
          >
            Modifier
          </button>
          <button 
            class="rounded bg-red-500 px-4 py-2 text-white"
            on:click={handleDelete}
          >
            Supprimer
          </button>
        {/if}
      </div>
    </div>

    <!-- Informations générales -->
    <div class="grid gap-6 md:grid-cols-2">
      <!-- Taille -->
      <div class="rounded border border-slate-200 bg-white p-4">
        <h3 class="font-semibold text-slate-900 mb-2">Taille</h3>
        {#if isEditing}
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Taille de l'entreprise</label>
            <textarea 
              class="w-full rounded border border-slate-300 p-2 text-sm"
              placeholder="Nombre d'employés, chiffre d'affaires..."
              bind:value={draft.size}
              rows="2"
            ></textarea>
          </div>
        {:else}
          <p class="text-slate-600">{company.size || 'Non renseigné'}</p>
        {/if}
      </div>

      <!-- Technologies -->
      <div class="rounded border border-slate-200 bg-white p-4">
        <h3 class="font-semibold text-slate-900 mb-2">Technologies</h3>
        {#if isEditing}
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Technologies utilisées</label>
            <textarea 
              class="w-full rounded border border-slate-300 p-2 text-sm"
              placeholder="Technologies et systèmes d'information utilisés"
              bind:value={draft.technologies}
              rows="3"
            ></textarea>
          </div>
        {:else}
          <p class="text-slate-600">{company.technologies || 'Non renseigné'}</p>
        {/if}
      </div>
    </div>

    <!-- Produits et services -->
    <div class="rounded border border-slate-200 bg-white p-4">
      <h3 class="font-semibold text-slate-900 mb-2">Produits et Services</h3>
      {#if isEditing}
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Produits et services</label>
          <textarea 
            class="w-full rounded border border-slate-300 p-2 text-sm"
            placeholder="Description des principaux produits ou services"
            bind:value={draft.products}
            rows="4"
          ></textarea>
        </div>
      {:else}
        <p class="text-slate-600">{company.products || 'Non renseigné'}</p>
      {/if}
    </div>

    <!-- Processus métier -->
    <div class="rounded border border-slate-200 bg-white p-4">
      <h3 class="font-semibold text-slate-900 mb-2">Processus Métier</h3>
      {#if isEditing}
        <textarea 
          class="w-full rounded border border-slate-300 p-2 text-sm"
          placeholder="Description des processus métier clés"
          bind:value={draft.processes}
          rows="3"
        ></textarea>
      {:else}
        <p class="text-slate-600">{company.processes || 'Non renseigné'}</p>
      {/if}
    </div>

    <!-- Défis -->
    <div class="rounded border border-slate-200 bg-white p-4">
      <h3 class="font-semibold text-slate-900 mb-2">Défis Principaux</h3>
      {#if isEditing}
        <textarea 
          class="w-full rounded border border-slate-300 p-2 text-sm"
          placeholder="Défis auxquels l'entreprise est confrontée"
          bind:value={draft.challenges}
          rows="3"
        ></textarea>
      {:else}
        <p class="text-slate-600">{company.challenges || 'Non renseigné'}</p>
      {/if}
    </div>

    <!-- Objectifs -->
    <div class="rounded border border-slate-200 bg-white p-4">
      <h3 class="font-semibold text-slate-900 mb-2">Objectifs Stratégiques</h3>
      {#if isEditing}
        <textarea 
          class="w-full rounded border border-slate-300 p-2 text-sm"
          placeholder="Objectifs stratégiques de l'entreprise"
          bind:value={draft.objectives}
          rows="3"
        ></textarea>
      {:else}
        <p class="text-slate-600">{company.objectives || 'Non renseigné'}</p>
      {/if}
    </div>
  </div>
{:else if !error}
  <div class="text-center py-12">
    <p class="text-slate-500">Chargement...</p>
  </div>
{/if}
