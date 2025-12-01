<script lang="ts">
  import References from '$lib/components/References.svelte';
import EditableInput from '$lib/components/EditableInput.svelte';
import { scoreToStars } from '$lib/utils/scoring';
  import type { MatrixConfig } from '$lib/types/matrix';
  import { onMount } from 'svelte';
  import { apiGet } from '$lib/utils/api';
  import { useCasesStore } from '$lib/stores/useCases';
import { arrayToMarkdown, markdownToArray, normalizeUseCaseMarkdown, stripTrailingEmptyParagraph, renderMarkdownWithRefs, parseReferencesInText } from '$lib/utils/markdown';

  export let useCase: any;
  export let matrix: MatrixConfig | null = null;
  export let calculatedScores: any = null;
  export let isEditing: boolean = false;

  // Helper to create array of indices for iteration
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

  // Fonction pour recharger le cas d'usage après sauvegarde (debounced)
  let reloadTimeout: ReturnType<typeof setTimeout> | null = null;
  const reloadUseCase = async (useCaseId: string) => {
    // Annuler le rechargement précédent s'il existe
    if (reloadTimeout) {
      clearTimeout(reloadTimeout);
    }
    // Programmer le rechargement avec un délai de 500ms
    reloadTimeout = setTimeout(async () => {
      try {
        const updated = await apiGet(`/use-cases/${useCaseId}`);
        useCasesStore.update(items => items.map(uc => uc.id === useCaseId ? updated : uc));
        if (useCase?.id === useCaseId) {
          useCase = updated;
        }
      } catch (error) {
        console.error('Failed to reload use case:', error);
      } finally {
        reloadTimeout = null;
      }
    }, 500);
  };

const TEXT_FIELDS = ['description', 'problem', 'solution', 'contact', 'deadline'] as const;
const LIST_FIELDS = ['benefits', 'risks', 'metrics', 'nextSteps', 'technologies', 'dataSources', 'dataObjects'] as const;
type TextField = (typeof TEXT_FIELDS)[number];
type ListField = (typeof LIST_FIELDS)[number];

let textBuffers: Record<TextField, string> = {
  description: '',
  problem: '',
  solution: '',
  contact: '',
  deadline: '',
};
let textOriginals: Record<TextField, string> = {
  description: '',
  problem: '',
  solution: '',
  contact: '',
  deadline: '',
};
let listBuffers: Record<ListField, string[]> = {
  benefits: [],
  risks: [],
  metrics: [],
  nextSteps: [],
  technologies: [],
  dataSources: [],
  dataObjects: [],
};
let listOriginals: Record<ListField, string[]> = {
  benefits: [],
  risks: [],
  metrics: [],
  nextSteps: [],
  technologies: [],
  dataSources: [],
  dataObjects: [],
};
let listMarkdowns: Record<ListField, string> = {
  benefits: '',
  risks: '',
  metrics: '',
  nextSteps: '',
  technologies: '',
  dataSources: '',
  dataObjects: '',
};
// Buffers pour les descriptions des scores (indexés par 'value-axisId' ou 'complexity-axisId')
let scoreBuffers: Record<string, string> = {};
let scoreOriginals: Record<string, string> = {};
let lastUseCaseId: string | null = null;

const setTextBuffer = (field: TextField, value: string) => {
  textBuffers = { ...textBuffers, [field]: value };
};
const setListBuffer = (field: ListField, value: string[]) => {
  listBuffers = { ...listBuffers, [field]: value };
};
const setScoreBuffer = (type: 'value' | 'complexity', axisId: string, value: string) => {
  const key = `${type}-${axisId}`;
  scoreBuffers = { ...scoreBuffers, [key]: value };
};

