<script lang="ts">
  import { ThemeProvider } from '@sentropic/design-system-svelte';
  import { entropicTheme } from '@sentropic/design-system-themes';
  import evidence from '../node_modules/.ci-report.json';
  import ArchitectureCanvas from './ArchitectureCanvas.svelte';
  import ContractDossier from './ContractDossier.svelte';
</script>
<ThemeProvider theme={entropicTheme}>
  <main>
    <h1>Ten-minute CI/CD — measured evidence</h1>
    <p>Acceptance: <strong>{evidence.accepted ? 'PASS' : 'OPEN'}</strong>. Complete wall time includes admission, queue, execution and cleanup. Budgets remain to measure.</p>
    <ArchitectureCanvas report={evidence} />
    <ContractDossier report={evidence} />
  </main>
</ThemeProvider>
