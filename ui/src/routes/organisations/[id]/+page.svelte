<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { fetchOrganizations, fetchOrganizationById, deleteOrganization, type Organization } from '$lib/stores/organizations';
  import { goto } from '$app/navigation';
  import { API_BASE_URL } from '$lib/config';
  import { unsavedChangesStore } from '$lib/stores/unsavedChanges';
  import { streamHub } from '$lib/stores/streamHub';
  import References from '$lib/components/References.svelte';
  import DocumentsBlock from '$lib/components/DocumentsBlock.svelte';
  import OrganizationForm from '$lib/components/OrganizationForm.svelte';
  import { Trash2 } from '@lucide/svelte';

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
      if (evt?.type !== 'organization_update') return;
      const id: string = evt.organizationId;
      const data: any = evt.data ?? {};
      if (!id || id !== organizationId) return;
      if (data?.deleted) return;
      if (data?.organization) {
        const updated = data.organization;
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
  <OrganizationForm
    organization={organization as any}
    {organizationData}
    apiEndpoint={`${API_BASE_URL}/organizations/${organization.id}`}
    onFieldUpdate={(field, value) => handleFieldUpdate(field, value)}
    showKpis={true}
    nameLabel=""
  >
    <div slot="actions" class="flex items-center gap-2">
      <button
        class="rounded p-2 transition text-warning hover:bg-slate-100"
        title="Supprimer"
        aria-label="Supprimer"
        on:click={handleDelete}
      >
        <Trash2 class="w-5 h-5" />
      </button>
    </div>

    <div slot="underHeader">
      <DocumentsBlock contextType="organization" contextId={organization.id} />
    </div>

    <div slot="bottom">
      <!-- Références (lecture seule, en fin de page) -->
      {#if organization.references && organization.references.length > 0}
        <div class="rounded border border-slate-200 bg-white p-4">
          <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
            <h3 class="font-semibold">Références</h3>
          </div>
          <References references={organization.references} referencesScaleFactor={1} />
        </div>
      {/if}
    </div>
  </OrganizationForm>
{:else if !error}
  <div class="text-center py-12">
    <p class="text-slate-500">Chargement...</p>
  </div>
{/if}


