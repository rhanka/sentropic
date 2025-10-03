<script lang="ts">
  import { companiesStore, fetchCompanies, createCompany, deleteCompany, enrichCompany, type Company, type CompanyEnrichmentData } from '$lib/stores/companies';
  import { addToast } from '$lib/stores/toast';
  import { onMount } from 'svelte';

  let showForm = false;
  let draft: Partial<Company> = { 
    name: '', 
    industry: '', 
    size: '', 
    products: '', 
    processes: '', 
    challenges: '', 
    objectives: '', 
    technologies: '' 
  };
  let isEnriching = false;

  onMount(async () => {
    try {
      const companies = await fetchCompanies();
      companiesStore.set(companies);
    } catch (err) {
      console.error('Failed to fetch companies:', err);
      addToast({
        type: 'error',
        message: 'Erreur lors du chargement des entreprises'
      });
    }
  });

  const handleEnrichCompany = async () => {
    if (!draft.name?.trim()) return;
    
    isEnriching = true;
    
    try {
      const enrichedData: CompanyEnrichmentData = await enrichCompany(draft.name);
      
      // Mettre à jour le draft avec les données enrichies
      draft = {
        ...draft,
        name: enrichedData.normalizedName,
        industry: enrichedData.industry,
        size: enrichedData.size,
        products: enrichedData.products,
        processes: enrichedData.processes,
        challenges: enrichedData.challenges,
        objectives: enrichedData.objectives,
        technologies: enrichedData.technologies
      };
      
      addToast({
        type: 'success',
        message: 'Entreprise enrichie avec succès !'
      });
    } catch (err) {
      console.error('Failed to enrich company:', err);
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Erreur lors de l\'enrichissement'
      });
    } finally {
      isEnriching = false;
    }
  };

  const handleCreateCompany = async () => {
    if (!draft.name?.trim()) return;
    
    try {
      const newCompany = await createCompany(draft as Omit<Company, 'id'>);
      companiesStore.update((items) => [...items, newCompany]);
      draft = { 
        name: '', 
        industry: '', 
        size: '', 
        products: '', 
        processes: '', 
        challenges: '', 
        objectives: '', 
        technologies: '' 
      };
      showForm = false;
      
      addToast({
        type: 'success',
        message: 'Entreprise créée avec succès !'
      });
    } catch (err) {
      console.error('Failed to create company:', err);
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Erreur lors de la création'
      });
    }
  };

  const handleDeleteCompany = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette entreprise ?')) return;
    
    try {
      await deleteCompany(id);
      companiesStore.update((items) => items.filter(c => c.id !== id));
      
      addToast({
        type: 'success',
        message: 'Entreprise supprimée avec succès !'
      });
    } catch (err) {
      console.error('Failed to delete company:', err);
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Erreur lors de la suppression'
      });
    }
  };
</script>

