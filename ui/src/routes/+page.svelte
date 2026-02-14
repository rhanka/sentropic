<script lang="ts">
  import { _ } from 'svelte-i18n';
</script>

<section class="space-y-6">
  <h1 class="text-4xl font-bold text-slate-900">{$_('home.welcomeTitle')}</h1>
  <p class="max-w-2xl text-lg text-slate-600">
    {$_('home.tagline')}
  </p>
  <a
    class="inline-flex items-center rounded bg-primary px-4 py-2 text-white shadow hover:opacity-90"
    href="/home"
    >{$_('home.getStarted')}</a
  >
</section>
