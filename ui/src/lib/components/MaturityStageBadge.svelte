<script lang="ts">
  export let stage: string | null = null;
  export let gateStatus: string | null = null;

  $: label = stage ?? 'N/A';
  $: statusClass = gateStatus ? `gate-${gateStatus}` : '';
</script>

{#if stage}
  <span class="maturity-badge {statusClass}" title="Maturity: {stage}{gateStatus ? ` (${gateStatus})` : ''}">
    <span class="stage-label">{label}</span>
    {#if gateStatus}
      <span class="gate-indicator"></span>
    {/if}
  </span>
{/if}

<style>
  .maturity-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
    background: #e2e8f0;
    color: #475569;
  }

  .maturity-badge.gate-approved {
    background: #dcfce7;
    color: #166534;
  }

  .maturity-badge.gate-pending {
    background: #fef3c7;
    color: #92400e;
  }

  .maturity-badge.gate-rejected {
    background: #fecaca;
    color: #991b1b;
  }

  .gate-indicator {
    width: 0.375rem;
    height: 0.375rem;
    border-radius: 50%;
  }

  .gate-approved .gate-indicator {
    background: #16a34a;
  }

  .gate-pending .gate-indicator {
    background: #f59e0b;
  }

  .gate-rejected .gate-indicator {
    background: #dc2626;
  }
</style>
