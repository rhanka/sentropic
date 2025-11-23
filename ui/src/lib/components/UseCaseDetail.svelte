<script lang="ts">
  import References from '$lib/components/References.svelte';
import EditableInput from '$lib/components/EditableInput.svelte';
import { calculateUseCaseScores, scoreToStars } from '$lib/utils/scoring';
  import type { MatrixConfig } from '$lib/types/matrix';
  import { marked } from 'marked';
  import { onMount } from 'svelte';
  import { apiGet } from '$lib/utils/api';
  import { useCasesStore } from '$lib/stores/useCases';
import { normalizeUseCaseMarkdown } from '$lib/utils/markdown';
const arrayToMarkdown = (arr?: string[]) => {
  if (!arr || arr.length === 0) return '';
  return arr.map((item) => `- ${item}`).join('\n');
};

const markdownToArray = (md?: string) => {
  if (!md) return [];
  return md
    .split('\n')
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter(Boolean);
};

  export let useCase: any;
  export let matrix: MatrixConfig | null = null;
  export let calculatedScores: any = null;
  export let mode: 'edit' | 'view' | 'print-only' = 'view';
  export let isEditing: boolean = false;
  export let draft: any = {};

  // Fonction pour créer un lien de référence
  const createReferenceLink = (num: string, ref: {title: string; url: string}): string => {
    const refId = `ref-${num}`;
    return `<a href="#${refId}" 
                class="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer" 
                title="${ref.title.replace(/"/g, '&quot;')}"
                onclick="event.preventDefault(); document.getElementById('${refId}')?.scrollIntoView({behavior: 'smooth', block: 'center'}); return false;">
                [${num}]
              </a>`;
  };

  // Fonction pour parser les références [1], [2] dans le markdown HTML
  const parseReferencesInMarkdown = (html: string, references: Array<{title: string; url: string}> = []): string => {
    if (!html || !references || references.length === 0) return html;
    
    // Remplacer les patterns [1], [2], etc par des liens cliquables
    return html.replace(/\[(\d+)\]/g, (match, num) => {
      const index = parseInt(num) - 1;
      if (index >= 0 && index < references.length) {
        return createReferenceLink(num, references[index]);
      }
      return match; // Si la référence n'existe pas, garder le texte original
    });
  };

  // Fonction pour parser les références [1], [2] dans un texte simple (pas markdown)
  const parseReferencesInText = (text: string, references: Array<{title: string; url: string}> = []): string => {
    if (!text || !references || references.length === 0) return text;
    
    // Remplacer les patterns [1], [2], etc par des liens cliquables
    return text.replace(/\[(\d+)\]/g, (match, num) => {
      const index = parseInt(num) - 1;
      if (index >= 0 && index < references.length) {
        return createReferenceLink(num, references[index]);
      }
      return match; // Si la référence n'existe pas, garder le texte original
    });
  };

  // Fonction pour recharger le cas d'usage après sauvegarde
  const reloadUseCase = async (useCaseId: string) => {
    try {
      const updated = await apiGet(`/use-cases/${useCaseId}`);
      useCasesStore.update(items => items.map(uc => uc.id === useCaseId ? updated : uc));
      if (useCase?.id === useCaseId) {
        useCase = updated;
      }
    } catch (error) {
      console.error('Failed to reload use case:', error);
    }
  };

const TEXT_FIELDS = ['description', 'contact', 'deadline'];
let textBuffers: Record<string, string> = {};
let textOriginals: Record<string, string> = {};
let lastUseCaseId: string | null = null;

$: if (useCase?.id) {
  const normalizedValues = TEXT_FIELDS.reduce<Record<string, string>>((acc, field) => {
    acc[field] = normalizeUseCaseMarkdown(useCase[field] || '');
    return acc;
  }, {});

  if (useCase.id !== lastUseCaseId) {
    lastUseCaseId = useCase.id;
    TEXT_FIELDS.forEach((field) => {
      textBuffers[field] = normalizedValues[field];
      textOriginals[field] = normalizedValues[field];
    });
  } else {
    TEXT_FIELDS.forEach((field) => {
      if (normalizedValues[field] !== textOriginals[field]) {
        textBuffers[field] = normalizedValues[field];
        textOriginals[field] = normalizedValues[field];
      }
    });
  }
}

