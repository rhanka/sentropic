<script lang="ts">
  import {
    createOrganization,
    createDraftOrganization,
    startOrganizationEnrichment,
    type Organization
  } from '$lib/stores/organizations';
  import { goto } from '$app/navigation';
  import { addToast } from '$lib/stores/toast';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import { unsavedChangesStore } from '$lib/stores/unsavedChanges';

  let organization: Partial<Organization> = {
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

  $: organizationData = {
    name: organization.name || '',
    industry: organization.industry || '',
    size: organization.size || '',
    technologies: organization.technologies || '',
    products: organization.products || '',
    processes: organization.processes || '',
    challenges: organization.challenges || '',
    objectives: organization.objectives || ''
  };

  const handleEnrichOrganization = async () => {
    if (!organization.name?.trim()) return;

    isEnriching = true;

    try {
      const draftOrganization = await createDraftOrganization(organization.name);
      await startOrganizationEnrichment(draftOrganization.id);

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
    organization = { ...organization, [field]: value };
    organizationData = { ...organizationData, [field]: value };
  };

  const handleCreateOrganization = async () => {
    if (!organization.name?.trim()) return;

    isCreating = true;
    try {
      const newOrganization = await createOrganization(organization as Omit<Organization, 'id'>);
      addToast({
        type: 'success',
        message: 'Organisation créée avec succès !'
      });
      if (newOrganization && newOrganization.id) {
        unsavedChangesStore.reset();
        goto(`/organisations/${newOrganization.id}`);
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

{#if organization}
  <div class="space-y-6">
    <div class="grid grid-cols-12 gap-4 items-center">
      <div class="col-span-6 min-w-0">
        <h1 class="text-3xl font-semibold break-words mb-0">
          <EditableInput
            value={organization.name || 'Nouvelle organisation'}
            originalValue=""
            changeId="new-organization-name"
            apiEndpoint=""
            fullData={organizationData}
            markdown={false}
            multiline={true}
            on:change={(e) => handleFieldUpdate('name', e.detail.value)}
            on:saved={() => {}}
          />
        </h1>
        {#if organization.industry}
          <p class="text-lg text-slate-600 mt-1">
            <span class="font-medium">Secteur:</span>
            <EditableInput
              value={organization.industry}
              originalValue=""
              changeId="new-organization-industry"
              apiEndpoint=""
              fullData={organizationData}
              on:change={(e) => handleFieldUpdate('industry', e.detail.value)}
              on:saved={() => {}}
            />
          </p>
        {/if}
      </div>

      <div class="col-span-6 flex items-center justify-end gap-2">
        <button
          class="rounded bg-blue-500 px-4 py-2 text-white disabled:opacity-50"
          data-testid="enrich-organization"
          on:click={handleEnrichOrganization}
          disabled={isEnriching || !organization.name?.trim()}
          title="Enrichir automatiquement avec l'IA"
        >
          {isEnriching ? 'IA...' : 'IA'}
        </button>
        <button
          class="rounded bg-green-500 px-4 py-2 text-white disabled:opacity-50"
          title="Créer"
          on:click={handleCreateOrganization}
          disabled={!organization.name?.trim() || isCreating}
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
            value={organization.size || 'Non renseigné'}
            originalValue=""
            changeId="new-organization-size"
            apiEndpoint=""
            fullData={organizationData}
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
            value={organization.technologies || 'Non renseigné'}
            originalValue=""
            changeId="new-organization-technologies"
            apiEndpoint=""
            fullData={organizationData}
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
          value={organization.products || 'Non renseigné'}
          originalValue=""
          changeId="new-organization-products"
          apiEndpoint=""
          fullData={organizationData}
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
          value={organization.processes || 'Non renseigné'}
          originalValue=""
          changeId="new-organization-processes"
          apiEndpoint=""
          fullData={organizationData}
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
          value={organization.challenges || 'Non renseigné'}
          originalValue=""
          changeId="new-organization-challenges"
          apiEndpoint=""
          fullData={organizationData}
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
          value={organization.objectives || 'Non renseigné'}
          originalValue=""
          changeId="new-organization-objectives"
          apiEndpoint=""
          fullData={organizationData}
          markdown={true}
          on:change={(e) => handleFieldUpdate('objectives', e.detail.value)}
          on:saved={() => {}}
        />
      </div>
    </div>
  </div>
{/if}


