<script lang="ts">
  import { _ } from 'svelte-i18n';

  export let gateConfig: {
    mode: string;
    stages: string[];
    criteria?: Record<string, { required_fields: string[]; guardrail_categories: string[] }>;
  } | null = null;

  export let currentStage: string | null = null;
  export let gateStatus: string | null = null;
  export let gateResult: {
    gate_passed: boolean;
    warnings: string[];
    blockers: string[];
  } | null = null;

  export let onAdvanceStage: ((targetStage: string) => void) | null = null;

  $: stages = gateConfig?.stages ?? [];
  $: mode = gateConfig?.mode ?? 'free';
  $: criteria = gateConfig?.criteria ?? {};
  $: currentStageIndex = currentStage ? stages.indexOf(currentStage) : -1;
  $: nextStage = currentStageIndex >= 0 && currentStageIndex < stages.length - 1
    ? stages[currentStageIndex + 1]
    : null;

  function getStageStatus(stage: string): 'completed' | 'current' | 'upcoming' {
    const idx = stages.indexOf(stage);
    if (idx < currentStageIndex) return 'completed';
    if (idx === currentStageIndex) return 'current';
    return 'upcoming';
  }

  function handleAdvance() {
    if (nextStage && onAdvanceStage) {
      onAdvanceStage(nextStage);
    }
  }
</script>

