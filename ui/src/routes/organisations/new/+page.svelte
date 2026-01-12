<script lang="ts">
  import {
    createOrganization,
    createDraftOrganization,
    fetchOrganizationById,
    updateOrganization,
    startOrganizationEnrichment,
    deleteOrganization,
    type Organization
  } from '$lib/stores/organizations';
  import { goto } from '$app/navigation';
  import { addToast } from '$lib/stores/toast';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import OrganizationForm from '$lib/components/OrganizationForm.svelte';
  import DocumentsBlock from '$lib/components/DocumentsBlock.svelte';
  import { unsavedChangesStore } from '$lib/stores/unsavedChanges';
  import { Brain, Save, Trash2, Loader2 } from '@lucide/svelte';
  import { API_BASE_URL } from '$lib/config';
  import References from '$lib/components/References.svelte';
  import { workspaceReadOnlyScope } from '$lib/stores/workspaceScope';

  let organization: Partial<Organization> = {
    name: '',
    industry: '',
    size: '',
    products: '',
    processes: '',
    challenges: '',
    objectives: '',
    technologies: '',
    kpis: '',
    references: []
  };
  let isEnriching = false;
  let isCreating = false;
  let draftCreating = false;
  let draftError: string | null = null;
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  let docsUploading = false;

  const loadDraftIfAny = async () => {
    const draftId = $page.url.searchParams.get('draft');
    if (!draftId) return;
    try {
      const existing = await fetchOrganizationById(draftId);
      // Si ce n'est plus un brouillon, on bascule vers la vue [id]
      if (existing?.status && existing.status !== 'draft') {
        goto(`/organisations/${existing.id}`);
        return;
      }
      organization = { ...existing };
    } catch (err) {
      console.error('Failed to load draft organization:', err);
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Impossible de charger le brouillon'
      });
      goto('/organisations');
    }
  };

  onMount(() => {
    void loadDraftIfAny();
    if ($workspaceReadOnlyScope) {
      addToast({ type: 'error', message: 'Mode lecture seule : création désactivée.' });
      goto('/organisations');
      return;
    }
  });

  const fixMarkdownLineBreaks = (text: string | null | undefined): string => {
    if (!text) return '';
    return text.replace(/\n/g, '\n\n');
  };

  $: organizationData = {
    name: organization.name || '',
    industry: organization.industry || '',
    size: organization.size || '',
    technologies: fixMarkdownLineBreaks(organization.technologies),
    products: fixMarkdownLineBreaks(organization.products),
    processes: fixMarkdownLineBreaks(organization.processes),
    kpis: fixMarkdownLineBreaks(organization.kpis),
    challenges: organization.challenges || '',
    objectives: organization.objectives || ''
  };

  const ensureDraftOrganization = async (): Promise<string | null> => {
    if (organization.id) return organization.id;
    if (!organization.name?.trim()) return null;
    if (draftCreating) return null;
    draftCreating = true;
    draftError = null;
    try {
      const draftOrganization = await createDraftOrganization(organization.name);
      organization = { ...organization, id: draftOrganization.id };
      return draftOrganization.id;
    } catch (err) {
      draftError = err instanceof Error ? err.message : 'Erreur lors de la création du brouillon';
      return null;
    } finally {
      draftCreating = false;
    }
  };

  // Create draft lazily once user typed a name (debounced), so documents can be attached before creating/enriching.
  $: {
    const name = (organization.name || '').trim();
    if (name && !organization.id && !draftCreating && !$workspaceReadOnlyScope) {
      if (draftTimer) clearTimeout(draftTimer);
      draftTimer = setTimeout(() => {
        void ensureDraftOrganization();
      }, 400);
    }
  }

  const handleEnrichOrganization = async () => {
    if ($workspaceReadOnlyScope) {
      addToast({ type: 'error', message: 'Mode lecture seule : action non autorisée.' });
      return;
    }
    if (!organization.name?.trim()) return;
    if (docsUploading) return;

    isEnriching = true;

    try {
      const id = (await ensureDraftOrganization()) || '';
      if (!id) throw new Error("Impossible de créer l'organisation brouillon");
      await startOrganizationEnrichment(id);

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
    if ($workspaceReadOnlyScope) {
      addToast({ type: 'error', message: 'Mode lecture seule : action non autorisée.' });
      return;
    }
    if (!organization.name?.trim()) return;

    isCreating = true;
    try {
      const id = await ensureDraftOrganization();
      if (!id) {
        // fallback: create directly if draft couldn't be created
      const newOrganization = await createOrganization(organization as Omit<Organization, 'id'>);
        addToast({ type: 'success', message: 'Organisation créée avec succès !' });
        if (newOrganization?.id) {
        unsavedChangesStore.reset();
        goto(`/organisations/${newOrganization.id}`);
        }
        return;
      }

      await updateOrganization(id, organization as Partial<Organization>);
      addToast({ type: 'success', message: 'Organisation créée avec succès !' });
      unsavedChangesStore.reset();
      goto(`/organisations/${id}`);
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
    // Best-effort cleanup of draft organization if it exists
    const id = organization.id;
    if (id) {
      void deleteOrganization(id).catch(() => {});
    }
    goto('/organisations');
  };
</script>

{#if organization}
  <OrganizationForm
    {organization}
    {organizationData}
    apiEndpoint={organization.id ? `${API_BASE_URL}/organizations/${organization.id}` : ''}
    onFieldUpdate={(field, value) => handleFieldUpdate(field, value)}
    showKpis={true}
    nameLabel="Nom de l'organisation"
  >
    <div slot="actions" class="flex items-center gap-2">
        <button
        class="rounded p-2 transition text-primary hover:bg-slate-100 disabled:opacity-50"
          data-testid="enrich-organization"
          on:click={handleEnrichOrganization}
        disabled={$workspaceReadOnlyScope || isEnriching || !organization.name?.trim() || docsUploading}
        title="IA"
        aria-label="IA"
        >
        {#if isEnriching}
          <Loader2 class="w-5 h-5 animate-spin" />
        {:else}
          <Brain class="w-5 h-5" />
        {/if}
        </button>
        <button
        class="rounded p-2 transition text-primary hover:bg-slate-100 disabled:opacity-50"
          title="Créer"
        aria-label="Créer"
          on:click={handleCreateOrganization}
          disabled={$workspaceReadOnlyScope || !organization.name?.trim() || isCreating}
        >
        {#if isCreating}
          <Loader2 class="w-5 h-5 animate-spin" />
        {:else}
          <Save class="w-5 h-5" />
        {/if}
      </button>
      <button
        class="rounded p-2 transition text-warning hover:bg-slate-100"
        on:click={handleCancel}
        title="Annuler"
        aria-label="Annuler"
      >
        <Trash2 class="w-5 h-5" />
        </button>
    </div>

    <div slot="underHeader" class="space-y-4">
      {#if draftError}
        <div class="rounded bg-red-50 border border-red-200 p-3 text-sm text-red-700">{draftError}</div>
      {/if}
      {#if organization.id}
        <DocumentsBlock
          contextType="organization"
          contextId={organization.id}
          on:state={(e) => {
            docsUploading = !!e.detail.uploading;
          }}
        />
      {:else}
        <div class="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Renseigner un nom d’organisation pour activer l’ajout de documents.
        </div>
      {/if}
    </div>

    <div slot="afterProcesses">
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
{/if}


