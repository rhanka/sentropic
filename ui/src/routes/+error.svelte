<script lang="ts">
  export let error: Error;
</script>

<section class="space-y-4 text-center">
  <h1 class="text-4xl font-bold">Page non trouvée</h1>
  <p class="text-slate-600">{error.message ?? "La page demandée n'existe pas."}</p>
  <a class="text-primary" href="/">Retour à l'accueil</a>
</section>
