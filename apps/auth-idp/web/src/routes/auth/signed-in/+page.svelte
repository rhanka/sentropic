<script lang="ts">
  import { locale } from '$lib/locale';

  // Terminal screen when login/register succeeds WITHOUT an OAuth continuation
  // (i.e. the user landed on the IdP directly, not via an RP authorize redirect).
  // In a real RP flow the user never sees this — they are redirected back to the
  // relying party with an authorization code.
  let message = $derived(
    ($locale ?? 'fr').startsWith('fr')
      ? 'Vous êtes connecté à Sentropic ID.'
      : 'You are signed in to Sentropic ID.',
  );
</script>

<div class="flex items-center justify-center px-4 pb-16 pt-10">
  <div class="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
    <p class="text-slate-700">{message}</p>
  </div>
</div>
