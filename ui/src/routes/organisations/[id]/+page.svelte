<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { fetchOrganizations, fetchOrganizationById, deleteOrganization, type Organization } from '$lib/stores/organizations';
  import { goto } from '$app/navigation';
  import { API_BASE_URL } from '$lib/config';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import { unsavedChangesStore } from '$lib/stores/unsavedChanges';
  import { streamHub } from '$lib/stores/streamHub';
  import References from '$lib/components/References.svelte';

  let organization: Organization | null = null;
  let error = '';
  let lastLoadedId: string | null = null;
  let hubKey: string | null = null;

  const fixMarkdownLineBreaks = (text: string | null | undefined): string => {
    if (!text) return '';
    return text.replace(/\n/g, '\n\n');
  };

  $: organizationData = organization
    ? {
        name: organization.name,
        industry: organization.industry,
        size: organization.size,
        technologies: fixMarkdownLineBreaks(organization.technologies),
        products: fixMarkdownLineBreaks(organization.products),
        processes: fixMarkdownLineBreaks(organization.processes),
        kpis: fixMarkdownLineBreaks(organization.kpis),
        challenges: fixMarkdownLineBreaks(organization.challenges),
        objectives: fixMarkdownLineBreaks(organization.objectives),
      }
    : {};

  const subscribeOrganization = (organizationId: string) => {
    if (hubKey) streamHub.delete(hubKey);
    hubKey = `organizationDetail:${organizationId}`;
    streamHub.set(hubKey, (evt: any) => {
      if (evt?.type !== 'company_update' && evt?.type !== 'organization_update') return;
      const id: string = evt.organizationId || evt.companyId;
      const data: any = evt.data ?? {};
      if (!id || id !== organizationId) return;
      if (data?.deleted) return;
      if (data?.organization || data?.company) {
        const updated = data.organization || data.company;
        organization = { ...(organization || ({} as any)), ...updated };
      }
    });
  };

  onMount(async () => {
    await loadOrganization();
  });

  onDestroy(() => {
    if (hubKey) streamHub.delete(hubKey);
  });

  $: if ($page.params.id && $page.params.id !== lastLoadedId) {
    loadOrganization();
  }

  const loadOrganization = async () => {
    const organizationId = $page.params.id;
    if (!organizationId) return;
    if (lastLoadedId === organizationId) return;

    try {
      lastLoadedId = organizationId;
      organization = await fetchOrganizationById(organizationId);
      subscribeOrganization(organizationId);
      error = '';
      unsavedChangesStore.reset();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
      try {
        organization = await fetchOrganizationById(organizationId);
        subscribeOrganization(organizationId);
        error = '';
        return;
      } catch {
        try {
          const organizations = await fetchOrganizations();
          organization = organizations.find((o) => o.id === organizationId) || null;
          error = organization ? '' : 'Organisation non trouvée';
          unsavedChangesStore.reset();
        } catch {
          error = "Erreur lors du chargement de l'organisation";
        }
      }
    }
  };

  const handleFieldUpdate = (field: string, value: string) => {
    if (!organization) return;
    organization = { ...organization, [field]: value };
    organizationData = { ...organizationData, [field]: value };
  };

  const handleDelete = async () => {
    if (!organization) return;

    if (!confirm("Êtes-vous sûr de vouloir supprimer cette organisation ?")) return;

    try {
      await deleteOrganization(organization.id);
      unsavedChangesStore.reset();
      goto('/organisations');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Erreur lors de la suppression';
    }
  };
</script>

