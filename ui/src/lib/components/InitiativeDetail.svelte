<script lang="ts">
  /* eslint-disable svelte/no-at-html-tags */
  // All {@html} usage in this file is routed through renderMarkdownWithRefs(),
  // which sanitizes HTML via DOMPurify to protect against XSS.

  import EditableInput from '$lib/components/EditableInput.svelte';
  import CommentBadge from '$lib/components/CommentBadge.svelte';
  import TemplateRenderer from '$lib/components/TemplateRenderer.svelte';
  import type { OpenCommentsHandler } from '$lib/types/comments';
  import type { MatrixConfig } from '$lib/types/matrix';
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { apiGet } from '$lib/utils/api';
  import { resolveViewTemplate } from '$lib/stores/viewTemplateCache';
  import { initiativesStore } from '$lib/stores/initiatives';
  import { goto } from '$app/navigation';
  import { normalizeUseCaseMarkdown, renderMarkdownWithRefs } from '$lib/utils/markdown';
  import { formatCompactModelLabel } from '$lib/utils/model-display';
  import { workspaceScope } from '$lib/stores/workspaceScope';

  export let useCase: any;
  export let matrix: MatrixConfig | null = null;
  export let calculatedScores: any = null;
  export let isEditing: boolean = false;
  export let organizationId: string | null = null;
  export let organizationName: string | null = null;
  export let locked: boolean = false;
  export let commentCounts: Record<string, number> | null = null;
  export let onOpenComments: OpenCommentsHandler | null = null;

  const openComments = (sectionKey: string) => {
    if (onOpenComments) onOpenComments(sectionKey);
  };

  // Reload use case after save (debounced)
  let reloadTimeout: ReturnType<typeof setTimeout> | null = null;
  const reloadUseCase = async (useCaseId: string) => {
    if (reloadTimeout) {
      clearTimeout(reloadTimeout);
    }
    reloadTimeout = setTimeout(async () => {
      try {
        const updated = await apiGet(`/initiatives/${useCaseId}`);
        initiativesStore.update(items => items.map(uc => uc.id === useCaseId ? updated : uc));
        if (useCase?.id === useCaseId) {
          useCase = updated;
        }
      } catch (error) {
        console.error('Failed to reload use case:', error);
      } finally {
        reloadTimeout = null;
      }
    }, 500);
  };

  // Name buffer for editable title
  let nameBuffer = '';
  let nameOriginal = '';
  let lastUseCaseId: string | null = null;

  $: if (useCase?.id) {
    const useCaseName = useCase?.data?.name || useCase?.name || $_('usecase.unnamed');
    if (useCase.id !== lastUseCaseId) {
      lastUseCaseId = useCase.id;
      nameBuffer = useCaseName;
      nameOriginal = useCaseName;
    } else if (useCaseName !== nameOriginal) {
      nameBuffer = useCaseName;
      nameOriginal = useCaseName;
    }
  }

  const getNameFullData = () => {
    if (!useCase?.id) return null;
    return { name: nameBuffer || $_('usecase.unnamed') };
  };

  const handleFieldSaved = async () => {
    if (!useCase?.id) return;
    await reloadUseCase(useCase.id);
  };

  // References (reactive)
  let references: Array<{ title: string; url: string; excerpt?: string }> = [];
  $: references = useCase?.data?.references || useCase?.references || [];

  // Score totals for header display
  $: totalValueScore = useCase?.data?.totalValueScore !== undefined
    ? useCase.data.totalValueScore
    : (useCase?.totalValueScore !== undefined
      ? useCase.totalValueScore
      : (calculatedScores?.finalValueScore !== undefined ? calculatedScores.finalValueScore : null));

  $: totalComplexityScore = useCase?.data?.totalComplexityScore !== undefined
    ? useCase.data.totalComplexityScore
    : (useCase?.totalComplexityScore !== undefined
      ? useCase.totalComplexityScore
      : (calculatedScores?.finalComplexityScore !== undefined ? calculatedScores.finalComplexityScore : null));

  $: showActions = !isPrinting;

  // Print mode detection
  let isPrinting = false;

  onMount(() => {
    const checkPrintMode = () => {
      isPrinting = window.matchMedia('print').matches;
    };

    const handleBeforePrint = () => { isPrinting = true; };
    const handleAfterPrint = () => { isPrinting = false; };

    checkPrintMode();
    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);

    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  });

  // View template resolution
  let viewTemplate: any = null;

  $: currentWorkspace = ($workspaceScope.items || []).find((w) => w.id === $workspaceScope.selectedId);
  $: workspaceType = currentWorkspace?.type || 'ai-ideas';
  $: wsId = $workspaceScope.selectedId ?? '';

  let lastTemplateFetchKey = '';
  $: {
    const fetchKey = `${wsId}:${workspaceType}:initiative`;
    if (fetchKey !== lastTemplateFetchKey && wsId) {
      lastTemplateFetchKey = fetchKey;
      void resolveViewTemplate(wsId, workspaceType, 'initiative').then((desc) => {
        viewTemplate = desc;
      });
    }
  }

  // Build flat data object for TemplateRenderer from useCase
  $: templateData = buildTemplateData(useCase);

  const buildTemplateData = (uc: any): Record<string, any> => {
    if (!uc) return {};
    const d = uc.data ?? {};
    return {
      description: d.description || uc.description || '',
      problem: d.problem || uc.problem || '',
      solution: d.solution || uc.solution || '',
      benefits: d.benefits || uc.benefits || [],
      constraints: d.constraints || [],
      metrics: d.metrics || uc.metrics || [],
      risks: d.risks || uc.risks || [],
      nextSteps: d.nextSteps || uc.nextSteps || [],
      contact: d.contact || uc.contact || '',
      domain: d.domain || uc.domain || '',
      technologies: d.technologies || uc.technologies || [],
      dataSources: d.dataSources || uc.dataSources || [],
      dataObjects: d.dataObjects || uc.dataObjects || [],
      deadline: d.deadline || uc.deadline || '',
      references: (d.references || uc.references || []),
      valueScores: d.valueScores || uc.valueScores || [],
      complexityScores: d.complexityScores || uc.complexityScores || [],
      totalValueScore: totalValueScore,
      totalComplexityScore: totalComplexityScore,
    };
  };