$: if (useCase?.id) {
  // Extraire les valeurs depuis data (avec fallback sur les propriétés directes pour rétrocompatibilité)
  const getFieldValue = (field: TextField): string => {
    // Pour name, description, problem, solution : chercher dans data d'abord
    if (field === 'name' || field === 'description' || field === 'problem' || field === 'solution') {
      return useCase?.data?.[field] || useCase?.[field] || '';
    }
    // Pour les autres champs : chercher dans data puis dans les propriétés directes
    return useCase?.data?.[field] || useCase?.[field] || '';
  };
  
  const normalizedValues = TEXT_FIELDS.reduce<Record<TextField, string>>((acc, field) => {
    acc[field] = normalizeUseCaseMarkdown(getFieldValue(field));
    return acc;
  }, {} as Record<TextField, string>);
  const listValues = LIST_FIELDS.reduce<Record<ListField, string[]>>((acc, field) => {
    // Extraire depuis data (avec fallback sur les propriétés directes)
    const source = Array.isArray(useCase?.data?.[field]) 
      ? (useCase.data[field] as string[]) 
      : Array.isArray(useCase?.[field]) 
        ? (useCase[field] as string[]) 
        : [];
    acc[field] = [...source];
    return acc;
  }, {} as Record<ListField, string[]>);

  // Initialiser les buffers de scores (extraire depuis data)
  const scoreValues: Record<string, string> = {};
  const valueScores = useCase?.data?.valueScores || useCase?.valueScores || [];
  const complexityScores = useCase?.data?.complexityScores || useCase?.complexityScores || [];
  if (valueScores && matrix) {
    valueScores.forEach((score: any) => {
      const key = `value-${score.axisId}`;
      scoreValues[key] = normalizeUseCaseMarkdown(score.description || '');
    });
  }
  if (complexityScores && matrix) {
    complexityScores.forEach((score: any) => {
      const key = `complexity-${score.axisId}`;
      scoreValues[key] = normalizeUseCaseMarkdown(score.description || '');
    });
  }

  if (useCase.id !== lastUseCaseId) {
    lastUseCaseId = useCase.id;
    textBuffers = { ...normalizedValues };
    textOriginals = { ...normalizedValues };
    listBuffers = { ...listValues };
    listOriginals = { ...listValues };
    scoreBuffers = { ...scoreValues };
    scoreOriginals = { ...scoreValues };
  } else {
    let changed = false;
    const updatedBuffers = { ...textBuffers };
    const updatedOriginals = { ...textOriginals };
    const updatedListBuffers = { ...listBuffers };
    const updatedListOriginals = { ...listOriginals };

    TEXT_FIELDS.forEach((field) => {
      if (normalizedValues[field] !== textOriginals[field]) {
        updatedBuffers[field] = normalizedValues[field];
        updatedOriginals[field] = normalizedValues[field];
        changed = true;
      }
    });

    LIST_FIELDS.forEach((field) => {
      // Extraire depuis data (avec fallback sur les propriétés directes pour rétrocompatibilité)
      const incoming = Array.isArray(useCase?.data?.[field]) 
        ? (useCase.data[field] as string[]) 
        : Array.isArray(useCase?.[field]) 
          ? (useCase[field] as string[]) 
          : [];
      if (JSON.stringify(incoming) !== JSON.stringify(listOriginals[field])) {
        updatedListBuffers[field] = [...incoming];
        updatedListOriginals[field] = [...incoming];
        changed = true;
      }
    });

    // Mettre à jour les buffers de scores si nécessaire
    const updatedScoreBuffers = { ...scoreBuffers };
    const updatedScoreOriginals = { ...scoreOriginals };
    Object.keys(scoreValues).forEach((key) => {
      if (scoreValues[key] !== scoreOriginals[key]) {
        updatedScoreBuffers[key] = scoreValues[key];
        updatedScoreOriginals[key] = scoreValues[key];
        changed = true;
      }
    });
    if (changed) {
      textBuffers = updatedBuffers;
      textOriginals = updatedOriginals;
      listBuffers = updatedListBuffers;
      listOriginals = updatedListOriginals;
      scoreBuffers = updatedScoreBuffers;
      scoreOriginals = updatedScoreOriginals;
    }
  }
}

$: listMarkdowns = LIST_FIELDS.reduce<Record<ListField, string>>((acc, field) => {
  acc[field] = arrayToMarkdown(listBuffers[field]);
  return acc;
}, {} as Record<ListField, string>);

