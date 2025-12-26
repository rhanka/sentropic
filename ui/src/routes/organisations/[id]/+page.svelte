<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { fetchCompanies, fetchCompanyById, deleteCompany, type Company } from '$lib/stores/companies';
  import { goto } from '$app/navigation';
  import { API_BASE_URL } from '$lib/config';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import { unsavedChangesStore } from '$lib/stores/unsavedChanges';
  import { streamHub } from '$lib/stores/streamHub';

  let company: Company | null = null;
  let error = '';
  let lastLoadedId: string | null = null;
  let hubKey: string | null = null;

  const fixMarkdownLineBreaks = (text: string | null | undefined): string => {
    if (!text) return '';
    return text.replace(/\n/g, '\n\n');
  };

  $: companyData = company
    ? {
        name: company.name,
        industry: company.industry,
        size: company.size,
        technologies: company.technologies,
        products: fixMarkdownLineBreaks(company.products),
        processes: fixMarkdownLineBreaks(company.processes),
        challenges: fixMarkdownLineBreaks(company.challenges),
        objectives: fixMarkdownLineBreaks(company.objectives),
      }
    : {};

  const subscribeCompany = (companyId: string) => {
    if (hubKey) streamHub.delete(hubKey);
    hubKey = `companyDetail:${companyId}`;
    streamHub.set(hubKey, (evt: any) => {
      if (evt?.type !== 'company_update') return;
      const id: string = evt.companyId;
      const data: any = evt.data ?? {};
      if (!id || id !== companyId) return;
      if (data?.deleted) return;
      if (data?.company) {
        company = { ...(company || ({} as any)), ...data.company };
      }
    });
  };

  onMount(async () => {
    await loadCompany();
  });

  onDestroy(() => {
    if (hubKey) streamHub.delete(hubKey);
  });

  $: if ($page.params.id && $page.params.id !== lastLoadedId) {
    loadCompany();
  }

  const loadCompany = async () => {
    const companyId = $page.params.id;
    if (!companyId) return;
    if (lastLoadedId === companyId) return;

    try {
      lastLoadedId = companyId;
      company = await fetchCompanyById(companyId);
      subscribeCompany(companyId);
      error = '';
      unsavedChangesStore.reset();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
      try {
        company = await fetchCompanyById(companyId);
        subscribeCompany(companyId);
        error = '';
        return;
      } catch {
        try {
          const companies = await fetchCompanies();
          company = companies.find((c) => c.id === companyId) || null;
          error = company ? '' : "Organisation non trouvée";
          unsavedChangesStore.reset();
        } catch {
          error = "Erreur lors du chargement de l'organisation";
        }
      }
    }
  };

  const handleFieldUpdate = (field: string, value: string) => {
    if (!company) return;
    company = { ...company, [field]: value };
    companyData = { ...companyData, [field]: value };
  };

  const handleDelete = async () => {
    if (!company) return;

    if (!confirm("Êtes-vous sûr de vouloir supprimer cette organisation ?")) return;

    try {
      await deleteCompany(company.id);
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

{#if company}
  <div class="space-y-6">
    <div class="grid grid-cols-12 gap-4 items-center">
      <div class="col-span-6 min-w-0">
        <h1 class="text-3xl font-semibold break-words mb-0">
          <EditableInput
            value={company.name}
            originalValue={company.name}
            changeId="company-name"
            apiEndpoint={`${API_BASE_URL}/organizations/${company.id}`}
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
              originalValue={company.industry}
              changeId="company-industry"
              apiEndpoint={`${API_BASE_URL}/organizations/${company.id}`}
              fullData={companyData}
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
            value={company.size || 'Non renseigné'}
            originalValue={company.size || ''}
            changeId="company-size"
            apiEndpoint={`${API_BASE_URL}/organizations/${company.id}`}
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
            originalValue={company.technologies || ''}
            changeId="company-technologies"
            apiEndpoint={`${API_BASE_URL}/organizations/${company.id}`}
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
          value={fixMarkdownLineBreaks(company.products) || 'Non renseigné'}
          originalValue={fixMarkdownLineBreaks(company.products) || ''}
          changeId="company-products"
          apiEndpoint={`${API_BASE_URL}/organizations/${company.id}`}
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
          value={fixMarkdownLineBreaks(company.processes) || 'Non renseigné'}
          originalValue={fixMarkdownLineBreaks(company.processes) || ''}
          changeId="company-processes"
          apiEndpoint={`${API_BASE_URL}/organizations/${company.id}`}
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
          value={fixMarkdownLineBreaks(company.challenges) || 'Non renseigné'}
          originalValue={fixMarkdownLineBreaks(company.challenges) || ''}
          changeId="company-challenges"
          apiEndpoint={`${API_BASE_URL}/organizations/${company.id}`}
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
          value={fixMarkdownLineBreaks(company.objectives) || 'Non renseigné'}
          originalValue={fixMarkdownLineBreaks(company.objectives) || ''}
          changeId="company-objectives"
          apiEndpoint={`${API_BASE_URL}/organizations/${company.id}`}
          fullData={companyData}
          markdown={true}
          on:change={(e) => handleFieldUpdate('objectives', e.detail.value)}
          on:saved={() => {}}
        />
      </div>
    </div>

    <!-- KPI section -->
    <div class="rounded border border-slate-200 bg-white p-4">
      <h3 class="font-semibold text-slate-900 mb-3">Indicateurs de performance</h3>
      <div class="grid gap-6 md:grid-cols-2">
        <div>
          <h4 class="text-sm font-semibold text-slate-800 mb-2">Sectoriels</h4>
          {#if company.kpis_sector && company.kpis_sector.length > 0}
            <ul class="list-disc pl-5 text-slate-700">
              {#each company.kpis_sector as kpi}
                <li>{kpi}</li>
              {/each}
            </ul>
          {:else}
            <p class="text-sm text-slate-500">Non renseigné</p>
          {/if}
        </div>
        <div>
          <h4 class="text-sm font-semibold text-slate-800 mb-2">Spécifiques à l'organisation</h4>
          {#if company.kpis_org && company.kpis_org.length > 0}
            <ul class="list-disc pl-5 text-slate-700">
              {#each company.kpis_org as kpi}
                <li>{kpi}</li>
              {/each}
            </ul>
          {:else}
            <p class="text-sm text-slate-500">Non renseigné</p>
          {/if}
        </div>
      </div>
      <p class="mt-3 text-xs text-slate-400">
        Note: édition des KPI (UI) à venir — pour l’instant ils sont affichés s’ils existent dans la donnée.
      </p>
    </div>
  </div>
{:else if !error}
  <div class="text-center py-12">
    <p class="text-slate-500">Chargement...</p>
  </div>
{/if}


