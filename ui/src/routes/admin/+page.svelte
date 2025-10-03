<script lang="ts">
  import { addToast } from '$lib/stores/toast';
  import { goto } from '$app/navigation';

  let isResetting = false;

  const resetAllData = async () => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer TOUTES les données ? Cette action est irréversible.')) {
      return;
    }

    isResetting = true;
    try {
      const response = await fetch('http://localhost:8787/api/v1/admin/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to reset data');
      }

      addToast({
        type: 'success',
        message: 'Toutes les données ont été supprimées avec succès !'
      });

      // Rediriger vers la page d'accueil
      goto('/');
    } catch (error) {
      console.error('Failed to reset data:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors de la suppression des données'
      });
    } finally {
      isResetting = false;
    }
  };
</script>

<section class="space-y-6">
  <h1 class="text-3xl font-semibold">Administration</h1>
  
  <div class="rounded border border-red-200 bg-red-50 p-6">
    <h2 class="text-lg font-semibold text-red-800 mb-4">Zone de danger</h2>
    <p class="text-red-700 mb-4">
      Cette section permet de réinitialiser complètement l'application. 
      Toutes les données (entreprises, dossiers, cas d'usage) seront définitivement supprimées.
    </p>
    
    <button 
      class="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
      on:click={resetAllData}
      disabled={isResetting}
    >
      {isResetting ? 'Suppression en cours...' : 'Supprimer toutes les données'}
    </button>
  </div>

  <div class="rounded border border-blue-200 bg-blue-50 p-6">
    <h2 class="text-lg font-semibold text-blue-800 mb-4">Informations système</h2>
    <div class="space-y-2 text-sm text-blue-700">
      <p><strong>Version:</strong> 1.0.0</p>
      <p><strong>Base de données:</strong> SQLite</p>
      <p><strong>API:</strong> Hono + Drizzle ORM</p>
      <p><strong>Frontend:</strong> SvelteKit + Tailwind CSS</p>
    </div>
  </div>
</section>

