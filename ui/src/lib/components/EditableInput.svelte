<script>
  import { onMount, createEventDispatcher } from "svelte";
  import { unsavedChangesStore } from "$lib/stores/unsavedChanges";
  import TipTap from "./TipTap.svelte";
  
  export let label = ""; // Le label affiché au-dessus
  export let value = ""; // La valeur de l'input
  export let markdown = false;
  export let apiEndpoint = ""; // Endpoint API pour la sauvegarde
  export let saveDelay = 5000; // Délai en ms avant sauvegarde (défaut: 5s)
  export let disabled = false;
  export let changeId = ""; // ID unique pour cette modification
  export let fullData = null; // Données complètes à envoyer (optionnel)
  export let originalValue = ""; // Valeur originale pour comparaison
  
  const dispatch = createEventDispatcher();
  
  let isEditing = false;
  let hasUnsavedChanges = false;
  let saveTimeout = null;
  let isSaving = false;
  
  // Référence pour le span et l'input
  let span;
  let input;
  
  // Basculer entre le mode édition et le mode affichage
  const toggleEditing = () => {
    if (disabled) return;
    isEditing = !isEditing;
  };
  
  // Fonction pour ajuster la largeur de l'input
  const adjustWidth = () => {
    if (!markdown && span && input) {
      span.textContent = value || " "; // Mise à jour du contenu du span
      input.style.width = `${span.offsetWidth + 4}px`; // Appliquer la largeur au champ input
    }
  };
  
  // Fonction de sauvegarde avec buffer
  const saveWithBuffer = async () => {
    if (!apiEndpoint || !hasUnsavedChanges || isSaving) return;
    
    // Annuler le timeout précédent s'il existe
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    
    // Programmer la sauvegarde
    saveTimeout = setTimeout(async () => {
      await performSave();
    }, saveDelay);
  };
  
  // Effectuer la sauvegarde réelle
  const performSave = async () => {
    if (!apiEndpoint || !hasUnsavedChanges || isSaving) return;
    
    isSaving = true;
    try {
      const response = await fetch(apiEndpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(fullData || { value })
      });
      
      if (response.ok) {
        hasUnsavedChanges = false;
        // Supprimer du store des modifications non sauvegardées
        if (changeId) {
          unsavedChangesStore.removeChange(changeId);
        }
        dispatch('saved', { value });
      } else {
        throw new Error(`Failed to save: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to save:', error);
      dispatch('saveError', { error, value });
    } finally {
      isSaving = false;
    }
  };
  
  // Gérer les changements de valeur
  const handleInput = (event) => {
    const newValue = event.target.value;
    value = newValue;
    
    // Ne marquer comme modifié que si la valeur a vraiment changé
    hasUnsavedChanges = newValue !== originalValue;
    adjustWidth();
    
    // Ajouter au store des modifications non sauvegardées seulement si nécessaire
    if (changeId && apiEndpoint && hasUnsavedChanges) {
      unsavedChangesStore.addChange({
        id: changeId,
        component: 'EditableInput',
        value: value,
        saveFunction: performSave
      });
    } else if (changeId && !hasUnsavedChanges) {
      // Supprimer du store si pas de modifications
      unsavedChangesStore.removeChange(changeId);
    }
    
    if (hasUnsavedChanges) {
      saveWithBuffer();
    }
    dispatch('change', { value });
  };
  
  // Sauvegarder immédiatement si nécessaire (avant navigation)
  const saveImmediately = async () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    if (hasUnsavedChanges) {
      await performSave();
    }
  };
  
  onMount(() => {
    adjustWidth();
    
    // Initialiser originalValue si pas défini
    if (!originalValue && value) {
      originalValue = value;
    }
    
    // Exposer la fonction de sauvegarde immédiate
    window.addEventListener('beforeunload', saveImmediately);
    
    return () => {
      window.removeEventListener('beforeunload', saveImmediately);
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
    };
  });
  
  // Surveillez les changements de `value`
  $: if (value) {
    adjustWidth();
    // Mettre à jour originalValue si la valeur change de l'extérieur
    if (!originalValue) {
      originalValue = value;
    }
  } else if (markdown) {
    value = "Please provide description";
  }
  
  // Exposer la fonction pour les composants parents
  export { saveImmediately, hasUnsavedChanges };
</script>

<div class="editable-container" style={markdown ? "width: 100%!important" : ""}>
  <label>{label}</label>
  {#if !markdown}
    <div class="input-wrapper">
      <span class="size-measure" bind:this={span}></span>
      {#if new RegExp(/\[.*\]/).test(value)}
        <mark>
          <input
            type="text"
            bind:value
            bind:this={input}
            class="editable-input"
            class:has-unsaved-changes={hasUnsavedChanges}
            class:is-saving={isSaving}
            disabled={disabled}
            on:input={handleInput}
            on:blur={toggleEditing}
          />
        </mark>
      {:else}
        <input
          type="text"
          bind:value
          bind:this={input}
          class="editable-input"
          class:has-unsaved-changes={hasUnsavedChanges}
          class:is-saving={isSaving}
          disabled={disabled}
          on:input={handleInput}
          on:blur={toggleEditing}
        />
      {/if}
      {#if hasUnsavedChanges}
        <span class="unsaved-indicator" title="Modifications non sauvegardées">●</span>
      {/if}
      {#if isSaving}
        <span class="saving-indicator" title="Sauvegarde en cours...">⟳</span>
      {/if}
    </div>
  {:else}
    <div class="markdown-wrapper">
      <TipTap bind:value={value}/>
    </div>
  {/if}
</div>

<style global>
  .editable-container {
    display: inline-flex;
    flex-direction: column;
    margin-right: 0;
    vertical-align: bottom;
  }

  label {
    display: block;
    font-size: 0.5rem;
    font-weight: 100;
    color: #555;
    margin-bottom: 0rem;
  }

  .input-wrapper {
    position: relative;
    display: inline-block;
  }

  .markdown-wrapper {
    width: 100%;
    padding-left: 1rem;
  }

  :global(.markdown-wrapper > :first-child) {
    margin-top: 0.25rem !important;
  }

  :global(.markdown-wrapper > :last-child) {
    margin-bottom: 0.25rem !important;
  }
  :global(.markdown-wrapper > ul) {
    margin-left: -1rem !important;
  }
  textarea {
    border: 1px;
    margin-left: 1rem;
  }

  textarea:focus {
    border: 1px solid #ccc;
    outline: none;
  }

  .size-measure {
    font-size: inherit;
    font-weight: inherit;
    font-family: inherit;
    letter-spacing: inherit;
    white-space: pre;
    visibility: hidden;
    position: absolute;
    pointer-events: none;
  }

  .editable-input {
    border: none;
    border-bottom: 1px solid transparent;
    outline: none;
    font-size: inherit;
    color: inherit;
    font-weight: inherit;
    line-height: inherit;
    vertical-align: baseline;
    padding: 0;
    background: none;
    transition:
      border-color 0.3s,
      background-color 0.3s;
    color: inherit;
    cursor: text;
  }

  .editable-input:hover {
    border-bottom: 1px solid #ced4da;
  }

  .editable-input:focus {
    border-bottom: 1px solid #495057;
    background-color: #f8f9fa;
  }

  .editable-input.has-unsaved-changes {
    border-bottom: 1px solid #ffc107;
  }

  .editable-input.is-saving {
    border-bottom: 1px solid #007bff;
  }

  .editable-input:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .editable-input::placeholder {
    color: #ced4da;
  }

  .unsaved-indicator {
    position: absolute;
    right: -15px;
    top: 50%;
    transform: translateY(-50%);
    color: #ffc107;
    font-size: 12px;
    font-weight: bold;
  }

  .saving-indicator {
    position: absolute;
    right: -15px;
    top: 50%;
    transform: translateY(-50%);
    color: #007bff;
    font-size: 12px;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: translateY(-50%) rotate(0deg); }
    to { transform: translateY(-50%) rotate(360deg); }
  }
</style>
