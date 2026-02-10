<script lang="ts">
  import { _ } from 'svelte-i18n';
  export let error: Error | undefined;
</script>

<section class="space-y-4 text-center">
  <h1 class="text-4xl font-bold">{$_('errors.notFoundTitle')}</h1>
  <p class="text-slate-600">{error?.message ?? $_('errors.notFoundMessage')}</p>
  <a class="text-primary" href="/">{$_('errors.backHome')}</a>
</section>
