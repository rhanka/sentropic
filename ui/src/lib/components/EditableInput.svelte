<script>
  import { onMount, afterUpdate, createEventDispatcher, tick } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { unsavedChangesStore } from "$lib/stores/unsavedChanges";
  import TipTap from "./TipTap.svelte";
  import { apiPut } from "$lib/utils/api";
  
  export let label = ""; // Le label affiché au-dessus
  export let value = ""; // La valeur de l'input
  export let markdown = false;
  export let apiEndpoint = ""; // Endpoint API pour la sauvegarde
  export let saveDelay = 5000; // Délai en ms avant sauvegarde (défaut: 5s)
  export let disabled = false;
  export let changeId = ""; // ID unique pour cette modification
  /** @type {any} */
  export let fullData = null; // Données complètes à envoyer (optionnel)
  export let fullDataGetter = null; // Fonction pour récupérer les données complètes au moment de la sauvegarde
  export let originalValue = ""; // Valeur originale pour comparaison
  export let references = []; // Références pour post-traitement des citations [1], [2]
  
  // Générer un ID unique pour associer le label au contrôle
  const inputId = `editable-input-${Math.random().toString(36).substr(2, 9)}`;
  export let forceList = false;
  export let multiline = false; // Si true, utilise un textarea au lieu d'un input (pour permettre les retours à la ligne)
  
  let tiptapContainer;
  
  const dispatch = createEventDispatcher();
  
  let isEditing = false;
  let hasUnsavedChanges = false;
  let saveTimeout = null;
  let isSaving = false;
  
  // Référence pour le span, l'input et le textarea
  let span;
  let input;
  let textarea;
  
  // Basculer entre le mode édition et le mode affichage
  const toggleEditing = () => {
    if (disabled) return;
    isEditing = !isEditing;
  };
  
  // Fonction pour ajuster la largeur de l'input
  const adjustWidth = () => {
    if (!markdown && !multiline && span && input) {
      span.textContent = value || " "; // Mise à jour du contenu du span
      const measuredWidth = span.offsetWidth + 4;
      const maxWidth = input.parentElement?.offsetWidth || Infinity;
      // Limiter la largeur à la largeur du conteneur parent ou 48rem (max-w-3xl)
      const finalWidth = Math.min(measuredWidth, maxWidth, 48 * 16); // 48rem = 768px
      input.style.width = `${finalWidth}px`;
      input.style.maxWidth = '100%';
    } else if (!markdown && multiline && textarea) {
      // Pour textarea, ajuster la hauteur automatiquement
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
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
      // Extract endpoint path from full URL if needed
      // apiEndpoint can be either "/companies/123" or "http://.../companies/123"
      // apiPut handles both cases
      let payload = fullData || { value };
      if (typeof fullDataGetter === 'function') {
        const computed = fullDataGetter();
        if (computed) {
          payload = computed;
        }
      }
      await apiPut(apiEndpoint, payload);
      
      // Success - response is OK by default (apiPut throws on error)
      hasUnsavedChanges = false;
      // Supprimer du store des modifications non sauvegardées
      if (changeId) {
        unsavedChangesStore.removeChange(changeId);
      }
      dispatch('saved', { value });
    } catch (error) {
      console.error('Failed to save:', error);
      dispatch('saveError', { error, value });
    } finally {
      isSaving = false;
    }
  };
  
  // Gérer les changements de valeur (pour les inputs HTML)
  const handleInput = (event) => {
    const newValue = event.target.value;
    value = newValue;
    
    // Ne marquer comme modifié que si la valeur a vraiment changé
    hasUnsavedChanges = newValue !== originalValue;
    
    // Ajuster la largeur/hauteur après le changement
    tick().then(() => {
      adjustWidth();
    });
    
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

  // Gérer les changements de valeur (pour TipTap)
  const handleTipTapChange = (event) => {
    const newValue = event.detail.value;
    value = newValue;
    
    // Mettre à jour hasUnsavedChanges immédiatement pour un feedback visuel instantané
    const isUnsaved = newValue !== originalValue;
    hasUnsavedChanges = isUnsaved;
    
    // Ajouter au store des modifications non sauvegardées seulement si nécessaire
    if (changeId && apiEndpoint && isUnsaved) {
      unsavedChangesStore.addChange({
        id: changeId,
        component: 'EditableInput',
        value: value,
        saveFunction: performSave
      });
    } else if (changeId && !isUnsaved) {
      // Supprimer du store si pas de modifications
      unsavedChangesStore.removeChange(changeId);
    }
    
    if (isUnsaved) {
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
  
  // Handler direct attaché sur chaque lien pour garantir l'interception
  // IMPORTANT: Utiliser une fonction nommée pour pouvoir la supprimer plus tard si nécessaire
  const handleReferenceClickDirect = async (e) => {
    // Empêcher IMMÉDIATEMENT tout comportement par défaut - AVANT TOUT AUTRE HANDLER
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    e.cancelBubble = true; // Pour IE/anciens navigateurs
    
    const link = e.currentTarget || e.target;
    if (!link || link.tagName !== 'A') return false;
    
    const href = link.getAttribute('href');
    if (!href || !href.startsWith('#ref-')) return false;
    
    const refId = href.substring(1);
    const targetElement = document.getElementById(refId);
    if (!targetElement) return false;
    
    // Utiliser goto de SvelteKit pour mettre à jour l'URL
    const currentUrl = $page.url;
    const newUrl = `${currentUrl.pathname}${currentUrl.search}#${refId}`;
    
    try {
      await goto(newUrl, {
        noScroll: true,
        keepFocus: true,
        invalidateAll: false,
        replaceState: false,
      });
      
      // Scroll vers la référence après un petit délai
      setTimeout(() => {
        targetElement.scrollIntoView({behavior: 'smooth', block: 'center'});
      }, 10);
    } catch (error) {
      // Fallback: scroll simple + update URL manuel
      targetElement.scrollIntoView({behavior: 'smooth', block: 'center'});
      window.history.pushState(null, '', `#${refId}`);
    }
    
    return false;
  };

  // Gérer les clics sur les liens de références avec délégation d'événements
  const handleReferenceClick = async (e) => {
    // Vérifier si le clic est sur un lien de référence (#ref-...)
    // Vérifier aussi si c'est un texte à l'intérieur d'un lien
    let link = e.target.closest('a[href^="#ref-"]');
    if (!link && e.target.tagName === 'A' && e.target.getAttribute('href')?.startsWith('#ref-')) {
      link = e.target;
    }
    if (!link) return;
    
    // Empêcher TOUT comportement par défaut (navigation, ouverture nouvel onglet, etc.)
    // IMPORTANT: appeler preventDefault() en premier, avant toute autre opération
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    // Empêcher aussi le comportement par défaut sur le link lui-même
    if (link.onclick) {
      link.onclick = null; // Supprimer tout onclick existant
    }
    
    // Extraire le refId du href (format: #ref-1)
    const href = link.getAttribute('href');
    if (!href || !href.startsWith('#ref-')) return;
    
    const refId = href.substring(1); // Retirer le # pour obtenir ref-1
    
    // Vérifier que l'élément cible existe
    const targetElement = document.getElementById(refId);
    if (!targetElement) return;
    
    // Utiliser goto de SvelteKit pour mettre à jour l'URL avec le hash
    // Cela ajoute le #ref-X à l'URL sans recharger la page
    // Utiliser $page.url pour obtenir le path et search params actuels
    const currentUrl = $page.url;
    const newUrl = `${currentUrl.pathname}${currentUrl.search}#${refId}`;
    
    try {
      await goto(newUrl, {
        noScroll: true, // On gère le scroll manuellement
        keepFocus: true, // Garder le focus sur l'élément actuel
        invalidateAll: false, // Ne pas recharger les données
        replaceState: false, // Garder dans l'historique pour pouvoir faire back
      });
      
      // Scroll vers la référence après un petit délai pour s'assurer que la navigation est terminée
      setTimeout(() => {
        targetElement.scrollIntoView({behavior: 'smooth', block: 'center'});
      }, 10);
    } catch (error) {
      // En cas d'erreur avec goto, fallback sur scroll simple
      console.warn('Failed to navigate with goto, using direct scroll:', error);
      targetElement.scrollIntoView({behavior: 'smooth', block: 'center'});
      // Mettre à jour l'URL manuellement en dernier recours
      window.history.pushState(null, '', `#${refId}`);
    }
    
    return false;
  };

  // Ajouter/retirer le listener de délégation d'événements pour les références
  const setupReferenceClickListener = () => {
    if (markdown && tiptapContainer) {
      // Vérifier si le listener n'est pas déjà ajouté
      if (!tiptapContainer.__referenceListenerAdded) {
        tiptapContainer.addEventListener('click', handleReferenceClick, true);
        tiptapContainer.__referenceListenerAdded = true;
      }
    }
  };

  const removeReferenceClickListener = () => {
    if (tiptapContainer && tiptapContainer.__referenceListenerAdded) {
      tiptapContainer.removeEventListener('click', handleReferenceClick, true);
      tiptapContainer.__referenceListenerAdded = false;
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
      // Nettoyer le listener des références
      removeReferenceClickListener();
    };
  });

  afterUpdate(() => {
    // Ajuster la hauteur du textarea après chaque mise à jour
    if (!markdown && multiline && textarea) {
      adjustWidth();
    }
  });
  
  // Fonction pour créer un lien de référence
  // Note: Le gestionnaire de clic est géré par délégation d'événements (handleReferenceClick)
  // On garde juste la création du lien avec les bons attributs
  const createReferenceLink = (num, ref) => {
    const refId = `ref-${num}`;
    const link = document.createElement('a');
    link.href = `#${refId}`;
    link.target = '_self'; // Forcer l'ouverture dans le même onglet
    link.setAttribute('data-ref-num', num);
    // Forcer les classes CSS et les styles inline pour garantir le style bleu
    link.className = 'reference-link text-blue-600 hover:text-blue-800 hover:underline cursor-pointer';
    link.style.color = '#2563eb'; // text-blue-600 en couleur explicite
    link.style.textDecoration = 'none';
    link.title = ref.title || '';
    link.textContent = `[${num}]`;
    
    // Ne pas ajouter onclick ici - on utilise addEventListener pour un meilleur contrôle
    // Le handler sera attaché après l'insertion dans le DOM
    
    return link;
  };

  // Post-traiter le DOM TipTap pour transformer les références [1], [2] en liens cliquables
  const processReferencesInTipTap = () => {
    if (!markdown || !tiptapContainer || !references || references.length === 0) return;
    
    // Trouver l'élément ProseMirror à l'intérieur du container
    const proseMirror = tiptapContainer.querySelector('.ProseMirror, .tiptap');
    if (!proseMirror) return;
    
    // Vérifier les liens existants - réappliquer les classes si nécessaire
    const existingLinks = proseMirror.querySelectorAll('a[href^="#ref-"]');
    
    // Si des liens existent déjà, réappliquer les classes, styles et gestionnaires
    if (existingLinks.length > 0) {
      existingLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href && href.startsWith('#ref-')) {
          // Extraire le numéro de référence
          const refNum = href.match(/ref-(\d+)/)?.[1];
          
          // Réappliquer les classes et styles
          link.className = 'reference-link text-blue-600 hover:text-blue-800 hover:underline cursor-pointer';
          link.style.color = '#2563eb'; // text-blue-600
          link.style.textDecoration = 'none';
          link.target = '_self';
          
          // S'assurer que data-ref-num est défini
          if (refNum) {
            link.setAttribute('data-ref-num', refNum);
          }
          
          // Supprimer tous les listeners existants en clonant le nœud
          const newLink = link.cloneNode(true);
          link.parentNode?.replaceChild(newLink, link);
          
          // Attacher directement le handler sur le lien récréé
          // Utiliser capture: true pour intercepter AVANT NavigationGuard
          // Utiliser once: false pour permettre plusieurs clics
          newLink.addEventListener('click', handleReferenceClickDirect, { 
            capture: true, 
            once: false,
            passive: false // Important pour pouvoir preventDefault
          });
          
          // Supprimer tout onclick existant
          newLink.onclick = null;
          
          // Empêcher aussi le comportement via onmousedown (plus tôt dans la chaîne)
          newLink.onmousedown = () => {
            // Ne pas empêcher complètement, juste marquer le lien
            newLink.__referenceLink = true;
          };
        }
      });
      return; // Les liens sont déjà là, on a juste mis à jour les classes/styles
    }
    
    // Utiliser Range API pour remplacer le texte par des liens
    const walker = document.createTreeWalker(
      proseMirror,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Ignorer les text nodes dans les liens existants
          if (node.parentElement && node.parentElement.tagName === 'A') {
            return NodeFilter.FILTER_REJECT;
          }
          return node.textContent && node.textContent.match(/\[\d+\]/) 
            ? NodeFilter.FILTER_ACCEPT 
            : NodeFilter.FILTER_REJECT;
        }
      }
    );
    
    const textNodesToProcess = [];
    let node;
    while ((node = walker.nextNode())) {
      textNodesToProcess.push(node);
    }
    
    // Traiter chaque text node
    textNodesToProcess.forEach(textNode => {
      const text = textNode.textContent || '';
      const regex = /\[(\d+)\]/g;
      const matches = [];
      let match;
      
      while ((match = regex.exec(text)) !== null) {
        matches.push({
          index: match.index,
          num: match[1],
          length: match[0].length
        });
      }
      
      if (matches.length === 0) return;
      
      // Créer un fragment avec les remplacements
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      
      matches.forEach(({ index, num, length }) => {
        // Ajouter le texte avant le match
        if (index > lastIndex) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex, index)));
        }
        
          // Créer le lien si la référence existe
          const refIndex = parseInt(num) - 1;
          if (refIndex >= 0 && refIndex < references.length) {
            const link = createReferenceLink(num, references[refIndex]);
            link.setAttribute('data-ref-num', num);
            
            // Attacher directement le handler sur le lien pour garantir l'interception
            link.addEventListener('click', handleReferenceClickDirect, { capture: true, once: false });
            
            fragment.appendChild(link);
          } else {
            // Garder le texte original
            fragment.appendChild(document.createTextNode(text.slice(index, index + length)));
          }
        
        lastIndex = index + length;
      });
      
      // Ajouter le texte restant
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      
      // Remplacer le text node
      if (textNode.parentNode) {
        textNode.parentNode.replaceChild(fragment, textNode);
      }
    });
  };

  // Post-traiter après chaque update si markdown et références disponibles
  afterUpdate(() => {
    if (markdown && references && references.length > 0 && tiptapContainer) {
      tick().then(() => {
        processReferencesInTipTap();
        // S'assurer que le listener de délégation est actif après chaque update
        setupReferenceClickListener();
      });
    }
  });
  
  // Réagir aux changements de tiptapContainer (bind:this)
  $: if (markdown && tiptapContainer) {
    tick().then(() => {
      setupReferenceClickListener();
      if (references && references.length > 0) {
        processReferencesInTipTap();
      }
    });
  }
  
  // Réagir aux changements de value pour retraiter les références
  $: if (markdown && value && references && references.length > 0 && tiptapContainer) {
    tick().then(() => {
      // Attendre un peu plus longtemps pour que TipTap ait fini de mettre à jour le DOM
      setTimeout(() => {
        processReferencesInTipTap();
        setupReferenceClickListener();
      }, 100);
    });
  }
  
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

