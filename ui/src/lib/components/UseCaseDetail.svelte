<script lang="ts">
  /* eslint-disable svelte/no-at-html-tags */
  // Tous les usages de {@html} dans ce fichier passent par renderMarkdownWithRefs() ou parseReferencesInText()
  // qui sanitize automatiquement le HTML avec DOMPurify pour protéger contre les attaques XSS
  
  import References from '$lib/components/References.svelte';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import CommentBadge from '$lib/components/CommentBadge.svelte';
  import type { OpenCommentsHandler } from '$lib/types/comments';
  import { scoreToStars } from '$lib/utils/scoring';
  import type { MatrixConfig } from '$lib/types/matrix';
  import { onMount } from 'svelte';
  import { apiGet } from '$lib/utils/api';
  import { useCasesStore } from '$lib/stores/useCases';
  import { goto } from '$app/navigation';
  import { arrayToMarkdown, markdownToArray, normalizeUseCaseMarkdown, stripTrailingEmptyParagraph, renderMarkdownWithRefs, parseReferencesInText } from '$lib/utils/markdown';
  import {
    CheckCircle2,
    AlertTriangle,
    Clock,
    FileText,
    Lightbulb,
    TrendingUp,
    BarChart3,
    Info,
    Monitor,
    Database,
    Check,
    ClipboardList,
    X,
    Minus,
    Star
  } from '@lucide/svelte';

  export let useCase: any;
  export let matrix: MatrixConfig | null = null;
  export let calculatedScores: any = null;
  export let isEditing: boolean = false;
  export let organizationId: string | null = null;
  export let organizationName: string | null = null;
  export let locked: boolean = false;
  export let commentCounts: Record<string, number> | null = null;
  export let onOpenComments: OpenCommentsHandler | null = null;

  // Helper to create array of indices for iteration
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

  const openComments = (sectionKey: string) => {
    if (onOpenComments) onOpenComments(sectionKey);
  };

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

// Buffer pour le nom/titre du usecase (texte simple, pas markdown)
let nameBuffer = '';
let nameOriginal = '';