const getTextFullData = (field: TextField) => {
  if (!useCase?.id) return null;
  const normalized = normalizeUseCaseMarkdown(textBuffers[field] || '');
  const cleaned = stripTrailingEmptyParagraph(normalized);
  // Retourner directement le champ au niveau racine (buildUseCaseData construira l'objet data)
  return { [field]: cleaned };
};
const getListFullData = (field: ListField) => {
  if (!useCase?.id) return null;
  const markdown = arrayToMarkdown(listBuffers[field] || []);
  const cleaned = stripTrailingEmptyParagraph(markdown);
  // Retourner directement le champ au niveau racine (buildUseCaseData construira l'objet data)
  return { [field]: markdownToArray(cleaned) };
};
const getScoreFullData = (type: 'value' | 'complexity', axisId: string) => {
  if (!useCase?.id || !matrix) return null;
  const key = `${type}-${axisId}`;
  const normalized = normalizeUseCaseMarkdown(scoreBuffers[key] || '');
  const cleaned = stripTrailingEmptyParagraph(normalized);
  
  // Mettre à jour le score.description dans l'array approprié (extraire depuis data)
  const scores = type === 'value' 
    ? (useCase?.data?.valueScores || useCase?.valueScores || [])
    : (useCase?.data?.complexityScores || useCase?.complexityScores || []);
  const updatedScores = (scores || []).map((score: any) => {
    if (score.axisId === axisId) {
      return { ...score, description: cleaned };
    }
    return score;
  });
  
  // Retourner directement le champ au niveau racine (buildUseCaseData construira l'objet data)
  return type === 'value' 
    ? { valueScores: updatedScores }
    : { complexityScores: updatedScores };
};

// Critère partagé pour description, problem et solution
$: isTextContentLong = ((textBuffers.description || '').length || 0) + Math.max(((textBuffers.problem || '').length || 0), ((textBuffers.solution || '').length || 0)) * 2 > 2000;

// Extraire les scores totaux depuis data (avec fallback)
$: totalValueScore = useCase?.data?.totalValueScore !== undefined 
  ? useCase.data.totalValueScore 
  : (useCase?.totalValueScore !== undefined 
    ? useCase.totalValueScore 
    : (calculatedScores?.finalValueScore !== undefined ? calculatedScores.finalValueScore : null));

$: totalComplexityScore = useCase?.data?.totalComplexityScore !== undefined 
  ? useCase.data.totalComplexityScore 
  : (useCase?.totalComplexityScore !== undefined 
    ? useCase.totalComplexityScore 
    : (calculatedScores?.finalComplexityScore !== undefined ? calculatedScores.finalComplexityScore : null));

$: valueStars = calculatedScores?.valueStars !== undefined 
  ? calculatedScores.valueStars 
  : (totalValueScore !== null && totalValueScore !== undefined ? Math.round(totalValueScore / 20) : 0);

$: complexityStars = calculatedScores?.complexityStars !== undefined 
  ? calculatedScores.complexityStars 
  : (totalComplexityScore !== null && totalComplexityScore !== undefined ? Math.round(totalComplexityScore / 20) : 0);

  const handleFieldSaved = async () => {
    if (!useCase?.id) return;
    await reloadUseCase(useCase.id);
  };
  const handleScoreSaved = async () => {
    if (!useCase?.id) return;
    await reloadUseCase(useCase.id);
  };

  // Fonction pour obtenir le HTML de la description avec références parsées
$: descriptionHtml = (useCase?.data?.description || useCase?.description)
  ? renderMarkdownWithRefs(
      useCase.data?.description || useCase.description || '',
      getReferences(),
      { addListStyles: true, listPadding: 1.5 }
    )
  : '';
  
$: problemHtml = (useCase?.data?.problem || useCase?.problem)
  ? renderMarkdownWithRefs(
      useCase.data?.problem || useCase.problem || '',
      getReferences(),
      { addListStyles: true, listPadding: 1.5 }
    )
  : '';
  
