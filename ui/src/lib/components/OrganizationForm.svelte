<script lang="ts">
  import EditableInput from '$lib/components/EditableInput.svelte';
  import CommentBadge from '$lib/components/CommentBadge.svelte';
  import TemplateRenderer from '$lib/components/TemplateRenderer.svelte';
  import type { OpenCommentsHandler } from '$lib/types/comments';
  import type {
    GetFieldOriginal,
    GetFieldPayload,
    OnFieldSaved,
    OnFieldUpdate,
    OrgField,
  } from '$lib/components/organization-form.types';
  import { _ } from 'svelte-i18n';
  import { apiGet } from '$lib/utils/api';
  import { resolveViewTemplate } from '$lib/stores/viewTemplateCache';
  import { workspaceScope } from '$lib/stores/workspaceScope';

  export let organization: Record<string, any> | null = null;
  export let organizationData: Record<string, any> = {};
  export let apiEndpoint: string = '';
  export let onFieldUpdate: OnFieldUpdate | null = null;
  export let onFieldSaved: OnFieldSaved | null = null;
  export let getFieldPayload: GetFieldPayload | null = null;
  export let getFieldOriginal: GetFieldOriginal | null = null;
  export let showKpis: boolean = false;
  // UX: sur `organisations/new`, afficher un label explicite. Sur `[id]`, pas de label (titre seul).
  export let nameLabel: string = '';
  export let locked: boolean = false;
  export let commentCounts: Record<string, number> | null = null;
  export let onOpenComments: OpenCommentsHandler | null = null;

  const ORG_FIELDS: OrgField[] = [
    'name',
    'industry',
    'size',
    'technologies',
    'products',
    'processes',
    'challenges',
    'objectives',
    'kpis',
  ];

  const buildFieldValues = (
    primary: Record<string, any> | null | undefined,
    fallback: Record<string, any> | null | undefined
  ): Record<OrgField, string> =>
    Object.fromEntries(
      ORG_FIELDS.map((field) => [field, (primary?.[field] ?? fallback?.[field] ?? '') as string])
    ) as Record<OrgField, string>;

  $: fieldValues = buildFieldValues(organizationData, organization);

  const getFieldValue = (field: OrgField): string =>
    (organizationData?.[field] ?? organization?.[field] ?? '') as string;

  const getOriginalValue = (field: OrgField): string => {
    if (getFieldOriginal) return getFieldOriginal(field);
    if (!apiEndpoint) return '';
    return getFieldValue(field);
  };

  const getPayload = (field: OrgField): Record<string, unknown> => {
    const payload = getFieldPayload?.(field);
    if (payload && typeof payload === 'object') return payload;
    return organizationData;
  };

  const handleSaved = (field: OrgField, event: CustomEvent<{ value?: string }>) => {
    const value = event?.detail?.value ?? getFieldValue(field);
    onFieldSaved?.(field, value);
  };

  // View template resolution
  let viewTemplate: any = null;
  $: currentWorkspace = ($workspaceScope.items || []).find((w) => w.id === $workspaceScope.selectedId);
  $: workspaceType = currentWorkspace?.type || 'ai-ideas';
  $: wsId = $workspaceScope.selectedId ?? '';

  let lastTemplateFetchKey = '';
  $: {
    const fetchKey = `${wsId}:${workspaceType}:organization`;
    if (fetchKey !== lastTemplateFetchKey && wsId) {
      lastTemplateFetchKey = fetchKey;
      void resolveViewTemplate(wsId, workspaceType, 'organization').then((desc) => {
        viewTemplate = desc;
      });
    }
  }

  // Build template data from organization
  $: orgRefs = (organization?.data?.references || organization?.references || []) as Array<{title?: string; url?: string; excerpt?: string} | string>;
  $: refsAsStrings = orgRefs.map((ref: any) => {
    if (typeof ref === 'string') return ref;
    const title = ref.title || ref.url || '';
    const url = ref.url || '';
    const excerpt = ref.excerpt ? ` — ${ref.excerpt}` : '';
    return url ? `[${title}](${url})${excerpt}` : `${title}${excerpt}`;
  });

  $: templateData = {
    size: fieldValues.size,
    technologies: fieldValues.technologies,
    products: fieldValues.products,
    processes: fieldValues.processes,
    kpis: fieldValues.kpis,
    challenges: fieldValues.challenges,
    objectives: fieldValues.objectives,
    references: refsAsStrings,
  };

  const handleTemplateFieldSaved = () => {
    // Trigger onFieldSaved with a generic notification
    onFieldSaved?.('name', getFieldValue('name'));
  };
