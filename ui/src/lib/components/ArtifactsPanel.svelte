<script lang="ts">
  export let artifactUrl: string;
  export let title: string = 'Artifact';
  export let height: number = 640;
  const isHttps = (value: string): boolean => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  };
  $: safeUrl = isHttps(artifactUrl) ? artifactUrl : '';
</script>

{#if safeUrl}
  <iframe
    src={safeUrl}
    title={title}
    width="100%"
    height={height}
    sandbox="allow-scripts allow-same-origin"
    referrerpolicy="no-referrer"
    loading="lazy"
  ></iframe>
{:else}
  <p>Artifact URL refused: https origin required.</p>
{/if}
