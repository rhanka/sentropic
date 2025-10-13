<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { fetchCompanies, updateCompany, deleteCompany, type Company } from '$lib/stores/companies';
  import { goto } from '$app/navigation';
  import { addToast } from '$lib/stores/toast';
  import { API_BASE_URL } from '$lib/config';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import { refreshManager } from '$lib/stores/refresh';

  let company: Company | null = null;
  let error = '';
  
  // Helper pour transformer les sauts de ligne simples en doubles (pour markdown)
  const fixMarkdownLineBreaks = (text: string | null | undefined): string => {
    if (!text) return '';
    return text.replace(/\n/g, '\n\n');
  };

  // Variables réactives pour les données des EditableInput
  $: companyData = company ? {
    name: company.name,
    industry: company.industry,
    size: company.size,
    technologies: company.technologies,
    products: fixMarkdownLineBreaks(company.products),
    processes: fixMarkdownLineBreaks(company.processes),
    challenges: fixMarkdownLineBreaks(company.challenges),
    objectives: fixMarkdownLineBreaks(company.objectives)
  } : {};

  // Réactivité pour détecter les changements de statut et gérer l'actualisation
  $: if (company) {
    const isEnriching = company.status === 'enriching';
    
    if (isEnriching) {
      // Démarrer l'actualisation légère si ce n'est pas déjà fait
      if (!refreshManager.isRefreshActive(`company-${company.id}`)) {
        refreshManager.startCompanyDetailRefresh(company.id, async () => {
          await refreshCompanyStatus();
        });
      }
    } else {
      // Arrêter l'actualisation si l'enrichissement est terminé
      refreshManager.stopRefresh(`company-${company.id}`);
    }
  }

  onMount(async () => {
    await loadCompany();
    // Démarrer l'actualisation automatique si nécessaire
    startAutoRefresh();
  });

  onDestroy(() => {
    // Arrêter tous les refreshes quand on quitte la page
    refreshManager.stopAllRefreshes();
  });

  const loadCompany = async () => {
    const companyId = $page.params.id;
    if (!companyId) return;

    try {
      const companies = await fetchCompanies();
      company = companies.find(c => c.id === companyId) || null;
      if (!company) {
        error = 'Entreprise non trouvée';
        return;
      }
    } catch (err) {
      console.error('Failed to fetch company:', err);
      error = 'Erreur lors du chargement de l\'entreprise';
    }
  };

  const refreshCompanyStatus = async () => {
    if (!company) return;
    
    try {
      const companies = await fetchCompanies();
      const updatedCompany = companies.find(c => c.id === company.id);
      if (updatedCompany) {
        company = updatedCompany;
      }
    } catch (err) {
      console.error('Failed to refresh company status:', err);
    }
  };

  const startAutoRefresh = () => {
    // L'auto-refresh est géré par la réactivité ci-dessus
  };

  const handleFieldUpdate = (field: string, value: string) => {
    if (!company) return;
    // Mettre à jour l'objet company localement immédiatement
    company = { ...company, [field]: value };
    // Mettre à jour companyData pour que fullData soit réactif
    companyData = { ...companyData, [field]: value };
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
          <EditableInput
            value={company.name}
            originalValue={company.name}
            changeId="company-name"
            apiEndpoint={`${API_BASE_URL}/companies/${company.id}`}
            fullData={companyData}
            on:change={(e) => handleFieldUpdate('name', e.detail.value)}
            on:saved={() => {}}
          />
        </h1>
        {#if company.industry}
          <p class="text-lg text-slate-600 mt-1">
            <span class="font-medium">Secteur:</span> 
            <EditableInput
              value={company.industry}
              originalValue={company.industry}
              changeId="company-industry"
              apiEndpoint={`${API_BASE_URL}/companies/${company.id}`}
              fullData={companyData}
              on:change={(e) => handleFieldUpdate('industry', e.detail.value)}
              on:saved={() => {}}
            />
          </p>
        {/if}
      </div>
      
      <div class="flex gap-2">
        <button 
          class="rounded bg-red-500 px-4 py-2 text-white"
          data-testid="delete-company"
          on:click={handleDelete}
        >
          Supprimer
        </button>
      </div>
    </div>

    <!-- Informations générales -->
    <div class="grid gap-6 md:grid-cols-2">
      <!-- Taille -->
      <div class="rounded border border-slate-200 bg-white p-4">
        <h3 class="font-semibold text-slate-900 mb-2">Taille</h3>
        <div class="text-slate-600">
          <EditableInput
            value={company.size || 'Non renseigné'}
            originalValue={company.size || ''}
            changeId="company-size"
            apiEndpoint={`${API_BASE_URL}/companies/${company.id}`}
            fullData={companyData}
            markdown={true}
            on:change={(e) => handleFieldUpdate('size', e.detail.value)}
            on:saved={() => {}}
          />
        </div>
      </div>

      <!-- Technologies -->
      <div class="rounded border border-slate-200 bg-white p-4">
        <h3 class="font-semibold text-slate-900 mb-2">Technologies</h3>
        <div class="text-slate-600">
          <EditableInput
            value={company.technologies || 'Non renseigné'}
            originalValue={company.technologies || ''}
            changeId="company-technologies"
            apiEndpoint={`${API_BASE_URL}/companies/${company.id}`}
            fullData={companyData}
            markdown={true}
            on:change={(e) => handleFieldUpdate('technologies', e.detail.value)}
            on:saved={() => {}}
          />
        </div>
      </div>
    </div>

    <!-- Produits et services -->
    <div class="rounded border border-slate-200 bg-white p-4">
      <h3 class="font-semibold text-slate-900 mb-2">Produits et Services</h3>
      <div class="text-slate-600">
        <EditableInput
          value={fixMarkdownLineBreaks(company.products) || 'Non renseigné'}
          originalValue={fixMarkdownLineBreaks(company.products) || ''}
          changeId="company-products"
          apiEndpoint={`${API_BASE_URL}/companies/${company.id}`}
          fullData={companyData}
          markdown={true}
          on:change={(e) => handleFieldUpdate('products', e.detail.value)}
          on:saved={() => {}}
        />
      </div>
    </div>

    <!-- Processus métier -->
    <div class="rounded border border-slate-200 bg-white p-4">
      <h3 class="font-semibold text-slate-900 mb-2">Processus Métier</h3>
      <div class="text-slate-600">
        <EditableInput
          value={fixMarkdownLineBreaks(company.processes) || 'Non renseigné'}
          originalValue={fixMarkdownLineBreaks(company.processes) || ''}
          changeId="company-processes"
          apiEndpoint={`${API_BASE_URL}/companies/${company.id}`}
          fullData={companyData}
          markdown={true}
          on:change={(e) => handleFieldUpdate('processes', e.detail.value)}
          on:saved={() => {}}
        />
      </div>
    </div>

    <!-- Défis -->
    <div class="rounded border border-slate-200 bg-white p-4">
      <h3 class="font-semibold text-slate-900 mb-2">Défis Principaux</h3>
      <div class="text-slate-600">
        <EditableInput
          value={fixMarkdownLineBreaks(company.challenges) || 'Non renseigné'}
          originalValue={fixMarkdownLineBreaks(company.challenges) || ''}
          changeId="company-challenges"
          apiEndpoint={`${API_BASE_URL}/companies/${company.id}`}
          fullData={companyData}
          markdown={true}
          on:change={(e) => handleFieldUpdate('challenges', e.detail.value)}
          on:saved={() => {}}
        />
      </div>
    </div>

    <!-- Objectifs -->
    <div class="rounded border border-slate-200 bg-white p-4">
      <h3 class="font-semibold text-slate-900 mb-2">Objectifs Stratégiques</h3>
      <div class="text-slate-600">
        <EditableInput
          value={fixMarkdownLineBreaks(company.objectives) || 'Non renseigné'}
          originalValue={fixMarkdownLineBreaks(company.objectives) || ''}
          changeId="company-objectives"
          apiEndpoint={`${API_BASE_URL}/companies/${company.id}`}
          fullData={companyData}
          markdown={true}
          on:change={(e) => handleFieldUpdate('objectives', e.detail.value)}
          on:saved={() => {}}
        />
      </div>
    </div>
  </div>
{:else if !error}
  <div class="text-center py-12">
    <p class="text-slate-500">Chargement...</p>
  </div>
{/if}
