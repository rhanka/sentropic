<script lang="ts">
  import { SvelteFlow, SvelteFlowProvider, Background, Controls, Panel } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import DiagramEdge from './DiagramEdge.svelte';
  import { caseOptions, eventOptions, groups, steps, selectRuns, sceneFor, layoutScene } from '../scripts/contract-diagrams.mjs';
  let { report } = $props();
  let phase = $state('before'), changeCase = $state('unknown'), event = $state('pull_request');
  let group = $state('critical-path'), step = $state(9), runId = $state(42300540682);
  let width = $state(1000), canvas: HTMLDivElement;
  let nodes = $state<any[]>([]), edges = $state<any[]>([]), selected = $state<any>(null), error = $state('');
  let runs = $derived(selectRuns(report, phase, changeCase, event));
  let run = $derived(runs.find((row: any) => row.runId === Number(runId)) ?? runs.at(-1));
  let scene = $derived(sceneFor(run, group, step));
  $effect(() => {
    const value = scene, size = width;
    let active = true;
    selected = null;
    layoutScene(value, Math.max(320, size), 'system-ui').then(result => {
      if (active) { nodes = result.nodes; edges = result.edges; error = ''; }
    }).catch(reason => { if (active) error = String(reason); });
    return () => { active = false; };
  });
</script>
<figure aria-label="Measured CI dependency graph">
  <div class="canvas" bind:this={canvas} bind:clientWidth={width} data-renderer="sentropic-diagram-canvas">
    <SvelteFlowProvider>
      <SvelteFlow {nodes} {edges} edgeTypes={{ 'ds-route': DiagramEdge }} initialViewport={{ x: 24, y: 210, zoom: 0.6 }} minZoom={0.02} maxZoom={4}
        nodesDraggable={false} nodesConnectable={false} zoomOnScroll={false} onnodeclick={({ node }) => selected = node}>
        <Background /><Controls />
        <Panel position="top-left" class="command-panel nodrag nopan">
          <div class="filters">
            <label>Evidence<select aria-label="Evidence" bind:value={phase}><option value="before">Before</option><option value="after">After</option></select></label>
            <label>Case<select aria-label="Case" bind:value={changeCase}>{#each caseOptions as option}<option value={option}>{option}</option>{/each}</select></label>
            <label>Event<select aria-label="Event" bind:value={event}>{#each eventOptions as option}<option value={option}>{option}</option>{/each}</select></label>
            <label>Groups<select aria-label="Groups" bind:value={group}>{#each groups as option}<option value={option}>{option}</option>{/each}</select></label>
            <label>Run<select aria-label="Run" bind:value={runId}>{#each runs as row}<option value={row.runId}>{row.runId}/{row.attempt} · {row.conclusion ?? row.status}</option>{/each}</select></label>
          </div>
          <div class="plan-steps" aria-label="Plan steps">{#each steps as [title], index}<button aria-pressed={step === index + 1} onclick={() => step = index + 1}>{index + 1}. {title}</button>{/each}</div>
          <p aria-live="polite">{run ? `Wall ${run.wallSeconds ?? 'to measure'}s; qualification ${run.qualificationSeconds ?? 'to measure'}s; gap ${run.gapSeconds ?? 'to measure'}s` : 'No matching measurements — to measure. Budget to measure: ≤600s.'}</p>
        </Panel>
      </SvelteFlow>
    </SvelteFlowProvider>
  </div>
  <figcaption>Measured matrix nodes show the maximum member, never their sum. Node colors: ≤15s, 16–60s, 61–180s, &gt;180s; hatching means to measure. Plan highlights describe affected work; isolated gains are never added.</figcaption>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if selected}
    <aside aria-label="Selected job detail">
      <h2>{selected.id}</h2><p>Optimization: {selected.data.optimization}. <a href="../acceptance.md">Acceptance evidence</a></p>
      {#each selected.data.members as job}
        <details><summary>{job.name} · {job.seconds ?? 'to measure'}s execution · {job.queueSeconds ?? 'to measure'}s queue</summary>
          <a href={job.url}>Run {job.runId}, attempt {job.attempt}, job {job.jobId}</a>
          <ol>{#each job.steps as entry}<li>{entry.name}: {entry.seconds ?? 'to measure'}s · {entry.conclusion ?? 'pending'}</li>{/each}</ol>
        </details>
      {/each}
    </aside>
  {/if}
</figure>
