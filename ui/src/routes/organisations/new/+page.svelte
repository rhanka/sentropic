<script lang="ts">
  import { createCompany, createDraftCompany, startCompanyEnrichment, type Company } from '$lib/stores/companies';
  import { goto } from '$app/navigation';
  import { addToast } from '$lib/stores/toast';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import { unsavedChangesStore } from '$lib/stores/unsavedChanges';

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
      const draftCompany = await createDraftCompany(company.name);
      await startCompanyEnrichment(draftCompany.id);

      addToast({
        type: 'success',
        message: "Organisation créée ! L'enrichissement avec l'IA est en cours..."
      });

      goto('/organisations');
    } catch (err) {
      console.error('Failed to create and enrich organization:', err);
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : "Erreur lors de la création de l'organisation"
      });
    } finally {
      isEnriching = false;
    }
  };

  const handleFieldUpdate = (field: string, value: string) => {
    company = { ...company, [field]: value };
    companyData = { ...companyData, [field]: value };
  };

  const handleCreateCompany = async () => {
    if (!company.name?.trim()) return;

    isCreating = true;
    try {
      const newCompany = await createCompany(company as Omit<Company, 'id'>);
      addToast({
        type: 'success',
        message: 'Organisation créée avec succès !'
      });
      if (newCompany && newCompany.id) {
        unsavedChangesStore.reset();
        goto(`/organisations/${newCompany.id}`);
      }
    } catch (err) {
      console.error('Failed to create organization:', err);
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Erreur lors de la création'
      });
    } finally {
      isCreating = false;
    }
  };

  const handleCancel = () => {
    goto('/organisations');
  };
</script>

{#if company}
  <div class="space-y-6">
    <div class="grid grid-cols-12 gap-4 items-center">
      <div class="col-span-6 min-w-0">
        <h1 class="text-3xl font-semibold break-words mb-0">
          <EditableInput
            value={company.name || 'Nouvelle organisation'}
            originalValue=""
            changeId="new-company-name"
            apiEndpoint=""
            fullData={companyData}
            markdown={false}
            multiline={true}
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

      <div class="col-span-6 flex items-center justify-end gap-2">
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
          title="Créer"
          on:click={handleCreateCompany}
          disabled={!company.name?.trim() || isCreating}
        >
          {isCreating ? 'Création...' : 'Créer'}
        </button>
        <button class="rounded bg-gray-500 px-4 py-2 text-white" on:click={handleCancel}>Annuler</button>
      </div>
    </div>

    <div class="grid gap-6 md:grid-cols-2">
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
{/if}


