<script>
  import { unsavedChangesStore } from '$lib/stores/unsavedChanges';
  import { addToast } from '$lib/stores/toast';
  import { onMount } from 'svelte';
  import { goto, pushState, replaceState } from '$app/navigation';
  
  let showWarning = false;
  let pendingNavigation = null;
  
  onMount(() => {
    // Intercepter les clics sur les liens
    const handleLinkClick = (event) => {
      const target = event.target;
      const link = target.closest('a[href]');
      
      if (link && $unsavedChangesStore.changes.length > 0) {
        event.preventDefault();
        showWarning = true;
        pendingNavigation = () => {
          goto(link.getAttribute('href'));
        };
      }
    };
    
    // Intercepter les changements d'URL programmatiques
    const originalPushState = pushState;
    const originalReplaceState = replaceState;
    
    const interceptPush = (...args) => {
      if ($unsavedChangesStore.changes.length > 0) {
        showWarning = true;
        pendingNavigation = () => {
          originalPushState(...args);
        };
        return;
      }
      originalPushState(...args);
    };
    
    const interceptReplace = (...args) => {
      if ($unsavedChangesStore.changes.length > 0) {
        showWarning = true;
        pendingNavigation = () => {
          originalReplaceState(...args);
        };
        return;
      }
      originalReplaceState(...args);
    };
    
    // Intercepter les clics sur les boutons de navigation
    document.addEventListener('click', handleLinkClick);
    
    // Intercepter avant fermeture de la page
    const handleBeforeUnload = (event) => {
      if ($unsavedChangesStore.changes.length > 0) {
        event.preventDefault();
        event.returnValue = 'Vous avez des modifications non sauvegardées. Êtes-vous sûr de vouloir quitter ?';
        return event.returnValue;
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      document.removeEventListener('click', handleLinkClick);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  });
  
  const handleSaveAndContinue = async () => {
    const success = await unsavedChangesStore.saveAll();
    if (success) {
      addToast({
        type: 'success',
        message: 'Toutes les modifications ont été sauvegardées'
      });
      showWarning = false;
      if (pendingNavigation) {
        pendingNavigation();
        pendingNavigation = null;
      }
    } else {
      addToast({
        type: 'error',
        message: 'Erreur lors de la sauvegarde des modifications'
      });
    }
  };
  
  const handleDiscardAndContinue = () => {
    unsavedChangesStore.reset();
    addToast({
      type: 'warning',
      message: 'Modifications non sauvegardées supprimées'
    });
    showWarning = false;
    if (pendingNavigation) {
      pendingNavigation();
      pendingNavigation = null;
    }
  };
  
  const handleCancel = () => {
    showWarning = false;
    pendingNavigation = null;
  };
</script>

{#if showWarning}
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg max-w-md w-full mx-4 p-6">
      <div class="flex items-center mb-4">
        <svg class="w-6 h-6 text-yellow-500 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
        </svg>
        <h3 class="text-lg font-semibold text-gray-900">
          Modifications non sauvegardées
        </h3>
      </div>
      
      <p class="text-gray-600 mb-6">
        Vous avez des modifications non sauvegardées. Que souhaitez-vous faire ?
      </p>
      
      <div class="flex justify-end gap-3">
        <button 
          on:click={handleCancel}
          class="px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 rounded"
        >
          Annuler
        </button>
        <button 
          on:click={handleDiscardAndContinue}
          class="px-4 py-2 text-red-600 hover:text-red-800 border border-red-300 rounded"
        >
          Ignorer et continuer
        </button>
        <button 
          on:click={handleSaveAndContinue}
          class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Sauvegarder et continuer
        </button>
      </div>
    </div>
  </div>
{/if}
