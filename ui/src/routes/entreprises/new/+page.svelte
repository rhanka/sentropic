<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { createCompany, createDraftCompany, startCompanyEnrichment, type Company, type CompanyEnrichmentData } from '$lib/stores/companies';
  import { goto } from '$app/navigation';
  import { addToast, removeToast } from '$lib/stores/toast';
  import EditableInput from '$lib/components/EditableInput.svelte';

  let company: Partial<Company> = { 
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
  let isCreating = false;
  
  // Variables réactives pour les données des EditableInput
  $: companyData = {
    name: company.name || '',
    industry: company.industry || '',
    size: company.size || '',
    technologies: company.technologies || '',
    products: company.products || '',
    processes: company.processes || '',
    challenges: company.challenges || '',
    objectives: company.objectives || ''
  };

  const handleEnrichCompany = async () => {
    if (!company.name?.trim()) return;
    
    isEnriching = true;
    
    try {
      // Créer l'entreprise en mode draft
      const draftCompany = await createDraftCompany(company.name);
      
      // Démarrer l'enrichissement asynchrone
      await startCompanyEnrichment(draftCompany.id);
      
      // Afficher un message de succès et rediriger vers la liste
      addToast({
        type: 'success',
        message: 'Entreprise créée ! L\'enrichissement avec l\'IA est en cours...'
      });
      
      // Rediriger vers la liste des entreprises
      goto('/entreprises');
      
    } catch (err) {
      console.error('Failed to create and enrich company:', err);
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Erreur lors de la création de l\'entreprise'
      });
    } finally {
      isEnriching = false;
    }
  };

  const handleFieldUpdate = (field: string, value: string) => {
    // Mettre à jour l'objet company localement immédiatement
    company = { ...company, [field]: value };
    // Mettre à jour companyData pour que fullData soit réactif
    companyData = { ...companyData, [field]: value };
  };

  const handleCreateCompany = async () => {
    if (!company.name?.trim()) return;
    
    isCreating = true;
    try {
      const newCompany = await createCompany(company as Omit<Company, 'id'>);
      addToast({
        type: 'success',
        message: 'Entreprise créée avec succès !'
      });
      // Rediriger vers la page de détail de la nouvelle entreprise
      goto(`/entreprises/${newCompany.id}`);
    } catch (err) {
      console.error('Failed to create company:', err);
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Erreur lors de la création'
      });
    } finally {
      isCreating = false;
    }
  };

  const handleCancel = () => {
    goto('/entreprises');
  };
</script>

{#if company}
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-semibold">
          <EditableInput
            value={company.name || 'Nouvelle entreprise'}
            originalValue=""
            changeId="new-company-name"
            apiEndpoint=""
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
              originalValue=""
              changeId="new-company-industry"
              apiEndpoint=""
              fullData={companyData}
              on:change={(e) => handleFieldUpdate('industry', e.detail.value)}
              on:saved={() => {}}
            />
          </p>
        {/if}
      </div>
      
      <div class="flex gap-2">
        <button 
          class="rounded bg-blue-500 px-4 py-2 text-white disabled:opacity-50"
          data-testid="enrich-company"
          on:click={handleEnrichCompany}
          disabled={isEnriching || !company.name?.trim()}
          title="Enrichir automatiquement avec l'IA"
        >
          {isEnriching ? 'IA...' : 'IA'}
        </button>
        <button 
          class="rounded bg-green-500 px-4 py-2 text-white disabled:opacity-50"
          on:click={handleCreateCompany}
          disabled={!company.name?.trim() || isCreating}
        >
          {isCreating ? 'Création...' : 'Créer'}
        </button>
        <button 
          class="rounded bg-gray-500 px-4 py-2 text-white"
          on:click={handleCancel}
        >
          Annuler
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
            originalValue=""
            changeId="new-company-size"
            apiEndpoint=""
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
            originalValue=""
            changeId="new-company-technologies"
            apiEndpoint=""
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
          value={company.products || 'Non renseigné'}
          originalValue=""
          changeId="new-company-products"
          apiEndpoint=""
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
          value={company.processes || 'Non renseigné'}
          originalValue=""
          changeId="new-company-processes"
          apiEndpoint=""
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
          value={company.challenges || 'Non renseigné'}
          originalValue=""
          changeId="new-company-challenges"
          apiEndpoint=""
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
          value={company.objectives || 'Non renseigné'}
          originalValue=""
          changeId="new-company-objectives"
          apiEndpoint=""
          fullData={companyData}
          markdown={true}
          on:change={(e) => handleFieldUpdate('objectives', e.detail.value)}
          on:saved={() => {}}
        />
      </div>
    </div>
  </div>
{:else}
  <div class="text-center py-12">
    <p class="text-slate-500">Chargement...</p>
  </div>
{/if}