</script>

{#if organization}
  <div class="space-y-6">
    <div class="grid grid-cols-12 gap-4 items-center">
      <div class="col-span-6 min-w-0">
        <h1 class="text-3xl font-semibold mb-0 flex items-center gap-2 group" data-comment-section="name">
          <span class="min-w-0 flex-1 break-words">
            <EditableInput
              label={nameLabel}
              value={fieldValues.name}
              originalValue={getOriginalValue('name')}
              changeId={apiEndpoint ? 'organization-name' : 'new-organization-name'}
              apiEndpoint={apiEndpoint}
              fullData={getPayload('name')}
              fullDataGetter={() => getPayload('name')}
              markdown={false}
              multiline={true}
              locked={locked}
              placeholder={$_('organizations.form.namePlaceholder')}
              on:change={(e) => onFieldUpdate?.('name', e.detail.value)}
              on:saved={(e) => handleSaved('name', e as CustomEvent<{ value?: string }>)}
            />
          </span>
          <CommentBadge
            count={commentCounts?.name ?? 0}
            disabled={!onOpenComments}
            on:click={() => onOpenComments?.('name')}
          />
        </h1>

        <div class="mt-2 space-y-1 max-w-2xl" data-comment-section="industry">
          <div class="text-sm font-medium text-slate-600 flex items-center gap-2 group">
            {$_('organizations.fields.industry')}
            <CommentBadge
              count={commentCounts?.industry ?? 0}
              disabled={!onOpenComments}
              on:click={() => onOpenComments?.('industry')}
            />
          </div>
          <div class="text-lg text-slate-600">
            <EditableInput
              value={fieldValues.industry}
              originalValue={getOriginalValue('industry')}
              changeId={apiEndpoint ? 'organization-industry' : 'new-organization-industry'}
              apiEndpoint={apiEndpoint}
              fullData={getPayload('industry')}
              fullDataGetter={() => getPayload('industry')}
              fullWidth={true}
              locked={locked}
              placeholder={$_('common.unspecified')}
              on:change={(e) => onFieldUpdate?.('industry', e.detail.value)}
              on:saved={(e) => handleSaved('industry', e as CustomEvent<{ value?: string }>)}
            />
          </div>
        </div>
      </div>

      <div class="col-span-6 flex items-center justify-end gap-2">
        <slot name="actions" />
      </div>
    </div>

    <slot name="underHeader" />

    <!-- Fields via TemplateRenderer -->
    {#if viewTemplate}
      <TemplateRenderer
        template={viewTemplate}
        data={templateData}
        {locked}
        {apiEndpoint}
        commentCounts={commentCounts ?? {}}
        onOpenComments={onOpenComments ? (section) => { if (onOpenComments) onOpenComments(section); } : null}
        references={orgRefs as any[]}
        matrix={null}
        calculatedScores={null}
        entityId={organization?.id ?? ''}
        onFieldSaved={handleTemplateFieldSaved}
        isPrinting={false}
      />
    {:else}
      <!-- Fallback: loading -->
      <div class="text-sm text-slate-400 italic py-4">{$_('common.loading')}...</div>
    {/if}

    <slot name="afterProcesses" />
    <slot name="bottom" />
  </div>
{/if}