const countLines = (text: string) => text ? text.split(/\r?\n/).length : 0;
const renderMarkdownWithRefs = (text?: string | null, refs: Array<{title: string; url: string}> = []) => {
  if (!text) return '';
  const normalized = normalizeUseCaseMarkdown(text);
  const html = marked(normalized);
  return parseReferencesInMarkdown(html, refs);
};
const getTextFullData = (field: string) =>
  useCase?.id ? { [field]: normalizeUseCaseMarkdown(textBuffers[field] || '') } : null;

$: descriptionValue = textBuffers.description || '';
$: isDescriptionLong = (descriptionValue.length || 0) > 200 || countLines(descriptionValue) > 12;

$: descriptionFullData = getTextFullData('description');

  const handleFieldSaved = async () => {
    if (!useCase?.id) return;
    await reloadUseCase(useCase.id);
  };

  // Fonction pour obtenir le HTML de la description avec références parsées
$: descriptionHtml = useCase?.description 
  ? parseReferencesInMarkdown(
      marked(normalizeUseCaseMarkdown(useCase.description)).replace(/<ul>/g, '<ul class="list-disc space-y-2" style="padding-left:1rem;">'),
      useCase.references || []
    )
  : '';

  // Fonctions réactives pour parser les autres champs
  $: parsedBenefits = useCase?.benefits 
    ? (useCase.benefits || []).map((benefit: string) => parseReferencesInText(benefit, useCase.references || []))
    : [];

  $: parsedMetrics = useCase?.metrics 
    ? (useCase.metrics || []).map((metric: string) => parseReferencesInText(metric, useCase.references || []))
    : [];

  $: parsedRisks = useCase?.risks 
    ? (useCase.risks || []).map((risk: string) => parseReferencesInText(risk, useCase.references || []))
    : [];

  $: parsedNextSteps = useCase?.nextSteps 
    ? (useCase.nextSteps || []).map((step: string) => parseReferencesInText(step, useCase.references || []))
    : [];

  // Parser les justifications des axes valeur et complexité
  $: parsedValueScores = useCase?.valueScores && matrix
    ? (useCase.valueScores || []).map((score: any) => ({
        ...score,
        description: parseReferencesInText(score.description || '', useCase.references || [])
      }))
    : [];

  $: parsedComplexityScores = useCase?.complexityScores && matrix
    ? (useCase.complexityScores || []).map((score: any) => ({
        ...score,
        description: parseReferencesInText(score.description || '', useCase.references || [])
      }))
    : [];

  // Déterminer si on doit afficher les boutons d'action
  $: showActions = mode !== 'print-only';

  // Détection du mode impression pour le scaling
  let isPrinting = false;
  
  onMount(() => {
    // Détecter si on est en mode impression
    const checkPrintMode = () => {
      isPrinting = window.matchMedia('print').matches;
    };
    
    const handleBeforePrint = () => { isPrinting = true; };
    const handleAfterPrint = () => { isPrinting = false; };
    
    checkPrintMode();
    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);
    
    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  });

  // Calcul des facteurs d'échelle pour réduire la taille si trop d'items
  // Références : base = 8
  $: referencesScaleFactor = (useCase?.references && useCase.references.length > 8 && (mode === 'print-only' || isPrinting))
    ? 10 / useCase.references.length
    : 1;
  
  // Sources des données : base = 5
  $: dataSourcesScaleFactor = (useCase?.dataSources && useCase.dataSources.length > 5 && (mode === 'print-only' || isPrinting))
    ? 5 / useCase.dataSources.length
    : 1;
  
  // Données : base = 5
  $: dataObjectsScaleFactor = (useCase?.dataObjects && useCase.dataObjects.length > 5 && (mode === 'print-only' || isPrinting))
    ? 5 / useCase.dataObjects.length
    : 1;
  
  // Technologies : base = 7
  $: technologiesScaleFactor = (useCase?.technologies && useCase.technologies.length > 7 && (mode === 'print-only' || isPrinting))
    ? 7 / useCase.technologies.length
    : 1;