$: solutionHtml = (useCase?.data?.solution || useCase?.solution)
  ? renderMarkdownWithRefs(
      useCase.data?.solution || useCase.solution || '',
      getReferences(),
      { addListStyles: true, listPadding: 1.5 }
    )
  : '';

  // Fonctions réactives pour parser les autres champs (extraire depuis data)
  const getReferences = () => useCase?.data?.references || useCase?.references || [];
  
  $: parsedBenefits = (useCase?.data?.benefits || useCase?.benefits)
    ? (useCase.data?.benefits || useCase.benefits || []).map((benefit: string) => renderMarkdownWithRefs(benefit, getReferences(), { addListStyles: true, listPadding: 1.5 }))
    : [];
  
  $: parsedMetrics = (useCase?.data?.metrics || useCase?.metrics)
    ? (useCase.data?.metrics || useCase.metrics || []).map((metric: string) => renderMarkdownWithRefs(metric, getReferences(), { addListStyles: true, listPadding: 1.5 }))
    : [];
  
  $: parsedRisks = (useCase?.data?.risks || useCase?.risks)
    ? (useCase.data?.risks || useCase.risks || []).map((risk: string) => renderMarkdownWithRefs(risk, getReferences(), { addListStyles: true, listPadding: 1.5 }))
    : [];
  
  $: parsedTechnologies = (useCase?.data?.technologies || useCase?.technologies)
    ? (useCase.data?.technologies || useCase.technologies || []).map((tech: string) => renderMarkdownWithRefs(tech, getReferences(), { addListStyles: true, listPadding: 1.5 }))
    : [];
  
  $: parsedDataSources = (useCase?.data?.dataSources || useCase?.dataSources)
    ? (useCase.data?.dataSources || useCase.dataSources || []).map((source: string) => renderMarkdownWithRefs(source, getReferences(), { addListStyles: true, listPadding: 1.5 }))
    : [];
  
  $: parsedDataObjects = (useCase?.data?.dataObjects || useCase?.dataObjects)
    ? (useCase.data?.dataObjects || useCase.dataObjects || []).map((data: string) => renderMarkdownWithRefs(data, getReferences(), { addListStyles: true, listPadding: 1.5 }))
    : [];

  $: parsedNextSteps = (useCase?.data?.nextSteps || useCase?.nextSteps)
    ? (useCase.data?.nextSteps || useCase.nextSteps || []).map((step: string) => parseReferencesInText(step, getReferences()))
    : [];

  // Parser les justifications des axes valeur et complexité avec buffers (extraire depuis data)
  $: parsedValueScores = (useCase?.data?.valueScores || useCase?.valueScores) && matrix
    ? (useCase.data?.valueScores || useCase.valueScores || []).map((score: any) => {
        const key = `value-${score.axisId}`;
        const description = scoreBuffers[key] !== undefined ? scoreBuffers[key] : (score.description || '');
        return {
          ...score,
          description: renderMarkdownWithRefs(description, getReferences(), { addListStyles: true, listPadding: 1.5 })
        };
      })
    : [];

  $: parsedComplexityScores = (useCase?.data?.complexityScores || useCase?.complexityScores) && matrix
    ? (useCase.data?.complexityScores || useCase.complexityScores || []).map((score: any) => {
        const key = `complexity-${score.axisId}`;
        const description = scoreBuffers[key] !== undefined ? scoreBuffers[key] : (score.description || '');
        return {
          ...score,
          description: renderMarkdownWithRefs(description, getReferences(), { addListStyles: true, listPadding: 1.5 })
        };
      })
    : [];

  // Déterminer si on doit afficher les boutons d'action
  $: showActions = !isPrinting;

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
  $: referencesScaleFactor = (getReferences().length > 8 && isPrinting)
    ? 10 / getReferences().length
    : 1;
  
  // Sources des données : base = 5
  $: dataSourcesScaleFactor = ((useCase?.data?.dataSources || useCase?.dataSources) && (useCase.data?.dataSources || useCase.dataSources || []).length > 5 && isPrinting)
    ? 5 / (useCase.data?.dataSources || useCase.dataSources || []).length
    : 1;
  
  // Données : base = 5
  $: dataObjectsScaleFactor = ((useCase?.data?.dataObjects || useCase?.dataObjects) && (useCase.data?.dataObjects || useCase.dataObjects || []).length > 5 && isPrinting)
    ? 5 / (useCase.data?.dataObjects || useCase.dataObjects || []).length
    : 1;
  
  // Technologies : base = 7
  $: technologiesScaleFactor = ((useCase?.data?.technologies || useCase?.technologies) && (useCase.data?.technologies || useCase.technologies || []).length > 7 && isPrinting)
    ? 7 / (useCase.data?.technologies || useCase.technologies || []).length
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
            {useCase?.data?.name || useCase?.name || 'Cas d\'usage sans nom'}
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
      {#if totalValueScore !== null && totalValueScore !== undefined}
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
              {#each range(5) as i (i)}
                <svg class="w-6 h-6 {i < valueStars ? 'text-yellow-400' : 'text-gray-300'}" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                </svg>
              {/each}
            </div>
            <span class="font-bold text-green-600">
              ({totalValueScore.toFixed(0)} points)
            </span>
          </div>
        </div>
      {/if}
      
      {#if totalComplexityScore !== null && totalComplexityScore !== undefined}
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
              {#each range(5) as i (i)}
                {#if i < complexityStars}
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
              ({totalComplexityScore.toFixed(0)} points)
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
        {#if isPrinting}
          <div class="text-slate-600 text-sm leading-relaxed prose prose-sm max-w-none">
            {#if useCase?.data?.deadline || useCase?.deadline}
              {@html renderMarkdownWithRefs(useCase?.data?.deadline || useCase?.deadline || '', getReferences())}
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
              fullDataGetter={() => getTextFullData('deadline')}
              changeId={useCase?.id ? `usecase-deadline-${useCase.id}` : ''}
              originalValue={textOriginals.deadline || ''}
                  references={getReferences()}
                  on:change={(e) => setTextBuffer('deadline', e.detail.value)}
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
          {#if isPrinting}
            <div class="text-slate-600 text-base leading-relaxed prose max-w-none" class:description-compact-print={isTextContentLong}>
              {@html descriptionHtml || ''}
            </div>
          {:else}
            <div class="prose prose-slate max-w-none" class:description-compact-print={isTextContentLong}>
              <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
                <EditableInput
                  label=""
                  value={textBuffers.description || ''}
                  markdown={true}
                  apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                  fullData={getTextFullData('description')}
                  fullDataGetter={() => getTextFullData('description')}
                  changeId={useCase?.id ? `usecase-description-${useCase.id}` : ''}
                  originalValue={textOriginals.description || ''}
                  references={getReferences()}
                  on:change={(e) => setTextBuffer('description', e.detail.value)}
                  on:saved={handleFieldSaved}
                />
              </div>
            </div>
          {/if}
        </div>

        <!-- Problème et Solution (2 colonnes équilibrées) -->
        <div class="grid gap-6 lg:grid-cols-2">
          <!-- Problème -->
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="bg-orange-100 text-orange-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
              <h3 class="font-semibold flex items-center gap-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
                </svg>
                Problème
              </h3>
            </div>
            {#if isPrinting}
              <div class="text-slate-600 text-base leading-relaxed prose max-w-none" class:description-compact-print={isTextContentLong}>
                {@html problemHtml || ''}
              </div>
            {:else}
              <div class="prose prose-slate max-w-none" class:description-compact-print={isTextContentLong}>
                <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
                  <EditableInput
                    label=""
                    value={textBuffers.problem || ''}
                    markdown={true}
                    apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                    fullData={getTextFullData('problem')}
                    fullDataGetter={() => getTextFullData('problem')}
                    changeId={useCase?.id ? `usecase-problem-${useCase.id}` : ''}
                    originalValue={textOriginals.problem || ''}
                    references={getReferences()}
                    on:change={(e) => setTextBuffer('problem', e.detail.value)}
                    on:saved={handleFieldSaved}
                  />
                </div>
              </div>
            {/if}
          </div>

          <!-- Solution -->
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="bg-blue-100 text-blue-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
              <h3 class="font-semibold flex items-center gap-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
                </svg>
                Solution
              </h3>
            </div>
            {#if isPrinting}
              <div class="text-slate-600 text-base leading-relaxed prose max-w-none" class:description-compact-print={isTextContentLong}>
                {@html solutionHtml || ''}
              </div>
            {:else}
              <div class="prose prose-slate max-w-none" class:description-compact-print={isTextContentLong}>
                <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
                  <EditableInput
                    label=""
                    value={textBuffers.solution || ''}
                    markdown={true}
                    apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                    fullData={getTextFullData('solution')}
                    fullDataGetter={() => getTextFullData('solution')}
                    changeId={useCase?.id ? `usecase-solution-${useCase.id}` : ''}
                    originalValue={textOriginals.solution || ''}
                    references={getReferences()}
                    on:change={(e) => setTextBuffer('solution', e.detail.value)}
                    on:saved={handleFieldSaved}
                  />
                </div>
              </div>
            {/if}
          </div>
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
            {#if isPrinting}
              <ul class="space-y-2">
                {#each parsedBenefits as benefit}
                  <li class="flex items-start gap-2 text-sm text-slate-600">
                    <span class="text-green-500 mt-1">•</span>
                    <span>{@html benefit}</span>
                  </li>
                {/each}
              </ul>
            {:else}
              <div class="text-sm text-slate-600">
                <EditableInput
                  label=""
                  value={listMarkdowns.benefits || ''}
                  markdown={true}
                  forceList={true}
                  apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                  fullData={getListFullData('benefits')}
                  fullDataGetter={() => getListFullData('benefits')}
                  changeId={useCase?.id ? `usecase-benefits-${useCase.id}` : ''}
                  originalValue={arrayToMarkdown(listOriginals.benefits) || ''}
                  references={getReferences()}
                  on:change={(e) => setListBuffer('benefits', markdownToArray(e.detail.value))}
                  on:saved={handleFieldSaved}
                />
              </div>
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
              {#if isPrinting}
                <ul class="space-y-2">
                  {#each parsedRisks as risk}
                    <li class="flex items-start gap-2 text-sm text-slate-600">
                      <span class="text-red-500 mt-1">•</span>
                      <span>{@html risk}</span>
                    </li>
                  {/each}
                </ul>
              {:else}
                <div class="text-sm text-slate-600">
                  <EditableInput
                    label=""
                    value={listMarkdowns.risks || ''}
                    markdown={true}
                    forceList={true}
                    apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                    fullData={getListFullData('risks')}
                    fullDataGetter={() => getListFullData('risks')}
                    changeId={useCase?.id ? `usecase-risks-${useCase.id}` : ''}
                    originalValue={arrayToMarkdown(listOriginals.risks) || ''}
                    references={getReferences()}
                    on:change={(e) => setListBuffer('risks', markdownToArray(e.detail.value))}
                    on:saved={handleFieldSaved}
                  />
                </div>
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
              {#if isPrinting}
                <ul class="space-y-2">
                  {#each parsedMetrics as metric}
                    <li class="flex items-start gap-2 text-sm text-slate-600">
                      <span class="text-blue-500 mt-1">•</span>
                      <span>{@html metric}</span>
                    </li>
                  {/each}
                </ul>
              {:else}
                <div class="text-sm text-slate-600">
                  <EditableInput
                    label=""
                    value={listMarkdowns.metrics || ''}
                    markdown={true}
                    forceList={true}
                    apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                    fullData={getListFullData('metrics')}
                    fullDataGetter={() => getListFullData('metrics')}
                    changeId={useCase?.id ? `usecase-metrics-${useCase.id}` : ''}
                    originalValue={arrayToMarkdown(listOriginals.metrics) || ''}
                    references={getReferences()}
                    on:change={(e) => setListBuffer('metrics', markdownToArray(e.detail.value))}
                    on:saved={handleFieldSaved}
                  />
                </div>
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
        <div class="space-y-3">
          <div class="flex items-start gap-2">
            <span class="font-medium text-slate-700 mt-1">Contact:</span>
            {#if isPrinting}
              <div class="text-slate-600 text-sm leading-relaxed prose prose-sm max-w-none">
                {@html (useCase?.data?.contact || useCase?.contact) ? renderMarkdownWithRefs(useCase?.data?.contact || useCase?.contact || '', getReferences()) : ''}
              </div>
            {:else}
              <span class="flex-1 text-slate-600 text-sm">
                <EditableInput
                  label=""
                  value={textBuffers.contact || ''}
                  markdown={true}
                  apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                  fullData={getTextFullData('contact')}
                  fullDataGetter={() => getTextFullData('contact')}
                  changeId={useCase?.id ? `usecase-contact-${useCase.id}` : ''}
                  originalValue={textOriginals.contact || ''}
                  references={getReferences()}
                  on:change={(e) => setTextBuffer('contact', e.detail.value)}
              on:saved={handleFieldSaved}
                />
              </span>
            {/if}
          </div>
          <!-- Domaine affichage désactivé tant que non supporté par le prompt -->
        </div>
      </div>

      <!-- Technologies -->
      {#if (useCase?.data?.technologies || useCase?.technologies) && (useCase?.data?.technologies || useCase?.technologies || []).length > 0}
        <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
            <h3 class="font-semibold flex items-center gap-2">
              <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"></path>
              </svg>
              Technologies
            </h3>
          </div>
          {#if isPrinting}
            <ul 
              class="space-y-2"
              style={technologiesScaleFactor < 1 ? `font-size: ${technologiesScaleFactor}em; line-height: ${Math.max(1.2, technologiesScaleFactor * 1.5)}em;` : ''}
            >
              {#each parsedTechnologies as tech}
                <li class="flex items-start gap-2 text-sm text-slate-600">
                  <span class="text-slate-500 mt-1">•</span>
                  <span>{@html tech}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <div class="text-sm text-slate-600">
              <EditableInput
                label=""
                value={listMarkdowns.technologies || ''}
                markdown={true}
                forceList={true}
                apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                fullData={getListFullData('technologies')}
                fullDataGetter={() => getListFullData('technologies')}
                changeId={useCase?.id ? `usecase-technologies-${useCase.id}` : ''}
                originalValue={arrayToMarkdown(listOriginals.technologies) || ''}
                references={getReferences()}
                on:change={(e) => setListBuffer('technologies', markdownToArray(e.detail.value))}
                on:saved={handleFieldSaved}
              />
            </div>
          {/if}
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
        {#if isPrinting}
          <ul 
            class="space-y-2"
            style={dataSourcesScaleFactor < 1 ? `font-size: ${dataSourcesScaleFactor}em; line-height: ${Math.max(1.2, dataSourcesScaleFactor * 1.5)}em;` : ''}
          >
            {#each parsedDataSources as source}
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
                <span>{@html source}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="text-sm text-slate-600">
            <EditableInput
              label=""
              value={listMarkdowns.dataSources || ''}
              markdown={true}
              forceList={true}
              apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
              fullData={getListFullData('dataSources')}
              fullDataGetter={() => getListFullData('dataSources')}
              changeId={useCase?.id ? `usecase-dataSources-${useCase.id}` : ''}
              originalValue={arrayToMarkdown(listOriginals.dataSources) || ''}
              references={getReferences()}
              on:change={(e) => setListBuffer('dataSources', markdownToArray(e.detail.value))}
              on:saved={handleFieldSaved}
            />
          </div>
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
        {#if isPrinting}
          <ul 
            class="space-y-2"
            style={dataObjectsScaleFactor < 1 ? `font-size: ${dataObjectsScaleFactor}em; line-height: ${Math.max(1.2, dataObjectsScaleFactor * 1.5)}em;` : ''}
          >
            {#each parsedDataObjects as data}
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
                <span>{@html data}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="text-sm text-slate-600">
            <EditableInput
              label=""
              value={listMarkdowns.dataObjects || ''}
              markdown={true}
              forceList={true}
              apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
              fullData={getListFullData('dataObjects')}
              fullDataGetter={() => getListFullData('dataObjects')}
              changeId={useCase?.id ? `usecase-dataObjects-${useCase.id}` : ''}
              originalValue={arrayToMarkdown(listOriginals.dataObjects) || ''}
              references={getReferences()}
              on:change={(e) => setListBuffer('dataObjects', markdownToArray(e.detail.value))}
              on:saved={handleFieldSaved}
            />
          </div>
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
      {#if isPrinting}
        <ul class="space-y-2">
          {#each parsedNextSteps as step}
            <li class="flex items-start gap-2 text-sm text-slate-600">
              <span class="text-purple-500 mt-1">•</span>
              <span>{@html step}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="text-sm text-slate-600">
          <EditableInput
            label=""
            value={listMarkdowns.nextSteps || ''}
            markdown={true}
            forceList={true}
            apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
            fullData={getListFullData('nextSteps')}
            fullDataGetter={() => getListFullData('nextSteps')}
            changeId={useCase?.id ? `usecase-nextSteps-${useCase.id}` : ''}
            originalValue={arrayToMarkdown(listOriginals.nextSteps) || ''}
            references={getReferences()}
            on:change={(e) => setListBuffer('nextSteps', markdownToArray(e.detail.value))}
            on:saved={handleFieldSaved}
          />
        </div>
      {/if}
    </div>

    <!-- Références (désormais en 1/3, sous Données) -->
    {#if !isEditing && getReferences().length > 0}
      <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
          <h3 class="font-semibold flex items-center gap-2">
            Références
          </h3>
        </div>
        <References references={getReferences()} {referencesScaleFactor} />
      </div>
    {/if}

    {#if matrix && (useCase?.data?.valueScores || useCase?.valueScores) && (useCase?.data?.complexityScores || useCase?.complexityScores) && !isEditing}
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
            {@const allValueScores = useCase?.data?.valueScores || useCase?.valueScores || []}
            {@const score = allValueScores.find((s: any) => s.axisId === axis.id)}
            {@const parsedScore = parsedValueScores.find((s) => s.axisId === axis.id)}
            {#if score}
              {@const stars = scoreToStars(Number(score.rating))}
              {@const key = `value-${axis.id}`}
              {@const bufferValue = scoreBuffers[key] !== undefined ? scoreBuffers[key] : (score.description || '')}
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
                {#if isPrinting}
                  <p class="text-sm text-slate-600">{@html parsedScore?.description || ''}</p>
                {:else}
                  <div class="text-sm text-slate-600 leading-relaxed prose prose-sm max-w-none">
                    <EditableInput
                      label=""
                      value={bufferValue}
                      markdown={true}
                      apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                      fullData={getScoreFullData('value', axis.id)}
                      fullDataGetter={() => getScoreFullData('value', axis.id)}
                      changeId={useCase?.id ? `usecase-valueScore-${axis.id}-${useCase.id}` : ''}
                      originalValue={scoreOriginals[key] || ''}
                      references={getReferences()}
                      on:change={(e) => setScoreBuffer('value', axis.id, e.detail.value)}
                      on:saved={handleScoreSaved}
                    />
                  </div>
                {/if}
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
            {@const allComplexityScores = useCase?.data?.complexityScores || useCase?.complexityScores || []}
            {@const score = allComplexityScores.find((s: any) => s.axisId === axis.id)}
            {@const parsedScore = parsedComplexityScores.find((s) => s.axisId === axis.id)}
            {#if score}
              {@const stars = scoreToStars(Number(score.rating))}
              {@const key = `complexity-${axis.id}`}
              {@const bufferValue = scoreBuffers[key] !== undefined ? scoreBuffers[key] : (score.description || '')}
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
                {#if isPrinting}
                  <p class="text-sm text-slate-600">{@html parsedScore?.description || ''}</p>
                {:else}
                  <div class="text-sm text-slate-600 leading-relaxed prose prose-sm max-w-none">
                    <EditableInput
                      label=""
                      value={bufferValue}
                      markdown={true}
                      apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                      fullData={getScoreFullData('complexity', axis.id)}
                      fullDataGetter={() => getScoreFullData('complexity', axis.id)}
                      changeId={useCase?.id ? `usecase-complexityScore-${axis.id}-${useCase.id}` : ''}
                      originalValue={scoreOriginals[key] || ''}
                      references={getReferences()}
                      on:change={(e) => setScoreBuffer('complexity', axis.id, e.detail.value)}
                      on:saved={handleScoreSaved}
                    />
                  </div>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      </div>
    {/if}
  </div>
  </div>
{/if}