</script>

{#if useCase}
  <div class="template-initiative space-y-6" data-print-mode="true">
    <!-- Status Banner -->
    {#if useCase.status === 'generating' || useCase.status === 'detailing' || useCase.status === 'pending'}
      <div class="rounded border border-blue-200 bg-blue-50 p-4">
        <div class="flex items-center gap-3">
          <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
          <p class="text-sm text-blue-700 font-medium">
            {#if useCase.status === 'detailing'}
              {$_('usecase.status.detailing')}
            {:else if useCase.status === 'generating'}
              {$_('usecase.status.generating')}
            {:else if useCase.status === 'pending'}
              {$_('usecase.status.pending')}
            {/if}
          </p>
        </div>
      </div>
    {/if}

    <!-- Header -->
    <div class="grid grid-cols-12 gap-4 items-center print:grid-cols-1">
      <!-- Title -->
      <div class="col-span-8 print:col-span-1 min-w-0">
        {#if isPrinting}
          <h1 class="text-3xl font-semibold break-words">
            {nameBuffer || useCase?.data?.name || useCase?.name || $_('usecase.unnamed')}
          </h1>
        {:else}
          <h1 class="text-3xl font-semibold mb-0 flex items-center gap-2 group">
            <span class="min-w-0 flex-1 break-words">
              <EditableInput
                locked={locked}
                label=""
                value={nameBuffer || useCase?.data?.name || useCase?.name || $_('usecase.unnamed')}
                markdown={false}
                multiline={true}
                apiEndpoint={useCase?.id ? `/initiatives/${useCase.id}` : ''}
                fullData={getNameFullData()}
                fullDataGetter={getNameFullData as any}
                changeId={useCase?.id ? `usecase-name-${useCase.id}` : ''}
                originalValue={nameOriginal || ''}
                on:change={(e) => {
                  nameBuffer = e.detail.value;
                }}
                on:saved={handleFieldSaved}
              />
            </span>
            <CommentBadge
              count={commentCounts?.name ?? 0}
              disabled={!onOpenComments}
              on:click={() => openComments('name')}
            />
          </h1>
        {/if}
      </div>

      <!-- Badge + Actions -->
      {#if showActions}
        <div class="col-span-4 print:col-span-1 flex items-center justify-end gap-2 no-print">
          {#if organizationId}
            <button
              type="button"
              class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
              on:click={() => goto(`/organizations/${organizationId}`)}
              title={$_('organizations.view')}
            >
              {organizationName || $_('organizations.organization')}
            </button>
          {/if}
          {#if useCase.model}
            <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
              {formatCompactModelLabel(useCase.model)}
            </span>
          {/if}
          <div class="flex gap-2">
          <slot name="actions-view" />
          </div>
        </div>
      {:else if organizationId || useCase.model}
        <!-- Print mode badges -->
        <div class="col-span-4 print:col-span-1 flex items-center justify-end">
          {#if organizationId}
            <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-indigo-100 text-indigo-700">
              {organizationName || $_('organizations.organization')}
            </span>
          {/if}
          {#if useCase.model}
            <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
              {formatCompactModelLabel(useCase.model)}
            </span>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Fields via TemplateRenderer -->
    {#if viewTemplate}
      <TemplateRenderer
        template={viewTemplate}
        data={templateData}
        {locked}
        apiEndpoint={useCase?.id ? `/initiatives/${useCase.id}` : ''}
        commentCounts={commentCounts ?? {}}
        onOpenComments={onOpenComments ? (section) => openComments(section) : null}
        {references}
        {matrix}
        {calculatedScores}
        entityId={useCase?.id ?? ''}
        onFieldSaved={handleFieldSaved}
        {isPrinting}
      />
    {:else}
      <!-- Loading template placeholder -->
      <div class="text-sm text-slate-400 italic py-4">{$_('common.loading')}...</div>
    {/if}

  </div>
{/if}

<style>
  @media print {
    .no-print {
      display: none !important;
    }

    .template-initiative {
      font-size: 10pt;
      line-height: 1.4;
    }
  }

  :global(.description-compact-print) {
    font-size: 0.9em;
    line-height: 1.3;
  }
</style>