<div class="editable-container" style={markdown ? "width: 100%!important" : ""} class:full-width={multiline && !markdown}>
  {#if label}
    <label for={inputId}>{label}</label>
  {/if}
  {#if !markdown}
    <div class="input-wrapper" class:full-width={multiline}>
      {#if multiline}
        <textarea
          id={inputId}
          bind:value
          bind:this={textarea}
          class="editable-textarea"
          class:has-unsaved-changes={hasUnsavedChanges}
          class:is-saving={isSaving}
          disabled={disabled}
          rows="1"
          aria-label={label || undefined}
          on:input={handleInput}
          on:blur={toggleEditing}
        ></textarea>
      {:else}
        <span class="size-measure" bind:this={span}></span>
        {#if new RegExp(/\[.*\]/).test(value)}
          <mark>
            <input
              id={inputId}
              type="text"
              bind:value
              bind:this={input}
              class="editable-input"
              class:has-unsaved-changes={hasUnsavedChanges}
              class:is-saving={isSaving}
              disabled={disabled}
              aria-label={label || undefined}
              on:input={handleInput}
              on:blur={toggleEditing}
            />
          </mark>
        {:else}
          <input
            id={inputId}
            type="text"
            bind:value
            bind:this={input}
            class="editable-input"
            class:has-unsaved-changes={hasUnsavedChanges}
            class:is-saving={isSaving}
            disabled={disabled}
            aria-label={label || undefined}
            on:input={handleInput}
            on:blur={toggleEditing}
          />
        {/if}
      {/if}
      {#if hasUnsavedChanges}
        <span class="unsaved-indicator" title="Modifications non sauvegardées">●</span>
      {/if}
      {#if isSaving}
        <span class="saving-indicator" title="Sauvegarde en cours...">⟳</span>
      {/if}
    </div>
  {:else}
    <div class="markdown-input-wrapper" class:has-unsaved-changes={hasUnsavedChanges} role="textbox" aria-label={label || undefined}>
      <div class="prose prose-slate max-w-none markdown-wrapper" bind:this={tiptapContainer}>
        <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
          <TipTap bind:value={value} on:change={handleTipTapChange} forceList={forceList}/>
        </div>
      </div>
      {#if isSaving}
        <span class="saving-indicator-markdown" title="Sauvegarde en cours...">⟳</span>
      {/if}
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

  .editable-container.full-width {
    display: flex;
    width: 100%;
    margin-bottom: 0;
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
    max-width: 100%;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  .input-wrapper.full-width {
    display: block;
    width: 100%;
  }

  .markdown-wrapper {
    width: 100%;
    /* Supprimé: padding-left: 1rem (simplification) */
    /* Les listes ont maintenant padding-left: 1.5rem via classes Tailwind */
  }

  /* Supprimé: marges réduites et compensations */
  /* Maintenant géré par les classes Tailwind et prose */
  
  /* Styles globaux pour les liens de références dans TipTap */
  :global(.markdown-wrapper a[href^="#ref-"]) {
    color: #2563eb !important; /* text-blue-600 */
    text-decoration: none !important;
  }
  
  :global(.markdown-wrapper a[href^="#ref-"]:hover) {
    color: #1e40af !important; /* text-blue-800 */
    text-decoration: underline !important;
  }
  
  :global(.markdown-wrapper a[href^="#ref-"].reference-link) {
    color: #2563eb !important;
    cursor: pointer !important;
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
    max-width: 100%;
    word-wrap: break-word;
    overflow-wrap: break-word;
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
  }

  /* Styles pour les textareas */
  .editable-textarea {
    border: none;
    border-bottom: 1px solid transparent;
    border-top: none;
    border-left: none;
    border-right: none;
    outline: none;
    font-size: inherit;
    color: inherit;
    font-weight: inherit;
    line-height: inherit;
    vertical-align: baseline;
    padding: 0;
    padding-bottom: 0;
    margin: 0;
    margin-bottom: 0;
    background: none;
    transition:
      border-bottom-color 0.3s,
      background-color 0.3s;
    color: inherit;
    cursor: text;
    resize: none;
    overflow: hidden;
    width: 100%;
    max-width: 100%;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  .editable-textarea:focus-visible {
    border: none;
  }

  .editable-textarea:hover {
    border-bottom: 1px solid #ced4da;
    background-color: transparent;
  }

  .editable-textarea:focus {
    border-bottom: 1px solid #495057;
    background-color: #f8f9fa;
  }

  .editable-textarea.has-unsaved-changes {
    border-bottom: 1px solid #ffc107;
  }

  .editable-textarea.is-saving {
    border-bottom: 1px solid #007bff;
  }

  .editable-textarea:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  /* Styles pour les inputs markdown */
  .markdown-input-wrapper {
    position: relative;
    padding-left: 0.5rem;
    margin-left: -0.5rem;
    border-left: 3px solid transparent;
    transition: border-left-color 0.1s, background-color 0.3s;
  }

  .markdown-input-wrapper:hover {
    border-left-color: #ced4da;
    background-color: #f8f9fa;
  }

  .markdown-input-wrapper.has-unsaved-changes {
    border-left-color: #ffc107 !important;
  }

  /* S'assurer que la bordure orange reste visible même quand TipTap a le focus */
  /* Note: .ProseMirror-focused est ajouté dynamiquement par TipTap */
  /* svelte-ignore a11y-no-unused-selector */
  :global(.markdown-input-wrapper.has-unsaved-changes:has(.ProseMirror-focused)) {
    border-left-color: #ffc107 !important;
  }

  .markdown-input-wrapper.has-unsaved-changes:hover {
    border-left-color: #ffc107 !important;
    background-color: #f8f9fa;
  }

  /* Note: .ProseMirror-focused est ajouté dynamiquement par TipTap */
  /* svelte-ignore a11y-no-unused-selector */
  :global(.markdown-input-wrapper.has-unsaved-changes:hover:has(.ProseMirror-focused)) {
    border-left-color: #ffc107 !important;
    background-color: #f8f9fa;
  }

  .saving-indicator-markdown {
    position: absolute;
    top: 0.5rem;
    left: 0.25rem;
    color: #007bff;
    font-size: 0.875rem;
    line-height: 1;
    pointer-events: none;
    z-index: 10;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
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
