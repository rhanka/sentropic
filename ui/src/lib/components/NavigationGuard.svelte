<script>
  import { unsavedChangesStore } from '$lib/stores/unsavedChanges';
  import { addToast } from '$lib/stores/toast';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { _ } from 'svelte-i18n';
  import { goto } from '$app/navigation';
  import { AlertTriangle } from '@lucide/svelte';
  
  let showWarning = false;
  let pendingNavigation = null;

  const t = (key) => get(_)(key);
  
  onMount(() => {
    // Intercepter les clics sur les liens
    const handleLinkClick = async (event) => {
      const target = event.target;
      const link = target.closest('a[href]');
      
      // Ignorer les liens de références internes (#ref-...) - ils sont gérés par EditableInput
      if (link && link.getAttribute('href')?.startsWith('#ref-')) {
        return; // Laisser EditableInput gérer ces liens
      }
      
      if (link && $unsavedChangesStore.changes.length > 0) {
        event.preventDefault();
        const href = link.getAttribute('href');
        
        // Sauvegarder automatiquement toutes les modifications
        try {
          const success = await unsavedChangesStore.saveAll();
          if (success) {
            // Navigation après sauvegarde réussie
            goto(href);
          } else {
            // En cas d'erreur, afficher le dialogue de fallback
            showWarning = true;
            pendingNavigation = () => {
              goto(href);
            };
          }
        } catch (error) {
          console.error('Failed to auto-save changes:', error);
          // En cas d'erreur, afficher le dialogue de fallback
          showWarning = true;
          pendingNavigation = () => {
            goto(href);
          };
        }
      }
    };
    
    // Note: interceptPush et interceptReplace étaient prévus pour intercepter les changements de navigation programmatiques
    // mais la navigation est gérée via handleLinkClick et handleBeforeUnload
    
    // Intercepter les clics sur les boutons de navigation
    document.addEventListener('click', handleLinkClick);
    
    // Intercepter avant fermeture de la page - sauvegarder automatiquement
    const handleBeforeUnload = async (event) => {
      if ($unsavedChangesStore.changes.length > 0) {
        // Sauvegarder automatiquement avant fermeture
        // Note: on ne peut pas faire d'appel async dans beforeunload,
        // mais on peut utiliser sendBeacon ou navigator.sendBeacon pour une sauvegarde synchrone
        // Pour l'instant, on garde l'avertissement mais on pourrait améliorer avec sendBeacon
        event.preventDefault();
        event.returnValue = t('unsavedChanges.beforeUnload');
        
        // Essayer de sauvegarder de manière synchrone si possible
        // (limitation: beforeunload ne supporte pas async/await)
        unsavedChangesStore.saveAll().catch(err => {
          console.error('Failed to save on beforeunload:', err);
        });
        
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
        message: t('unsavedChanges.toast.saved')
      });
      showWarning = false;
      if (pendingNavigation) {
        pendingNavigation();
        pendingNavigation = null;
      }
    } else {
      addToast({
        type: 'error',
        message: t('unsavedChanges.toast.saveError')
      });
    }
  };
  
  const handleDiscardAndContinue = () => {
    unsavedChangesStore.reset();
    addToast({
      type: 'warning',
      message: t('unsavedChanges.toast.discarded')
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
        <AlertTriangle class="w-6 h-6 text-yellow-500 mr-3" />
        <h3 class="text-lg font-semibold text-gray-900">
          {$_('unsavedChanges.dialog.title')}
        </h3>
      </div>
      
      <p class="text-gray-600 mb-6">
        {$_('unsavedChanges.dialog.body')}
      </p>
      
      <div class="flex justify-end gap-3">
        <button 
          on:click={handleCancel}
          class="px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 rounded"
        >
          {$_('unsavedChanges.actions.cancel')}
        </button>
        <button 
          on:click={handleDiscardAndContinue}
          class="px-4 py-2 text-red-600 hover:text-red-800 border border-red-300 rounded"
        >
          {$_('unsavedChanges.actions.discardAndContinue')}
        </button>
        <button 
          on:click={handleSaveAndContinue}
          class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          {$_('unsavedChanges.actions.saveAndContinue')}
        </button>
      </div>
    </div>
  </div>
{/if}
