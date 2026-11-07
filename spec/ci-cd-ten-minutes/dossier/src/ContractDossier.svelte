<script lang="ts">
  let { report } = $props();
  const format = (value: number | null) => value === null ? 'to measure' : `${value}s`;
</script>
<section aria-label="Acceptance evidence">
  <h2>Complete workflow evidence</h2>
  <p>{report.count} retained attempts, {report.successful} complete successful attempts, {report.fullProduct}/30 qualified after full-product samples. Runner minutes: {report.runnerMinutes.toFixed(2)}; provider cost: to measure.</p>
  <table><thead><tr><th>Phase</th><th>n</th><th>Median</th><th>p90</th><th>p95</th><th>Maximum</th></tr></thead><tbody>
    {#each ['before', 'after'] as phase (phase)}<tr><th>{phase}</th><td>{report[phase].n}</td><td>{format(report[phase].median)}</td><td>{format(report[phase].p90)}</td><td>{format(report[phase].p95)}</td><td>{format(report[phase].maximum)}</td></tr>{/each}
  </tbody></table>
  <details open><summary>Missing acceptance evidence</summary><ul>{#each report.missing as item (item)}<li>{item}</li>{/each}</ul></details>
  <details><summary>Every run, including failures, cancellations and incomplete runs</summary>
    <table><thead><tr><th>Run</th><th>Event</th><th>Result</th><th>Wall</th><th>Gap</th></tr></thead><tbody>
      {#each report.runs as run (`${run.runId}/${run.attempt}`)}<tr><td><a href={run.url}>{run.runId}/{run.attempt}</a></td><td>{run.event}</td><td>{run.conclusion ?? run.status}</td><td>{format(run.wallSeconds)}</td><td>{format(run.gapSeconds)}</td></tr>{/each}
    </tbody></table>
  </details>
  <details><summary>Reproducibility and provenance</summary><p>Input SHA-256: {report.inputSha256}</p><p>Retained generator source SHA-256: {report.diagramSourceSha256}</p><p>Generator: retained focus-ci-efficiency-kit, private diagram-core/diagram-canvas source archive; MIT package metadata retained. Budgets: spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md. No hypothetical replay counts as measured work.</p></details>
</section>