</script>

{#if useCase}
  <div class="usecase-print space-y-6" data-print-mode="true">
    <!-- Status Banner pour génération en cours -->
    {#if useCase.status === 'generating' || useCase.status === 'detailing' || useCase.status === 'pending'}
      <div class="rounded border border-blue-200 bg-blue-50 p-4">
        <div class="flex items-center gap-3">
          <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
          <p class="text-sm text-blue-700 font-medium">
            {#if useCase.status === 'detailing'}
              Détail en cours de génération...
            {:else if useCase.status === 'generating'}
              Cas d'usage en cours de génération...
            {:else if useCase.status === 'pending'}
              Génération en attente...
            {/if}
          </p>
        </div>
      </div>
    {/if}

    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div>
          <h1 class="text-3xl font-semibold">
            {useCase.name}
          </h1>
        </div>
        {#if useCase.model && showActions}
          <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700 no-print">
            {useCase.model}
          </span>
        {/if}
      </div>
      
      {#if showActions}
        <div class="flex gap-2 no-print">
          <slot name="actions-view" />
        </div>
      {/if}
    </div>

    <!-- Scores et Infos -->
    <div class="grid gap-6 lg:grid-cols-3 layout-head">
      {#if calculatedScores}
        <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div class="bg-green-100 text-green-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
            <h3 class="font-semibold flex items-center gap-2">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              Valeur calculée
            </h3>
          </div>
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-1">
              {#each Array(5) as _, i}
                <svg class="w-6 h-6 {i < calculatedScores.valueStars ? 'text-yellow-400' : 'text-gray-300'}" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                </svg>
              {/each}
            </div>
            <span class="font-bold text-green-600">
              ({calculatedScores.finalValueScore.toFixed(0)} points)
            </span>
          </div>
        </div>
        
        <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div class="bg-red-100 text-red-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
            <h3 class="font-semibold flex items-center gap-2">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
              </svg>
              Complexité calculée
            </h3>
          </div>
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-1">
              {#each Array(5) as _, i}
                {#if i < calculatedScores.complexityStars}
                  <svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                  </svg>
                {:else}
                  <svg class="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"></path>
                  </svg>
                {/if}
              {/each}
            </div>
            <span class="font-bold text-red-600">
              ({calculatedScores.finalComplexityScore.toFixed(0)} points)
            </span>
          </div>
        </div>
      {/if}
      <!-- Délai -->
      <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
          <h3 class="font-semibold flex items-center gap-2">
            <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            Délai
          </h3>
        </div>
        {#if mode === 'print-only'}
          <div class="text-slate-600 text-sm leading-relaxed prose prose-sm max-w-none">
            {#if useCase.deadline}
              {@html renderMarkdownWithRefs(useCase.deadline, useCase.references || [])}
            {/if}
          </div>
        {:else}
          <div class="text-slate-600 text-sm leading-relaxed prose prose-sm max-w-none">
            <EditableInput
              label=""
              value={textBuffers.deadline || ''}
              markdown={true}
              apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
              fullData={getTextFullData('deadline')}
              changeId={useCase?.id ? `usecase-deadline-${useCase.id}` : ''}
              originalValue={textOriginals.deadline || ''}
              references={useCase?.references || []}
              on:change={(e) => textBuffers.deadline = e.detail.value}
              on:saved={handleFieldSaved}
            />
          </div>
        {/if}
      </div>
    </div>

    <!-- COLUMN A 2/3 + B 1/3 Col = 3/3 -->
    <div class="grid gap-6 lg:grid-cols-3 layout-main">
      <!-- Description (100% de COLUMN A, 2/3 page) -->
      <div class="lg:col-span-2 column-a colspan-2-print">
        <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
            <h3 class="font-semibold flex items-center gap-2">
              <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
              </svg>
              Description
            </h3>
          </div>
          {#if mode === 'print-only'}
            <div class="text-slate-600 text-base leading-relaxed prose max-w-none" class:description-compact-print={isDescriptionLong}>
              {@html descriptionHtml || ''}
            </div>
          {:else}
            <div class="prose prose-slate max-w-none" class:description-compact-print={isDescriptionLong}>
              <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
                <EditableInput
                  label=""
                  value={descriptionValue}
                  markdown={true}
                  apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                  fullData={descriptionFullData}
                  changeId={useCase?.id ? `usecase-description-${useCase.id}` : ''}
                  originalValue={textOriginals.description || ''}
                  references={useCase?.references || []}
                  on:change={(e) => textBuffers.description = e.detail.value}
                  on:saved={handleFieldSaved}
                />
              </div>
            </div>
          {/if}
        </div>

        <!-- Autes (COL A, chacun 1/3 de page) -->
        <!-- Groupe Bénéfices + (Risques + Mesures du succès) (span 2 colonnes, lui-même en 2 colonnes) -->
        <div class="grid gap-6 lg:grid-cols-2">
          <!-- Bénéfices -->
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="bg-green-100 text-green-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
              <h3 class="font-semibold flex items-center gap-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
                </svg>
                Bénéfices recherchés
              </h3>
            </div>
            {#if isEditing && mode !== 'print-only'}
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">Bénéfices (un par ligne)</label>
                <textarea 
                  class="w-full rounded border border-slate-300 p-2 text-sm"
                  placeholder="Bénéfice 1&#10;Bénéfice 2&#10;..."
                  bind:value={draft.benefitsText}
                  rows="3"
                ></textarea>
              </div>
            {:else}
              <ul class="space-y-2">
                {#each parsedBenefits as benefit}
                  <li class="flex items-start gap-2 text-sm text-slate-600">
                    <span class="text-green-500 mt-1">•</span>
                    <span>{@html benefit}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

          <!-- Colonne 2 : Risques + Mesures du succès (empilés verticalement) -->
          <div class="space-y-6">
            <!-- Risques -->
            <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div class="bg-red-100 text-red-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
                <h3 class="font-semibold flex items-center gap-2">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
                  </svg>
                  Risques
                </h3>
              </div>
              {#if isEditing && mode !== 'print-only'}
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1">Risques (un par ligne)</label>
                  <textarea 
                    class="w-full rounded border border-slate-300 p-2 text-sm"
                    placeholder="Risque 1&#10;Risque 2&#10;..."
                    bind:value={draft.risksText}
                    rows="3"
                  ></textarea>
                </div>
              {:else}
                <ul class="space-y-2">
                  {#each parsedRisks as risk}
                    <li class="flex items-start gap-2 text-sm text-slate-600">
                      <span class="text-red-500 mt-1">•</span>
                      <span>{@html risk}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>

            <!-- Mesures du succès -->
            <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div class="bg-blue-100 text-blue-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
                <h3 class="font-semibold flex items-center gap-2">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
                  </svg>
                  Mesures du succès
                </h3>
              </div>
              {#if isEditing && mode !== 'print-only'}
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1">Métriques (une par ligne)</label>
                  <textarea 
                    class="w-full rounded border border-slate-300 p-2 text-sm"
                    placeholder="Métrique 1&#10;Métrique 2&#10;..."
                    bind:value={draft.metricsText}
                    rows="3"
                  ></textarea>
                </div>
              {:else}
                <ul class="space-y-2">
                  {#each parsedMetrics as metric}
                    <li class="flex items-start gap-2 text-sm text-slate-600">
                      <span class="text-blue-500 mt-1">•</span>
                      <span>{@html metric}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          </div>
        </div>
      </div>

      <!-- COL B 1/3 Col -->
      <div class="lg:col-span-1 column-b">
      <!-- Informations -->
      <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
          <h3 class="font-semibold flex items-center gap-2">
            <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            Informations
          </h3>
        </div>
        <div class="space-y-3 text-sm">
          <div class="flex items-start gap-2">
            <span class="font-medium text-slate-700 mt-1">Contact:</span>
            {#if mode === 'print-only'}
              <span class="text-slate-600">
                {@html useCase.contact ? renderMarkdownWithRefs(useCase.contact, useCase.references || []) : ''}
              </span>
            {:else}
              <span class="flex-1 text-slate-600">
                <EditableInput
                  label=""
                  value={textBuffers.contact || ''}
                  markdown={true}
                  apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                  fullData={getTextFullData('contact')}
                  changeId={useCase?.id ? `usecase-contact-${useCase.id}` : ''}
                  originalValue={textOriginals.contact || ''}
                  references={useCase?.references || []}
                  on:change={(e) => textBuffers.contact = e.detail.value}
              on:saved={handleFieldSaved}
                />
              </span>
            {/if}
          </div>
          <!-- Domaine affichage désactivé tant que non supporté par le prompt -->
        </div>
      </div>

      <!-- Technologies -->
      {#if useCase.technologies && useCase.technologies.length > 0}
        <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
            <h3 class="font-semibold flex items-center gap-2">
              <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"></path>
              </svg>
              Technologies
            </h3>
          </div>
          <div class="space-y-3 text-sm">
            <div>
              <ul 
                class="text-slate-600 ml-4 mt-1 space-y-2 list-disc technologies-content"
                style={technologiesScaleFactor < 1 ? `font-size: ${technologiesScaleFactor}em; line-height: ${Math.max(1.2, technologiesScaleFactor * 1.5)}em;` : ''}
              >
                {#each useCase.technologies as tech}
                  <li class="text-sm">{tech}</li>
                {/each}
              </ul>
            </div>
          </div>
        </div>
      {/if}

      <!-- Sources -->
      <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
          <h3 class="font-semibold flex items-center gap-2">
            <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
            </svg>
            Sources des données
          </h3>
        </div>
        {#if isEditing && mode !== 'print-only'}
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Sources (une par ligne)</label>
            <textarea 
              class="w-full rounded border border-slate-300 p-2 text-sm"
              placeholder="Source 1&#10;Source 2&#10;..."
              bind:value={draft.dataSourcesText}
              rows="3"
            ></textarea>
          </div>
        {:else}
          <ul 
            class="space-y-2 data-sources-content"
            style={dataSourcesScaleFactor < 1 ? `font-size: ${dataSourcesScaleFactor}em; line-height: ${Math.max(1.2, dataSourcesScaleFactor * 1.5)}em;` : ''}
          >
            {#each useCase.dataSources || [] as source}
              <li class="flex items-start gap-2 text-sm text-slate-600">
                <svg 
                  class="w-4 h-4 text-blue-500 mt-0.5" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                  style={dataSourcesScaleFactor < 1 ? `width: ${dataSourcesScaleFactor * 1}em !important; height: ${dataSourcesScaleFactor * 1}em !important;` : ''}
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                </svg>
                <span>{source}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <!-- Données liées -->
      <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
          <h3 class="font-semibold flex items-center gap-2">
            <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"></path>
            </svg>
            Données
          </h3>
        </div>
        {#if isEditing && mode !== 'print-only'}
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Données liées (une par ligne)</label>
            <textarea 
              class="w-full rounded border border-slate-300 p-2 text-sm"
              placeholder="Donnée 1&#10;Donnée 2&#10;..."
              bind:value={draft.dataObjectsText}
              rows="3"
            ></textarea>
          </div>
        {:else}
          <ul 
            class="space-y-2 data-objects-content"
            style={dataObjectsScaleFactor < 1 ? `font-size: ${dataObjectsScaleFactor}em; line-height: ${Math.max(1.2, dataObjectsScaleFactor * 1.5)}em;` : ''}
          >
            {#each useCase.dataObjects || [] as data}
              <li class="flex items-start gap-2 text-sm text-slate-600">
                <svg 
                  class="w-4 h-4 text-blue-500 mt-0.5" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                  style={dataObjectsScaleFactor < 1 ? `width: ${dataObjectsScaleFactor * 1}em !important; height: ${dataObjectsScaleFactor * 1}em !important;` : ''}
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"></path>
                </svg>
                <span>{data}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>

  <!-- Matrice détaillée en 2 colonnes séparées -->
  <div class="grid gap-6 md:grid-cols-2 layout-bottom">
    <!-- Prochaines étapes -->
    <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div class="bg-purple-100 text-purple-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
        <h3 class="font-semibold flex items-center gap-2">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path>
          </svg>
          Prochaines étapes
        </h3>
      </div>
      {#if isEditing && mode !== 'print-only'}
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Prochaines étapes (une par ligne)</label>
          <textarea 
            class="w-full rounded border border-slate-300 p-2 text-sm"
            placeholder="Étape 1&#10;Étape 2&#10;..."
            bind:value={draft.nextStepsText}
            rows="3"
          ></textarea>
        </div>
      {:else}
        <ul class="space-y-2">
          {#each parsedNextSteps as step}
            <li class="flex items-start gap-2 text-sm text-slate-600">
              <span class="text-purple-500 mt-1">•</span>
              <span>{@html step}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <!-- Références (désormais en 1/3, sous Données) -->
    {#if !isEditing && (useCase.references && useCase.references.length > 0)}
      <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
          <h3 class="font-semibold flex items-center gap-2">
            Références
          </h3>
        </div>
        <References references={useCase.references || []} {referencesScaleFactor} />
      </div>
    {/if}

    {#if matrix && useCase.valueScores && useCase.complexityScores && !isEditing}
      <!-- Axes de Valeur -->
      <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div class="bg-green-100 text-green-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
          <h3 class="font-semibold flex items-center gap-2">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            Axes de Valeur
          </h3>
        </div>
        <div class="space-y-4">
          {#each matrix.valueAxes as axis}
            {@const score = parsedValueScores.find((s: any) => s.axisId === axis.id)}
            {#if score}
              {@const stars = scoreToStars(Number(score.rating))}
              <div class="rounded border border-slate-200 bg-white p-3">
                <div class="flex items-center justify-between mb-2">
                  <h5 class="font-medium text-slate-900">{axis.name}</h5>
                  <div class="flex items-center gap-2">
                    <div class="flex items-center gap-1">
                      {#each Array(5) as _, i}
                        <svg class="w-4 h-4 {i < stars ? 'text-yellow-400' : 'text-gray-300'}" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                        </svg>
                      {/each}
                    </div>
                    <span class="text-sm text-slate-600">({score.rating} pts)</span>
                  </div>
                </div>
                <p class="text-sm text-slate-600">{@html score.description}</p>
              </div>
            {/if}
          {/each}
        </div>
      </div>

      <!-- Axes de Complexité -->
      <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div class="bg-red-100 text-red-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
          <h3 class="font-semibold flex items-center gap-2">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
            </svg>
            Axes de Complexité
          </h3>
        </div>
        <div class="space-y-4">
          {#each matrix.complexityAxes as axis}
            {@const score = parsedComplexityScores.find((s: any) => s.axisId === axis.id)}
            {#if score}
              {@const stars = scoreToStars(Number(score.rating))}
              <div class="rounded border border-slate-200 bg-white p-3">
                <div class="flex items-center justify-between mb-2">
                  <h5 class="font-medium text-slate-900">{axis.name}</h5>
                  <div class="flex items-center gap-2">
                    <div class="flex items-center gap-1">
                      {#each Array(5) as _, i}
                        {#if i < stars}
                          <svg class="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                          </svg>
                        {:else}
                          <svg class="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"></path>
                          </svg>
                        {/if}
                      {/each}
                    </div>
                    <span class="text-sm text-slate-600">({score.rating} pts)</span>
                  </div>
                </div>
                <p class="text-sm text-slate-600">{@html score.description}</p>
              </div>
            {/if}
          {/each}
        </div>
      </div>
    {/if}
  </div>
  </div>
{/if}