<div class="gate-review">
  <div class="gate-header">
    <h3>Gate Review</h3>
    <span class="gate-mode-badge mode-{mode}">{mode}</span>
  </div>

  {#if !gateConfig}
    <p class="gate-info">No gate configuration for this workspace.</p>
  {:else}
    <!-- Stage progression -->
    <div class="stage-progression">
      {#each stages as stage, i}
        {@const status = getStageStatus(stage)}
        <div class="stage-item status-{status}">
          <div class="stage-dot" class:completed={status === 'completed'} class:current={status === 'current'}></div>
          <span class="stage-label">{stage}</span>
          {#if criteria[stage]}
            <span class="stage-criteria-count">
              {criteria[stage].required_fields.length + criteria[stage].guardrail_categories.length} criteria
            </span>
          {/if}
        </div>
        {#if i < stages.length - 1}
          <div class="stage-connector" class:completed={status === 'completed'}></div>
        {/if}
      {/each}
    </div>

    <!-- Current stage details -->
    {#if currentStage}
      <div class="current-stage-info">
        <h4>Current Stage: {currentStage}</h4>
        {#if gateStatus}
          <span class="gate-status-badge status-{gateStatus}">{gateStatus}</span>
        {/if}
      </div>
    {/if}

    <!-- Gate criteria for next stage -->
    {#if nextStage && criteria[nextStage]}
      <div class="next-stage-criteria">
        <h4>Requirements for {nextStage}</h4>

        {#if criteria[nextStage].required_fields.length > 0}
          <div class="criteria-section">
            <h5>Required Fields</h5>
            <ul>
              {#each criteria[nextStage].required_fields as field}
                <li class="criteria-item">
                  <span class="field-name">{field}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if criteria[nextStage].guardrail_categories.length > 0}
          <div class="criteria-section">
            <h5>Guardrail Categories</h5>
            <ul>
              {#each criteria[nextStage].guardrail_categories as category}
                <li class="criteria-item">
                  <span class="category-name">{category}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Gate evaluation result -->
    {#if gateResult}
      <div class="gate-result" class:passed={gateResult.gate_passed} class:failed={!gateResult.gate_passed}>
        <div class="result-header">
          {#if gateResult.gate_passed}
            <span class="result-icon pass">✓</span>
            <span>Gate Passed</span>
          {:else}
            <span class="result-icon fail">✗</span>
            <span>Gate Blocked</span>
          {/if}
        </div>

        {#if gateResult.warnings.length > 0}
          <div class="result-warnings">
            <h5>Warnings</h5>
            <ul>
              {#each gateResult.warnings as warning}
                <li class="warning-item">{warning}</li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if gateResult.blockers.length > 0}
          <div class="result-blockers">
            <h5>Blockers</h5>
            <ul>
              {#each gateResult.blockers as blocker}
                <li class="blocker-item">{blocker}</li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Advance button -->
    {#if nextStage && onAdvanceStage}
      <div class="gate-actions">
        <button
          class="advance-btn"
          on:click={handleAdvance}
          disabled={gateResult !== null && !gateResult.gate_passed}
        >
          Advance to {nextStage}
        </button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .gate-review {
    padding: 1rem;
    border: 1px solid var(--border-color, #e2e8f0);
    border-radius: 0.5rem;
    background: var(--bg-surface, #ffffff);
  }

  .gate-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .gate-header h3 {
    margin: 0;
    font-size: 1.1rem;
  }

  .gate-mode-badge {
    font-size: 0.75rem;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .mode-free { background: #dbeafe; color: #1e40af; }
  .mode-soft { background: #fef3c7; color: #92400e; }
  .mode-hard { background: #fecaca; color: #991b1b; }

  .gate-info {
    color: var(--text-muted, #64748b);
    font-style: italic;
  }

  .stage-progression {
    display: flex;
    align-items: center;
    gap: 0;
    margin: 1rem 0;
  }

  .stage-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    min-width: 3rem;
  }

  .stage-dot {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    background: #e2e8f0;
    border: 2px solid #cbd5e1;
  }

  .stage-dot.completed {
    background: #22c55e;
    border-color: #16a34a;
  }

  .stage-dot.current {
    background: #3b82f6;
    border-color: #2563eb;
  }

  .stage-label {
    font-size: 0.75rem;
    font-weight: 600;
  }

  .stage-criteria-count {
    font-size: 0.625rem;
    color: var(--text-muted, #64748b);
  }

  .stage-connector {
    flex: 1;
    height: 2px;
    background: #e2e8f0;
    min-width: 1rem;
    margin-top: -1rem;
  }

  .stage-connector.completed {
    background: #22c55e;
  }

  .status-completed .stage-label { color: #16a34a; }
  .status-current .stage-label { color: #2563eb; }
  .status-upcoming .stage-label { color: #64748b; }

  .current-stage-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 1rem 0;
  }

  .current-stage-info h4 {
    margin: 0;
    font-size: 0.95rem;
  }

  .gate-status-badge {
    font-size: 0.7rem;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    font-weight: 500;
  }

  .status-approved { background: #dcfce7; color: #166534; }
  .status-pending { background: #fef3c7; color: #92400e; }
  .status-rejected { background: #fecaca; color: #991b1b; }

  .next-stage-criteria {
    margin: 1rem 0;
    padding: 0.75rem;
    background: var(--bg-subtle, #f8fafc);
    border-radius: 0.375rem;
  }

  .next-stage-criteria h4 {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
  }

  .criteria-section h5 {
    margin: 0.5rem 0 0.25rem;
    font-size: 0.8rem;
    color: var(--text-muted, #64748b);
  }

  .criteria-section ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .criteria-item {
    padding: 0.25rem 0;
    font-size: 0.85rem;
  }

  .gate-result {
    margin: 1rem 0;
    padding: 0.75rem;
    border-radius: 0.375rem;
  }

  .gate-result.passed {
    background: #dcfce7;
    border: 1px solid #bbf7d0;
  }

  .gate-result.failed {
    background: #fef2f2;
    border: 1px solid #fecaca;
  }

  .result-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
  }

  .result-icon.pass { color: #16a34a; }
  .result-icon.fail { color: #dc2626; }

  .result-warnings, .result-blockers {
    margin-top: 0.5rem;
  }

  .result-warnings h5, .result-blockers h5 {
    margin: 0 0 0.25rem;
    font-size: 0.8rem;
  }

  .warning-item { color: #92400e; font-size: 0.85rem; }
  .blocker-item { color: #991b1b; font-size: 0.85rem; }

  .gate-actions {
    margin-top: 1rem;
  }

  .advance-btn {
    padding: 0.5rem 1rem;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 0.375rem;
    font-weight: 500;
    cursor: pointer;
  }

  .advance-btn:hover {
    background: #2563eb;
  }

  .advance-btn:disabled {
    background: #94a3b8;
    cursor: not-allowed;
  }
</style>
