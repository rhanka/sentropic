<script lang="ts">
  import EditableInput from '$lib/components/EditableInput.svelte';
  import CommentBadge from '$lib/components/CommentBadge.svelte';
  import type { OpenCommentsHandler } from '$lib/types/comments';
  import type {
    GetFieldOriginal,
    GetFieldPayload,
    OnFieldSaved,
    OnFieldUpdate,
    OrgField,
  } from '$lib/components/organization-form.types';
  import { _ } from 'svelte-i18n';

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

  // Reactive and generic: dependencies stay explicit through parameters.
  $: fieldValues = buildFieldValues(organizationData, organization);
</script>

{#if organization}
  <div class="space-y-6">
    <div class="grid grid-cols-12 gap-4 items-center">
      <div class="col-span-6 min-w-0">
        <h1 class="text-3xl font-semibold break-words mb-0">
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
        </h1>

        <p class="text-lg text-slate-600 mt-1">
          <span class="font-medium">{$_('organizations.fields.industry')}</span>
          <EditableInput
            value={fieldValues.industry}
            originalValue={getOriginalValue('industry')}
            changeId={apiEndpoint ? 'organization-industry' : 'new-organization-industry'}
            apiEndpoint={apiEndpoint}
            fullData={getPayload('industry')}
            fullDataGetter={() => getPayload('industry')}
            locked={locked}
            placeholder={$_('common.unspecified')}
            on:change={(e) => onFieldUpdate?.('industry', e.detail.value)}
            on:saved={(e) => handleSaved('industry', e as CustomEvent<{ value?: string }>)}
          />
        </p>
      </div>

      <div class="col-span-6 flex items-center justify-end gap-2">
        <slot name="actions" />
      </div>
    </div>

    <slot name="underHeader" />

    <div class="grid gap-6 md:grid-cols-2">
      <div class="rounded border border-slate-200 bg-white p-4" data-comment-section="size">
      <h3 class="font-semibold text-slate-900 mb-2 flex items-center gap-2 group">
        {$_('organizations.fields.size')}
        <CommentBadge
          count={commentCounts?.size ?? 0}
          disabled={!onOpenComments}
          on:click={() => onOpenComments?.('size')}
        />
      </h3>
        <div class="text-slate-600">
          <EditableInput
            value={fieldValues.size}
            originalValue={getOriginalValue('size')}
            changeId={apiEndpoint ? 'organization-size' : 'new-organization-size'}
            apiEndpoint={apiEndpoint}
            fullData={getPayload('size')}
            fullDataGetter={() => getPayload('size')}
            markdown={true}
            locked={locked}
            placeholder={$_('common.unspecified')}
            on:change={(e) => onFieldUpdate?.('size', e.detail.value)}
            on:saved={(e) => handleSaved('size', e as CustomEvent<{ value?: string }>)}
          />
        </div>
      </div>

      <div class="rounded border border-slate-200 bg-white p-4" data-comment-section="technologies">
      <h3 class="font-semibold text-slate-900 mb-2 flex items-center gap-2 group">
        {$_('organizations.fields.technologies')}
        <CommentBadge
          count={commentCounts?.technologies ?? 0}
          disabled={!onOpenComments}
          on:click={() => onOpenComments?.('technologies')}
        />
      </h3>
        <div class="text-slate-600">
          <EditableInput
            value={fieldValues.technologies}
            originalValue={getOriginalValue('technologies')}
            changeId={apiEndpoint ? 'organization-technologies' : 'new-organization-technologies'}
            apiEndpoint={apiEndpoint}
            fullData={getPayload('technologies')}
            fullDataGetter={() => getPayload('technologies')}
            markdown={true}
            locked={locked}
            placeholder={$_('common.unspecified')}
            on:change={(e) => onFieldUpdate?.('technologies', e.detail.value)}
            on:saved={(e) => handleSaved('technologies', e as CustomEvent<{ value?: string }>)}
          />
        </div>
      </div>
    </div>

    <div class="rounded border border-slate-200 bg-white p-4" data-comment-section="products">
    <h3 class="font-semibold text-slate-900 mb-2 flex items-center gap-2 group">
      {$_('organizations.fields.products')}
      <CommentBadge
        count={commentCounts?.products ?? 0}
        disabled={!onOpenComments}
        on:click={() => onOpenComments?.('products')}
      />
    </h3>
      <div class="text-slate-600">
        <EditableInput
          value={fieldValues.products}
          originalValue={getOriginalValue('products')}
          changeId={apiEndpoint ? 'organization-products' : 'new-organization-products'}
          apiEndpoint={apiEndpoint}
          fullData={getPayload('products')}
          fullDataGetter={() => getPayload('products')}
          markdown={true}
          locked={locked}
          placeholder={$_('common.unspecified')}
          on:change={(e) => onFieldUpdate?.('products', e.detail.value)}
          on:saved={(e) => handleSaved('products', e as CustomEvent<{ value?: string }>)}
        />
      </div>
    </div>

    <div class="rounded border border-slate-200 bg-white p-4" data-comment-section="processes">
    <h3 class="font-semibold text-slate-900 mb-2 flex items-center gap-2 group">
      {$_('organizations.fields.processes')}
      <CommentBadge
        count={commentCounts?.processes ?? 0}
        disabled={!onOpenComments}
        on:click={() => onOpenComments?.('processes')}
      />
    </h3>
      <div class="text-slate-600">
        <EditableInput
          value={fieldValues.processes}
          originalValue={getOriginalValue('processes')}
          changeId={apiEndpoint ? 'organization-processes' : 'new-organization-processes'}
          apiEndpoint={apiEndpoint}
          fullData={getPayload('processes')}
          fullDataGetter={() => getPayload('processes')}
          markdown={true}
          locked={locked}
          placeholder={$_('common.unspecified')}
          on:change={(e) => onFieldUpdate?.('processes', e.detail.value)}
          on:saved={(e) => handleSaved('processes', e as CustomEvent<{ value?: string }>)}
        />
      </div>
    </div>

    <slot name="afterProcesses" />

    {#if showKpis}
      <div class="rounded border border-slate-200 bg-white p-4" data-comment-section="kpis">
      <h3 class="font-semibold text-slate-900 mb-2 flex items-center gap-2 group">
        {$_('organizations.fields.kpis')}
        <CommentBadge
          count={commentCounts?.kpis ?? 0}
          disabled={!onOpenComments}
          on:click={() => onOpenComments?.('kpis')}
        />
      </h3>
        <div class="text-slate-600">
          <EditableInput
            value={fieldValues.kpis}
            originalValue={getOriginalValue('kpis')}
            changeId="organization-kpis"
            apiEndpoint={apiEndpoint}
            fullData={getPayload('kpis')}
            fullDataGetter={() => getPayload('kpis')}
            markdown={true}
            multiline={true}
            locked={locked}
            placeholder={$_('common.unspecified')}
            on:change={(e) => onFieldUpdate?.('kpis', e.detail.value)}
            on:saved={(e) => handleSaved('kpis', e as CustomEvent<{ value?: string }>)}
          />
        </div>
      </div>
    {/if}

    <div class="rounded border border-slate-200 bg-white p-4" data-comment-section="challenges">
    <h3 class="font-semibold text-slate-900 mb-2 flex items-center gap-2 group">
      {$_('organizations.fields.challenges')}
      <CommentBadge
        count={commentCounts?.challenges ?? 0}
        disabled={!onOpenComments}
        on:click={() => onOpenComments?.('challenges')}
      />
    </h3>
      <div class="text-slate-600">
        <EditableInput
          value={fieldValues.challenges}
          originalValue={getOriginalValue('challenges')}
          changeId={apiEndpoint ? 'organization-challenges' : 'new-organization-challenges'}
          apiEndpoint={apiEndpoint}
          fullData={getPayload('challenges')}
          fullDataGetter={() => getPayload('challenges')}
          markdown={true}
          locked={locked}
          placeholder={$_('common.unspecified')}
          on:change={(e) => onFieldUpdate?.('challenges', e.detail.value)}
          on:saved={(e) => handleSaved('challenges', e as CustomEvent<{ value?: string }>)}
        />
      </div>
    </div>

    <div class="rounded border border-slate-200 bg-white p-4" data-comment-section="objectives">
    <h3 class="font-semibold text-slate-900 mb-2 flex items-center gap-2 group">
      {$_('organizations.fields.objectives')}
      <CommentBadge
        count={commentCounts?.objectives ?? 0}
        disabled={!onOpenComments}
        on:click={() => onOpenComments?.('objectives')}
      />
    </h3>
      <div class="text-slate-600">
        <EditableInput
          value={fieldValues.objectives}
          originalValue={getOriginalValue('objectives')}
          changeId={apiEndpoint ? 'organization-objectives' : 'new-organization-objectives'}
          apiEndpoint={apiEndpoint}
          fullData={getPayload('objectives')}
          fullDataGetter={() => getPayload('objectives')}
          markdown={true}
          locked={locked}
          placeholder={$_('common.unspecified')}
          on:change={(e) => onFieldUpdate?.('objectives', e.detail.value)}
          on:saved={(e) => handleSaved('objectives', e as CustomEvent<{ value?: string }>)}
        />
      </div>
    </div>

    <slot name="bottom" />
  </div>
{/if}