{#if error}
  <div class="rounded bg-red-50 border border-red-200 p-4 text-red-700 mb-6">
    {error}
  </div>
{/if}

{#if organization}
  <div class="space-y-6">
    <div class="grid grid-cols-12 gap-4 items-center">
      <div class="col-span-6 min-w-0">
        <h1 class="text-3xl font-semibold break-words mb-0">
          <EditableInput
            value={organization.name}
            originalValue={organization.name}
            changeId="organization-name"
            apiEndpoint={`${API_BASE_URL}/organizations/${organization.id}`}
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
              originalValue={organization.industry}
              changeId="organization-industry"
              apiEndpoint={`${API_BASE_URL}/organizations/${organization.id}`}
              fullData={organizationData}
              on:change={(e) => handleFieldUpdate('industry', e.detail.value)}
              on:saved={() => {}}
            />
          </p>
        {/if}
      </div>

      <div class="col-span-6 flex items-center justify-end gap-2">
        <button
          class="rounded bg-red-500 px-4 py-2 text-white"
          title="Supprimer"
          on:click={handleDelete}
        >
          Supprimer
        </button>
      </div>
    </div>

    <div class="grid gap-6 md:grid-cols-2">
      <div class="rounded border border-slate-200 bg-white p-4">
        <h3 class="font-semibold text-slate-900 mb-2">Taille</h3>
        <div class="text-slate-600">
          <EditableInput
            value={organization.size || 'Non renseigné'}
            originalValue={organization.size || ''}
            changeId="organization-size"
            apiEndpoint={`${API_BASE_URL}/organizations/${organization.id}`}
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
            value={fixMarkdownLineBreaks(organization.technologies) || 'Non renseigné'}
            originalValue={fixMarkdownLineBreaks(organization.technologies) || ''}
            changeId="organization-technologies"
            apiEndpoint={`${API_BASE_URL}/organizations/${organization.id}`}
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
          value={fixMarkdownLineBreaks(organization.products) || 'Non renseigné'}
          originalValue={fixMarkdownLineBreaks(organization.products) || ''}
          changeId="organization-products"
          apiEndpoint={`${API_BASE_URL}/organizations/${organization.id}`}
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
          value={fixMarkdownLineBreaks(organization.processes) || 'Non renseigné'}
          originalValue={fixMarkdownLineBreaks(organization.processes) || ''}
          changeId="organization-processes"
          apiEndpoint={`${API_BASE_URL}/organizations/${organization.id}`}
          fullData={organizationData}
          markdown={true}
          on:change={(e) => handleFieldUpdate('processes', e.detail.value)}
          on:saved={() => {}}
        />
      </div>
    </div>

    <!-- KPI (unique string) — placé juste sous Processus -->
    <div class="rounded border border-slate-200 bg-white p-4">
      <h3 class="font-semibold text-slate-900 mb-2">Indicateurs de performance</h3>
      <div class="text-slate-600">
        <EditableInput
          value={fixMarkdownLineBreaks(organization.kpis) || 'Non renseigné'}
          originalValue={fixMarkdownLineBreaks(organization.kpis) || ''}
          changeId="organization-kpis"
          apiEndpoint={`${API_BASE_URL}/organizations/${organization.id}`}
          fullData={organizationData}
          markdown={true}
          multiline={true}
          on:change={(e) => handleFieldUpdate('kpis', e.detail.value)}
          on:saved={() => {}}
        />
      </div>
    </div>

    <!-- Références (lecture seule, a minima) -->
    {#if organization.references && organization.references.length > 0}
      <div class="rounded border border-slate-200 bg-white p-4">
        <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
          <h3 class="font-semibold">Références</h3>
        </div>
        <References references={organization.references} referencesScaleFactor={1} />
      </div>
    {/if}

    <div class="rounded border border-slate-200 bg-white p-4">
      <h3 class="font-semibold text-slate-900 mb-2">Défis Principaux</h3>
      <div class="text-slate-600">
        <EditableInput
          value={fixMarkdownLineBreaks(organization.challenges) || 'Non renseigné'}
          originalValue={fixMarkdownLineBreaks(organization.challenges) || ''}
          changeId="organization-challenges"
          apiEndpoint={`${API_BASE_URL}/organizations/${organization.id}`}
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
          value={fixMarkdownLineBreaks(organization.objectives) || 'Non renseigné'}
          originalValue={fixMarkdownLineBreaks(organization.objectives) || ''}
          changeId="organization-objectives"
          apiEndpoint={`${API_BASE_URL}/organizations/${organization.id}`}
          fullData={organizationData}
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