interface ScoreEntry {
  axisId: string;
  rating: number;
  description?: string;
}

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
    // Pour description, problem, solution : chercher dans data d'abord
    if (field === 'description' || field === 'problem' || field === 'solution') {
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

  // Extraire le nom (avec fallback pour rétrocompatibilité)
  const useCaseName = useCase?.data?.name || useCase?.name || 'Cas d\'usage sans nom';

  if (useCase.id !== lastUseCaseId) {
    lastUseCaseId = useCase.id;
    textBuffers = { ...normalizedValues };
    textOriginals = { ...normalizedValues };
    listBuffers = { ...listValues };
    listOriginals = { ...listValues };
    scoreBuffers = { ...scoreValues };
    scoreOriginals = { ...scoreValues };
    nameBuffer = useCaseName;
    nameOriginal = useCaseName;
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
    
    // Mettre à jour le buffer de nom si nécessaire
    if (useCaseName !== nameOriginal) {
      nameBuffer = useCaseName;
      nameOriginal = useCaseName;
      changed = true;
    }

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
const getNameFullData = () => {
  if (!useCase?.id) return null;
  // Le nom est stocké dans data.name (pas au niveau racine)
  return { name: nameBuffer || 'Cas d\'usage sans nom' };
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

  // Références (réactif): nécessaire pour que la section "Références" se mette à jour
  // quand useCase.data.references change via SSE (sans Ctrl+R).
  let references = [];
  $: references = useCase?.data?.references || useCase?.references || [];
  $: showReferences = !isEditing && references.length > 0;

  // Fonction pour obtenir le HTML de la description avec références parsées
$: descriptionHtml = (useCase?.data?.description || useCase?.description)
  ? renderMarkdownWithRefs(
      useCase.data?.description || useCase.description || '',
      references,
      { addListStyles: true, listPadding: 1.5 }
    )
  : '';
  
$: problemHtml = (useCase?.data?.problem || useCase?.problem)
  ? renderMarkdownWithRefs(
      useCase.data?.problem || useCase.problem || '',
      references,
      { addListStyles: true, listPadding: 1.5 }
    )
  : '';
  
$: solutionHtml = (useCase?.data?.solution || useCase?.solution)
  ? renderMarkdownWithRefs(
      useCase.data?.solution || useCase.solution || '',
      references,
      { addListStyles: true, listPadding: 1.5 }
    )
  : '';

  // Fonctions réactives pour parser les autres champs (extraire depuis data)
  $: parsedBenefits = (useCase?.data?.benefits || useCase?.benefits)
    ? (useCase.data?.benefits || useCase.benefits || []).map((benefit: string) => renderMarkdownWithRefs(benefit, references, { addListStyles: true, listPadding: 1.5 }))
    : [];
  
  $: parsedMetrics = (useCase?.data?.metrics || useCase?.metrics)
    ? (useCase.data?.metrics || useCase.metrics || []).map((metric: string) => renderMarkdownWithRefs(metric, references, { addListStyles: true, listPadding: 1.5 }))
    : [];
  
  $: parsedRisks = (useCase?.data?.risks || useCase?.risks)
    ? (useCase.data?.risks || useCase.risks || []).map((risk: string) => renderMarkdownWithRefs(risk, references, { addListStyles: true, listPadding: 1.5 }))
    : [];
  
  $: parsedTechnologies = (useCase?.data?.technologies || useCase?.technologies)
    ? (useCase.data?.technologies || useCase.technologies || []).map((tech: string) => renderMarkdownWithRefs(tech, references, { addListStyles: true, listPadding: 1.5 }))
    : [];
  
  $: parsedDataSources = (useCase?.data?.dataSources || useCase?.dataSources)
    ? (useCase.data?.dataSources || useCase.dataSources || []).map((source: string) => renderMarkdownWithRefs(source, references, { addListStyles: true, listPadding: 1.5 }))
    : [];
  
  $: parsedDataObjects = (useCase?.data?.dataObjects || useCase?.dataObjects)
    ? (useCase.data?.dataObjects || useCase.dataObjects || []).map((data: string) => renderMarkdownWithRefs(data, references, { addListStyles: true, listPadding: 1.5 }))
    : [];

  $: parsedNextSteps = (useCase?.data?.nextSteps || useCase?.nextSteps)
    ? (useCase.data?.nextSteps || useCase.nextSteps || []).map((step: string) => parseReferencesInText(step, references))
    : [];

  // Parser les justifications des axes valeur et complexité avec buffers (extraire depuis data)
  $: parsedValueScores = (useCase?.data?.valueScores || useCase?.valueScores) && matrix
    ? (useCase.data?.valueScores || useCase.valueScores || []).map((score: any) => {
        const key = `value-${score.axisId}`;
        const description = scoreBuffers[key] !== undefined ? scoreBuffers[key] : (score.description || '');
        return {
          ...score,
          description: renderMarkdownWithRefs(description, references, { addListStyles: true, listPadding: 1.5 })
        };
      })
    : [];

  $: parsedComplexityScores = (useCase?.data?.complexityScores || useCase?.complexityScores) && matrix
    ? (useCase.data?.complexityScores || useCase.complexityScores || []).map((score: any) => {
        const key = `complexity-${score.axisId}`;
        const description = scoreBuffers[key] !== undefined ? scoreBuffers[key] : (score.description || '');
        return {
          ...score,
          description: renderMarkdownWithRefs(description, references, { addListStyles: true, listPadding: 1.5 })
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
  $: referencesScaleFactor = (references.length > 8 && isPrinting)
    ? 10 / references.length
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
    <div class="grid grid-cols-12 gap-4 items-center print:grid-cols-1">
      <!-- Titre sur 2 colonnes (8/12) -->
      <div class="col-span-8 print:col-span-1 min-w-0">
        {#if isPrinting}
          <h1 class="text-3xl font-semibold break-words">
            {nameBuffer || useCase?.data?.name || useCase?.name || 'Cas d\'usage sans nom'}
          </h1>
        {:else}
          <h1 class="text-3xl font-semibold break-words mb-0">
            <EditableInput
              locked={locked}
              label=""
              value={nameBuffer || useCase?.data?.name || useCase?.name || 'Cas d\'usage sans nom'}
              markdown={false}
              multiline={true}
              apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
              fullData={getNameFullData()}
              fullDataGetter={getNameFullData as any}
              changeId={useCase?.id ? `usecase-name-${useCase.id}` : ''}
              originalValue={nameOriginal || ''}
              on:change={(e) => {
                nameBuffer = e.detail.value;
              }}
              on:saved={handleFieldSaved}
            />
          </h1>
        {/if}
      </div>
      
      <!-- Badge + Boutons sur 1 colonne (4/12) -->
      {#if showActions}
        <div class="col-span-4 print:col-span-1 flex items-center justify-end gap-2 no-print">
          {#if organizationId}
            <button
              type="button"
              class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
              on:click={() => goto(`/organisations/${organizationId}`)}
              title="Voir l'organisation"
            >
              {organizationName || 'Organisation'}
            </button>
          {/if}
          {#if useCase.model}
            <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
              {useCase.model}
            </span>
          {/if}
          <div class="flex gap-2">
          <slot name="actions-view" />
          </div>
        </div>
      {:else if organizationId || useCase.model}
        <!-- En mode print, afficher les badges si présents -->
        <div class="col-span-4 print:col-span-1 flex items-center justify-end">
          {#if organizationId}
            <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-indigo-100 text-indigo-700">
              {organizationName || 'Organisation'}
            </span>
          {/if}
          {#if useCase.model}
            <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
              {useCase.model}
            </span>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Scores et Infos -->
    <div class="grid gap-6 lg:grid-cols-3 layout-head">
      {#if totalValueScore !== null && totalValueScore !== undefined}
        <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div class="bg-green-100 text-green-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
            <h3 class="font-semibold flex items-center gap-2">
              <CheckCircle2 class="w-5 h-5" />
              Valeur calculée
            </h3>
          </div>
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-1">
              {#each range(5) as i (i)}
                <Star class="w-6 h-6 {i < valueStars ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}" />
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
              <AlertTriangle class="w-5 h-5" />
              Complexité calculée
            </h3>
          </div>
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-1">
              {#each range(5) as i (i)}
                {#if i < complexityStars}
                  <X class="w-6 h-6 text-red-500" />
                {:else}
                  <Minus class="w-6 h-6 text-gray-300" />
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
      <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-comment-section="deadline">
        <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
          <h3 class="font-semibold flex items-center gap-2 group">
            <Clock class="w-5 h-5 text-slate-500" />
            Délai
            <CommentBadge
              count={commentCounts?.deadline ?? 0}
              disabled={!onOpenComments}
              on:click={() => openComments('deadline')}
            />
          </h3>
        </div>
        {#if isPrinting}
          <div class="text-slate-600 text-sm leading-relaxed prose prose-sm max-w-none">
            {#if useCase?.data?.deadline || useCase?.deadline}
              {@html renderMarkdownWithRefs(useCase?.data?.deadline || useCase?.deadline || '', references)}
            {/if}
          </div>
        {:else}
          <div class="text-slate-600 text-sm leading-relaxed prose prose-sm max-w-none">
            <EditableInput
              locked={locked}
              label=""
              value={textBuffers.deadline || ''}
              markdown={true}
              apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
              fullData={getTextFullData('deadline')}
              fullDataGetter={(() => getTextFullData('deadline')) as any}
              changeId={useCase?.id ? `usecase-deadline-${useCase.id}` : ''}
              originalValue={textOriginals.deadline || ''}
                  references={references}
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
        <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-comment-section="description">
          <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
            <h3 class="font-semibold flex items-center gap-2 group">
              <FileText class="w-5 h-5 text-slate-500" />
              Description
              <CommentBadge
                count={commentCounts?.description ?? 0}
                disabled={!onOpenComments}
                on:click={() => openComments('description')}
              />
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
                  locked={locked}
                  label=""
                  value={textBuffers.description || ''}
                  markdown={true}
                  apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                  fullData={getTextFullData('description')}
                  fullDataGetter={(() => getTextFullData('description')) as any}
                  changeId={useCase?.id ? `usecase-description-${useCase.id}` : ''}
                  originalValue={textOriginals.description || ''}
                  references={references}
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
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-comment-section="problem">
            <div class="bg-orange-100 text-orange-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
              <h3 class="font-semibold flex items-center gap-2 group">
                <AlertTriangle class="w-5 h-5" />
                Problème
                <CommentBadge
                  count={commentCounts?.problem ?? 0}
                  disabled={!onOpenComments}
                  on:click={() => openComments('problem')}
                />
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
                    locked={locked}
                    label=""
                    value={textBuffers.problem || ''}
                    markdown={true}
                    apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                    fullData={getTextFullData('problem')}
                    fullDataGetter={(() => getTextFullData('problem')) as any}
                    changeId={useCase?.id ? `usecase-problem-${useCase.id}` : ''}
                    originalValue={textOriginals.problem || ''}
                    references={references}
                    on:change={(e) => setTextBuffer('problem', e.detail.value)}
                    on:saved={handleFieldSaved}
                  />
                </div>
              </div>
            {/if}
          </div>

          <!-- Solution -->
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-comment-section="solution">
            <div class="bg-blue-100 text-blue-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
              <h3 class="font-semibold flex items-center gap-2 group">
                <Lightbulb class="w-5 h-5" />
                Solution
                <CommentBadge
                  count={commentCounts?.solution ?? 0}
                  disabled={!onOpenComments}
                  on:click={() => openComments('solution')}
                />
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
                    locked={locked}
                    label=""
                    value={textBuffers.solution || ''}
                    markdown={true}
                    apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                    fullData={getTextFullData('solution')}
                    fullDataGetter={(() => getTextFullData('solution')) as any}
                    changeId={useCase?.id ? `usecase-solution-${useCase.id}` : ''}
                    originalValue={textOriginals.solution || ''}
                    references={references}
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
        <div class="grid gap-6 lg:grid-cols-2 lg:col-span-2">
          <!-- Bénéfices -->
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-comment-section="benefits">
            <div class="bg-green-100 text-green-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
              <h3 class="font-semibold flex items-center gap-2 group">
                <TrendingUp class="w-5 h-5" />
                Bénéfices recherchés
                <CommentBadge
                  count={commentCounts?.benefits ?? 0}
                  disabled={!onOpenComments}
                  on:click={() => openComments('benefits')}
                />
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
                  locked={locked}
                  label=""
                  value={listMarkdowns.benefits || ''}
                  markdown={true}
                  forceList={true}
                  apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                  fullData={getListFullData('benefits')}
                  fullDataGetter={(() => getListFullData('benefits')) as any}
                  changeId={useCase?.id ? `usecase-benefits-${useCase.id}` : ''}
                  originalValue={arrayToMarkdown(listOriginals.benefits) || ''}
                  references={references}
                  on:change={(e) => setListBuffer('benefits', markdownToArray(e.detail.value))}
                  on:saved={handleFieldSaved}
                />
              </div>
            {/if}
          </div>

          <!-- Colonne 2 : Risques + Mesures du succès (empilés verticalement) -->
          <div class="space-y-6">
            <!-- Risques -->
            <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-comment-section="risks">
              <div class="bg-red-100 text-red-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
                <h3 class="font-semibold flex items-center gap-2 group">
                  <AlertTriangle class="w-5 h-5" />
                  Risques
                  <CommentBadge
                    count={commentCounts?.risks ?? 0}
                    disabled={!onOpenComments}
                    on:click={() => openComments('risks')}
                  />
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
                    locked={locked}
                    label=""
                    value={listMarkdowns.risks || ''}
                    markdown={true}
                    forceList={true}
                    apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                    fullData={getListFullData('risks')}
                    fullDataGetter={(() => getListFullData('risks')) as any}
                    changeId={useCase?.id ? `usecase-risks-${useCase.id}` : ''}
                    originalValue={arrayToMarkdown(listOriginals.risks) || ''}
                    references={references}
                    on:change={(e) => setListBuffer('risks', markdownToArray(e.detail.value))}
                    on:saved={handleFieldSaved}
                  />
                </div>
              {/if}
            </div>

            <!-- Mesures du succès -->
            <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-comment-section="metrics">
              <div class="bg-blue-100 text-blue-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
                <h3 class="font-semibold flex items-center gap-2 group">
                  <BarChart3 class="w-5 h-5" />
                  Mesures du succès
                  <CommentBadge
                    count={commentCounts?.metrics ?? 0}
                    disabled={!onOpenComments}
                    on:click={() => openComments('metrics')}
                  />
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
                    locked={locked}
                    label=""
                    value={listMarkdowns.metrics || ''}
                    markdown={true}
                    forceList={true}
                    apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                    fullData={getListFullData('metrics')}
                    fullDataGetter={(() => getListFullData('metrics')) as any}
                    changeId={useCase?.id ? `usecase-metrics-${useCase.id}` : ''}
                    originalValue={arrayToMarkdown(listOriginals.metrics) || ''}
                    references={references}
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
      <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-comment-section="contact">
        <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
          <h3 class="font-semibold flex items-center gap-2 group">
            <Info class="w-5 h-5 text-slate-500" />
            Informations
            <CommentBadge
              count={commentCounts?.contact ?? 0}
              disabled={!onOpenComments}
              on:click={() => openComments('contact')}
            />
          </h3>
        </div>
        <div class="space-y-3">
          <div class="flex items-start gap-2">
            <span class="font-medium text-slate-700 mt-1">Contact:</span>
            {#if isPrinting}
              <div class="text-slate-600 text-sm leading-relaxed prose prose-sm max-w-none">
                {@html (useCase?.data?.contact || useCase?.contact) ? renderMarkdownWithRefs(useCase?.data?.contact || useCase?.contact || '', references) : ''}
              </div>
            {:else}
              <span class="flex-1 text-slate-600 text-sm">
                <EditableInput
                  locked={locked}
                  label=""
                  value={textBuffers.contact || ''}
                  markdown={true}
                  apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                  fullData={getTextFullData('contact')}
                  fullDataGetter={(() => getTextFullData('contact')) as any}
                  changeId={useCase?.id ? `usecase-contact-${useCase.id}` : ''}
                  originalValue={textOriginals.contact || ''}
                  references={references}
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
        <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-comment-section="technologies">
          <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
            <h3 class="font-semibold flex items-center gap-2 group">
              <Monitor class="w-5 h-5 text-slate-500" />
              Technologies
              <CommentBadge
                count={commentCounts?.technologies ?? 0}
                disabled={!onOpenComments}
                on:click={() => openComments('technologies')}
              />
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
                locked={locked}
                label=""
                value={listMarkdowns.technologies || ''}
                markdown={true}
                forceList={true}
                apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                fullData={getListFullData('technologies')}
                fullDataGetter={(() => getListFullData('technologies')) as any}
                changeId={useCase?.id ? `usecase-technologies-${useCase.id}` : ''}
                originalValue={arrayToMarkdown(listOriginals.technologies) || ''}
                references={references}
                on:change={(e) => setListBuffer('technologies', markdownToArray(e.detail.value))}
                on:saved={handleFieldSaved}
              />
            </div>
          {/if}
        </div>
      {/if}

      <!-- Sources -->
      <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-comment-section="dataSources">
        <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
          <h3 class="font-semibold flex items-center gap-2 group">
            <Database class="w-5 h-5 text-slate-500" />
            Sources des données
            <CommentBadge
              count={commentCounts?.dataSources ?? 0}
              disabled={!onOpenComments}
              on:click={() => openComments('dataSources')}
            />
          </h3>
        </div>
        {#if isPrinting}
          <ul 
            class="space-y-2"
            style={dataSourcesScaleFactor < 1 ? `font-size: ${dataSourcesScaleFactor}em; line-height: ${Math.max(1.2, dataSourcesScaleFactor * 1.5)}em;` : ''}
          >
            {#each parsedDataSources as source}
              <li class="flex items-start gap-2 text-sm text-slate-600">
                <Check 
                  class="w-4 h-4 text-blue-500 mt-0.5" 
                  style={dataSourcesScaleFactor < 1 ? `width: ${dataSourcesScaleFactor * 1}em !important; height: ${dataSourcesScaleFactor * 1}em !important;` : ''}
                />
                <span>{@html source}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="text-sm text-slate-600">
            <EditableInput
              locked={locked}
              label=""
              value={listMarkdowns.dataSources || ''}
              markdown={true}
              forceList={true}
              apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
              fullData={getListFullData('dataSources')}
              fullDataGetter={(() => getListFullData('dataSources')) as any}
              changeId={useCase?.id ? `usecase-dataSources-${useCase.id}` : ''}
              originalValue={arrayToMarkdown(listOriginals.dataSources) || ''}
              references={references}
              on:change={(e) => setListBuffer('dataSources', markdownToArray(e.detail.value))}
              on:saved={handleFieldSaved}
            />
          </div>
        {/if}
      </div>

      <!-- Données liées -->
      <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-comment-section="dataObjects">
        <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
          <h3 class="font-semibold flex items-center gap-2">
            <Database class="w-5 h-5 text-slate-500" />
            Données
            <CommentBadge
              count={commentCounts?.dataObjects ?? 0}
              disabled={!onOpenComments}
              on:click={() => openComments('dataObjects')}
            />
          </h3>
        </div>
        {#if isPrinting}
          <ul 
            class="space-y-2"
            style={dataObjectsScaleFactor < 1 ? `font-size: ${dataObjectsScaleFactor}em; line-height: ${Math.max(1.2, dataObjectsScaleFactor * 1.5)}em;` : ''}
          >
            {#each parsedDataObjects as data}
              <li class="flex items-start gap-2 text-sm text-slate-600">
                <Database 
                  class="w-4 h-4 text-blue-500 mt-0.5" 
                  style={dataObjectsScaleFactor < 1 ? `width: ${dataObjectsScaleFactor * 1}em !important; height: ${dataObjectsScaleFactor * 1}em !important;` : ''}
                />
                <span>{@html data}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="text-sm text-slate-600">
            <EditableInput
              locked={locked}
              label=""
              value={listMarkdowns.dataObjects || ''}
              markdown={true}
              forceList={true}
              apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
              fullData={getListFullData('dataObjects')}
              fullDataGetter={(() => getListFullData('dataObjects')) as any}
              changeId={useCase?.id ? `usecase-dataObjects-${useCase.id}` : ''}
              originalValue={arrayToMarkdown(listOriginals.dataObjects) || ''}
              references={references}
              on:change={(e) => setListBuffer('dataObjects', markdownToArray(e.detail.value))}
              on:saved={handleFieldSaved}
            />
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Matrice détaillée en 2 colonnes séparées -->
  <div class={`grid gap-6 md:grid-cols-2 layout-bottom ${showReferences ? '' : 'no-references'}`}>
    <!-- Prochaines étapes -->
    <div class={`layout-bottom-nextsteps rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${showReferences ? '' : 'md:col-span-2'}`} data-comment-section="nextSteps">
      <div class="bg-purple-100 text-purple-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
        <h3 class="font-semibold flex items-center gap-2 group">
          <ClipboardList class="w-5 h-5" />
          Prochaines étapes
          <CommentBadge
            count={commentCounts?.nextSteps ?? 0}
            disabled={!onOpenComments}
            on:click={() => openComments('nextSteps')}
          />
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
            locked={locked}
            label=""
            value={listMarkdowns.nextSteps || ''}
            markdown={true}
            forceList={true}
            apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
            fullData={getListFullData('nextSteps')}
            fullDataGetter={(() => getListFullData('nextSteps')) as any}
            changeId={useCase?.id ? `usecase-nextSteps-${useCase.id}` : ''}
            originalValue={arrayToMarkdown(listOriginals.nextSteps) || ''}
            references={references}
            on:change={(e) => setListBuffer('nextSteps', markdownToArray(e.detail.value))}
            on:saved={handleFieldSaved}
          />
        </div>
      {/if}
    </div>

    <!-- Références (désormais en 1/3, sous Données) -->
    {#if showReferences}
      <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-comment-section="references">
        <div class="bg-white text-slate-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4 border-b border-slate-200">
          <h3 class="font-semibold flex items-center gap-2 group">
            Références
            <CommentBadge
              count={commentCounts?.references ?? 0}
              disabled={!onOpenComments}
              on:click={() => openComments('references')}
            />
          </h3>
        </div>
        <References references={references} {referencesScaleFactor} />
      </div>
    {/if}

    {#if matrix && (useCase?.data?.valueScores || useCase?.valueScores) && (useCase?.data?.complexityScores || useCase?.complexityScores) && !isEditing}
      <!-- Axes de Valeur -->
      <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div class="bg-green-100 text-green-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
          <h3 class="font-semibold flex items-center gap-2">
            <CheckCircle2 class="w-5 h-5" />
            Axes de Valeur
          </h3>
        </div>
        <div class="space-y-4">
          {#each matrix.valueAxes as axis}
            {@const allValueScores = useCase?.data?.valueScores || useCase?.valueScores || []}
            {@const score = allValueScores.find((s: any) => s.axisId === axis.id)}
            {@const parsedScore = parsedValueScores.find((s: ScoreEntry) => s.axisId === axis.id)}
            {#if score}
              {@const stars = scoreToStars(Number(score.rating))}
              {@const key = `value-${axis.id}`}
              {@const bufferValue = scoreBuffers[key] !== undefined ? scoreBuffers[key] : (score.description || '')}
              <div class="rounded border border-slate-200 bg-white p-3">
                <div class="flex items-center justify-between mb-2">
                  <h5 class="font-medium text-slate-900">{axis.name}</h5>
                  <div class="flex items-center gap-2">
                    <div class="flex items-center gap-1">
                      {#each range(5) as i (i)}
                        <Star class="w-4 h-4 {i < stars ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}" />
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
                      locked={locked}
                      label=""
                      value={bufferValue}
                      markdown={true}
                      apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                      fullData={getScoreFullData('value', axis.id)}
                      fullDataGetter={(() => getScoreFullData('value', axis.id)) as any}
                      changeId={useCase?.id ? `usecase-valueScore-${axis.id}-${useCase.id}` : ''}
                      originalValue={scoreOriginals[key] || ''}
                      references={references}
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
            <AlertTriangle class="w-5 h-5" />
            Axes de Complexité
          </h3>
        </div>
        <div class="space-y-4">
          {#each matrix.complexityAxes as axis}
            {@const allComplexityScores = useCase?.data?.complexityScores || useCase?.complexityScores || []}
            {@const score = allComplexityScores.find((s: any) => s.axisId === axis.id)}
            {@const parsedScore = parsedComplexityScores.find((s: ScoreEntry) => s.axisId === axis.id)}
            {#if score}
              {@const stars = scoreToStars(Number(score.rating))}
              {@const key = `complexity-${axis.id}`}
              {@const bufferValue = scoreBuffers[key] !== undefined ? scoreBuffers[key] : (score.description || '')}
              <div class="rounded border border-slate-200 bg-white p-3">
                <div class="flex items-center justify-between mb-2">
                  <h5 class="font-medium text-slate-900">{axis.name}</h5>
                  <div class="flex items-center gap-2">
                    <div class="flex items-center gap-1">
                      {#each range(5) as i (i)}
                        {#if i < stars}
                          <X class="w-4 h-4 text-red-500" />
                        {:else}
                          <Minus class="w-4 h-4 text-gray-300" />
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
                      locked={locked}
                      label=""
                      value={bufferValue}
                      markdown={true}
                      apiEndpoint={useCase?.id ? `/use-cases/${useCase.id}` : ''}
                      fullData={getScoreFullData('complexity', axis.id)}
                      fullDataGetter={(() => getScoreFullData('complexity', axis.id)) as any}
                      changeId={useCase?.id ? `usecase-complexityScore-${axis.id}-${useCase.id}` : ''}
                      originalValue={scoreOriginals[key] || ''}
                      references={references}
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
