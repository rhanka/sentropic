<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { apiGet, apiPatch } from '$lib/utils/api';
  import { addToast } from '$lib/stores/toast';
  import { workspaceScope } from '$lib/stores/workspaceScope';
  import GateReview from '$lib/components/GateReview.svelte';

  let initiative: any = null;
  let gateConfig: any = null;
  let gateResult: any = null;
  let loading = true;
  let error = '';

  $: initiativeId = $page.params.id;

  onMount(async () => {
    await loadData();
  });

  async function loadData() {
    loading = true;
    error = '';
    try {
      // Fetch initiative
      const initiativeData = await apiGet(`/api/v1/initiatives/${initiativeId}`);
      initiative = initiativeData;

      // Fetch workspace details (includes gate_config)
      const workspaceId = $workspaceScope?.selectedId;
      if (workspaceId) {
        const workspaces = await apiGet('/api/v1/workspaces');
        const ws = workspaces.items?.find((w: any) => w.id === workspaceId);
        if (ws) {
          // gate_config may be on the workspace object or fetched separately
          gateConfig = ws.gate_config ?? ws.gateConfig ?? null;
        }
      }
    } catch (e: any) {
      error = e.message || 'Failed to load data';
    } finally {
      loading = false;
    }
  }

  async function handleAdvanceStage(targetStage: string) {
    try {
      const result = await apiPatch(`/api/v1/initiatives/${initiativeId}`, {
        maturity_stage: targetStage,
      });

      if (result.gate) {
        gateResult = result.gate;
      }

      if (result.code === 'GATE_BLOCKED') {
        gateResult = result.gate;
        addToast({ message: 'Gate check failed. See blockers below.', type: 'error' });
        return;
      }

      // Update local initiative data
      initiative = { ...initiative, maturityStage: targetStage };
      addToast({ message: `Advanced to stage ${targetStage}`, type: 'success' });
    } catch (e: any) {
      // Handle 422 gate blocked response
      if (e.status === 422) {
        try {
          const body = typeof e.body === 'object' ? e.body : JSON.parse(e.message || '{}');
          gateResult = body.gate;
        } catch {
          // ignore parse errors
        }
        addToast({ message: 'Gate check failed', type: 'error' });
      } else {
        addToast({ message: e.message || 'Failed to advance stage', type: 'error' });
      }
    }
  }
</script>

<div class="gate-page">
  {#if loading}
    <p>Loading gate review...</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if initiative}
    <div class="gate-page-header">
      <button class="back-btn" on:click={() => goto(`/initiative/${initiativeId}`)}>
        &larr; Back to initiative
      </button>
      <h2>{initiative.data?.name ?? 'Initiative'} — Gate Review</h2>
    </div>

    <GateReview
      {gateConfig}
      currentStage={initiative.maturityStage ?? initiative.maturity_stage ?? null}
      gateStatus={initiative.gateStatus ?? initiative.gate_status ?? null}
      {gateResult}
      onAdvanceStage={handleAdvanceStage}
    />
  {:else}
    <p>Initiative not found.</p>
  {/if}
</div>

<style>
  .gate-page {
    max-width: 48rem;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  .gate-page-header {
    margin-bottom: 1.5rem;
  }

  .gate-page-header h2 {
    margin: 0.5rem 0 0;
    font-size: 1.25rem;
  }

  .back-btn {
    background: none;
    border: none;
    color: var(--text-link, #3b82f6);
    cursor: pointer;
    padding: 0;
    font-size: 0.9rem;
  }

  .back-btn:hover {
    text-decoration: underline;
  }

  .error {
    color: #dc2626;
  }
</style>