<section class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-3xl font-semibold">Entreprises</h1>
    <button class="rounded bg-primary px-4 py-2 text-white" on:click={() => (showForm = true)}>
      Ajouter
    </button>
  </div>


  <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
    {#each $companiesStore as company}
      <article class="rounded border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer group" 
               on:click={() => window.location.href = `/entreprises/${company.id}`}>
        <div class="flex justify-between items-start">
          <div class="flex-1">
            <h2 class="text-xl font-medium group-hover:text-blue-600 transition-colors">{company.name}</h2>
            {#if company.industry}
              <p class="mt-1 text-sm text-slate-600">Secteur: {company.industry}</p>
            {/if}
            {#if company.size}
              <p class="mt-1 text-sm text-slate-500">Taille: {company.size}</p>
            {/if}
          </div>
          <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              class="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded"
              on:click|stopPropagation={() => window.location.href = `/entreprises/${company.id}`}
              title="Voir les détails"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
              </svg>
            </button>
            <button 
              class="p-1 text-green-500 hover:text-green-700 hover:bg-green-50 rounded"
              on:click|stopPropagation={() => window.location.href = `/entreprises/${company.id}`}
              title="Modifier"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
              </svg>
            </button>
            <button 
              class="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
              on:click|stopPropagation={() => handleDeleteCompany(company.id)}
              title="Supprimer"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
              </svg>
            </button>
          </div>
        </div>
        {#if company.products}
          <p class="mt-2 text-sm text-slate-600 line-clamp-2">{company.products}</p>
        {/if}
        <div class="mt-3 flex items-center justify-between">
          <span class="text-xs text-slate-400">
            Cliquez pour voir les détails
          </span>
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
              Active
            </span>
          </div>
        </div>
      </article>
    {/each}
  </div>

  {#if showForm}
    <div class="fixed inset-0 bg-slate-900/40 z-50">
      <div class="mx-auto mt-8 max-w-2xl rounded bg-white p-6 shadow-lg max-h-[90vh] overflow-y-auto">
        <h2 class="text-lg font-semibold mb-4">Nouvelle entreprise</h2>
        
            <div class="space-y-4">
              <!-- Nom avec bouton d'enrichissement -->
              <div>
                <label for="company-name" class="block text-sm font-medium text-slate-700 mb-1">
                  Nom de l'entreprise *
                </label>
                <div class="flex gap-2">
                  <input
                    id="company-name"
                    class="flex-1 rounded border border-slate-300 p-2"
                    placeholder="Nom de l'entreprise"
                    bind:value={draft.name}
                  />
                  <button 
                    class="rounded bg-blue-500 px-4 py-2 text-white disabled:opacity-50"
                    on:click={handleEnrichCompany}
                    disabled={isEnriching || !draft.name?.trim()}
                    title="Enrichir automatiquement avec l'IA"
                  >
                    {isEnriching ? '...' : 'IA'}
                  </button>
                </div>
              </div>

              <!-- Secteur -->
              <div>
                <label for="company-industry" class="block text-sm font-medium text-slate-700 mb-1">
                  Secteur d'activité
                </label>
                <input
                  id="company-industry"
                  class="w-full rounded border border-slate-300 p-2"
                  placeholder="Secteur d'activité"
                  bind:value={draft.industry}
                />
              </div>

              <!-- Taille -->
              <div>
                <label for="company-size" class="block text-sm font-medium text-slate-700 mb-1">
                  Taille de l'entreprise
                </label>
                <input
                  id="company-size"
                  class="w-full rounded border border-slate-300 p-2"
                  placeholder="Nombre d'employés, chiffre d'affaires..."
                  bind:value={draft.size}
                />
              </div>

              <!-- Produits/Services -->
              <div>
                <label for="company-products" class="block text-sm font-medium text-slate-700 mb-1">
                  Produits et services
                </label>
                <textarea
                  id="company-products"
                  class="w-full rounded border border-slate-300 p-2"
                  placeholder="Description des principaux produits ou services"
                  bind:value={draft.products}
                  rows="3"
                ></textarea>
              </div>

              <!-- Processus -->
              <div>
                <label for="company-processes" class="block text-sm font-medium text-slate-700 mb-1">
                  Processus métier clés
                </label>
                <textarea
                  id="company-processes"
                  class="w-full rounded border border-slate-300 p-2"
                  placeholder="Description des processus métier principaux"
                  bind:value={draft.processes}
                  rows="2"
                ></textarea>
              </div>

              <!-- Défis -->
              <div>
                <label for="company-challenges" class="block text-sm font-medium text-slate-700 mb-1">
                  Défis principaux
                </label>
                <textarea
                  id="company-challenges"
                  class="w-full rounded border border-slate-300 p-2"
                  placeholder="Défis auxquels l'entreprise est confrontée"
                  bind:value={draft.challenges}
                  rows="2"
                ></textarea>
              </div>

              <!-- Objectifs -->
              <div>
                <label for="company-objectives" class="block text-sm font-medium text-slate-700 mb-1">
                  Objectifs stratégiques
                </label>
                <textarea
                  id="company-objectives"
                  class="w-full rounded border border-slate-300 p-2"
                  placeholder="Objectifs stratégiques de l'entreprise"
                  bind:value={draft.objectives}
                  rows="2"
                ></textarea>
              </div>

              <!-- Technologies -->
              <div>
                <label for="company-technologies" class="block text-sm font-medium text-slate-700 mb-1">
                  Technologies utilisées
                </label>
                <textarea
                  id="company-technologies"
                  class="w-full rounded border border-slate-300 p-2"
                  placeholder="Technologies et systèmes d'information utilisés"
                  bind:value={draft.technologies}
                  rows="2"
                ></textarea>
              </div>
            </div>

        <div class="mt-6 flex justify-end gap-2">
              <button 
                class="rounded border border-slate-200 px-4 py-2" 
                on:click={() => {
                  showForm = false;
                }}
              >
                Annuler
              </button>
          <button 
            class="rounded bg-primary px-4 py-2 text-white" 
            on:click={handleCreateCompany}
            disabled={!draft.name?.trim()}
          >
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  {/if}
</section>
