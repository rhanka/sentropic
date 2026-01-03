<script lang="ts">
  import EditableInput from '$lib/components/EditableInput.svelte';
  import type { OnFieldUpdate } from '$lib/components/organization-form.types';

  export let organization: Record<string, any> | null = null;
  export let organizationData: Record<string, any> = {};
  export let apiEndpoint: string = '';
  export let onFieldUpdate: OnFieldUpdate | null = null;
  export let showKpis: boolean = false;
</script>

{#if organization}
  <div class="space-y-6">
    <div class="grid grid-cols-12 gap-4 items-center">
      <div class="col-span-6 min-w-0">
        <h1 class="text-3xl font-semibold break-words mb-0">
          <EditableInput
            value={organizationData?.name || organization.name || 'Nouvelle organisation'}
            originalValue={apiEndpoint ? (organizationData?.name || organization.name || '') : ''}
            changeId={apiEndpoint ? 'organization-name' : 'new-organization-name'}
            apiEndpoint={apiEndpoint}
            fullData={organizationData}
            markdown={false}
            multiline={true}
            on:change={(e) => onFieldUpdate?.('name', e.detail.value)}
            on:saved={() => {}}
          />
        </h1>

        <p class="text-lg text-slate-600 mt-1">
          <span class="font-medium">Secteur:</span>
          <EditableInput
            value={organizationData?.industry || organization.industry || ''}
            originalValue={apiEndpoint ? (organizationData?.industry || organization.industry || '') : ''}
            changeId={apiEndpoint ? 'organization-industry' : 'new-organization-industry'}
            apiEndpoint={apiEndpoint}
            fullData={organizationData}
            on:change={(e) => onFieldUpdate?.('industry', e.detail.value)}
            on:saved={() => {}}
          />
        </p>
      </div>

      <div class="col-span-6 flex items-center justify-end gap-2">
        <slot name="actions" />
      </div>
    </div>

    <slot name="underHeader" />

    <div class="grid gap-6 md:grid-cols-2">
      <div class="rounded border border-slate-200 bg-white p-4">
        <h3 class="font-semibold text-slate-900 mb-2">Taille</h3>
        <div class="text-slate-600">
          <EditableInput
            value={organizationData?.size || organization.size || 'Non renseigné'}
            originalValue={apiEndpoint ? (organizationData?.size || organization.size || '') : ''}
            changeId={apiEndpoint ? 'organization-size' : 'new-organization-size'}
            apiEndpoint={apiEndpoint}
            fullData={organizationData}
            markdown={true}
            on:change={(e) => onFieldUpdate?.('size', e.detail.value)}
            on:saved={() => {}}
          />
        </div>
      </div>

      <div class="rounded border border-slate-200 bg-white p-4">
        <h3 class="font-semibold text-slate-900 mb-2">Technologies</h3>
        <div class="text-slate-600">
          <EditableInput
            value={organizationData?.technologies || organization.technologies || 'Non renseigné'}
            originalValue={apiEndpoint ? (organizationData?.technologies || organization.technologies || '') : ''}
            changeId={apiEndpoint ? 'organization-technologies' : 'new-organization-technologies'}
            apiEndpoint={apiEndpoint}
            fullData={organizationData}
            markdown={true}
            on:change={(e) => onFieldUpdate?.('technologies', e.detail.value)}
            on:saved={() => {}}
          />
        </div>
      </div>
    </div>

    <div class="rounded border border-slate-200 bg-white p-4">
      <h3 class="font-semibold text-slate-900 mb-2">Produits et Services</h3>
      <div class="text-slate-600">
        <EditableInput
          value={organizationData?.products || organization.products || 'Non renseigné'}
          originalValue={apiEndpoint ? (organizationData?.products || organization.products || '') : ''}
          changeId={apiEndpoint ? 'organization-products' : 'new-organization-products'}
          apiEndpoint={apiEndpoint}
          fullData={organizationData}
          markdown={true}
          on:change={(e) => onFieldUpdate?.('products', e.detail.value)}
          on:saved={() => {}}
        />
      </div>
    </div>

    <div class="rounded border border-slate-200 bg-white p-4">
      <h3 class="font-semibold text-slate-900 mb-2">Processus Métier</h3>
      <div class="text-slate-600">
        <EditableInput
          value={organizationData?.processes || organization.processes || 'Non renseigné'}
          originalValue={apiEndpoint ? (organizationData?.processes || organization.processes || '') : ''}
          changeId={apiEndpoint ? 'organization-processes' : 'new-organization-processes'}
          apiEndpoint={apiEndpoint}
          fullData={organizationData}
          markdown={true}
          on:change={(e) => onFieldUpdate?.('processes', e.detail.value)}
          on:saved={() => {}}
        />
      </div>
    </div>

    <slot name="afterProcesses" />

    {#if showKpis}
      <div class="rounded border border-slate-200 bg-white p-4">
        <h3 class="font-semibold text-slate-900 mb-2">Indicateurs de performance</h3>
        <div class="text-slate-600">
          <EditableInput
            value={organizationData?.kpis || organization.kpis || 'Non renseigné'}
            originalValue={apiEndpoint ? (organizationData?.kpis || organization.kpis || '') : ''}
            changeId="organization-kpis"
            apiEndpoint={apiEndpoint}
            fullData={organizationData}
            markdown={true}
            multiline={true}
            on:change={(e) => onFieldUpdate?.('kpis', e.detail.value)}
            on:saved={() => {}}
          />
        </div>
      </div>
    {/if}

    <div class="rounded border border-slate-200 bg-white p-4">
      <h3 class="font-semibold text-slate-900 mb-2">Défis Principaux</h3>
      <div class="text-slate-600">
        <EditableInput
          value={organizationData?.challenges || organization.challenges || 'Non renseigné'}
          originalValue={apiEndpoint ? (organizationData?.challenges || organization.challenges || '') : ''}
          changeId={apiEndpoint ? 'organization-challenges' : 'new-organization-challenges'}
          apiEndpoint={apiEndpoint}
          fullData={organizationData}
          markdown={true}
          on:change={(e) => onFieldUpdate?.('challenges', e.detail.value)}
          on:saved={() => {}}
        />
      </div>
    </div>

    <div class="rounded border border-slate-200 bg-white p-4">
      <h3 class="font-semibold text-slate-900 mb-2">Objectifs Stratégiques</h3>
      <div class="text-slate-600">
        <EditableInput
          value={organizationData?.objectives || organization.objectives || 'Non renseigné'}
          originalValue={apiEndpoint ? (organizationData?.objectives || organization.objectives || '') : ''}
          changeId={apiEndpoint ? 'organization-objectives' : 'new-organization-objectives'}
          apiEndpoint={apiEndpoint}
          fullData={organizationData}
          markdown={true}
          on:change={(e) => onFieldUpdate?.('objectives', e.detail.value)}
          on:saved={() => {}}
        />
      </div>
    </div>

    <slot name="bottom" />
  </div>
{/if}


