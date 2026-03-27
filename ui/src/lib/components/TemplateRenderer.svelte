<script lang="ts">
  /* eslint-disable svelte/no-at-html-tags */
  // {@html} usage routed through renderMarkdownWithRefs(), sanitised via DOMPurify.
  import FieldCard from '$lib/components/FieldCard.svelte';
  import ScoreTable from '$lib/components/ScoreTable.svelte';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import { Star, X, Minus, CheckCircle2, AlertTriangle } from '@lucide/svelte';
  import { _ } from 'svelte-i18n';
  import { normalizeUseCaseMarkdown, stripTrailingEmptyParagraph, arrayToMarkdown, arrayToNumberedMarkdown, markdownToArray, renderMarkdownWithRefs } from '$lib/utils/markdown';

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------
  export let template: any;
  export let data: any = {};
  export let locked: boolean = false;
  export let apiEndpoint: string = '';
  export let commentCounts: Record<string, number> = {};
  export let onOpenComments: ((section: string) => void) | null = null;
  export let references: Array<{ title: string; url: string; excerpt?: string }> = [];
  export let matrix: any = null;
  export let calculatedScores: any = null;
  export let entityId: string = '';
  export let onFieldSaved: (() => void) | null = null;
  export let isPrinting: boolean = false;

  // Active tab tracking
  let activeTabKey: string | null = null;

  $: tabs = template?.tabs ?? [];
  $: {
    if (tabs.length > 0 && !activeTabKey) {
      activeTabKey = tabs[0].key;
    }
  }

  $: visibleTabs = tabs.filter((tab: any) => {
    if (tab.always) return true;
    if (tab.showWhen) return evaluateShowWhen(tab.showWhen);
    return true;
  });

  $: singleFlatTab = tabs.length === 1 && tabs[0].always;
  $: activeTab = visibleTabs.find((t: any) => t.key === activeTabKey) ?? visibleTabs[0] ?? null;

  const evaluateShowWhen = (condition: string): boolean => {
    if (condition === 'hasSolutions') return (data?.solutions?.length ?? 0) > 0;
    if (condition === 'hasProposals') return (data?.proposals?.length ?? 0) > 0;
    return false;
  };

  // ---------------------------------------------------------------------------
  // Collaborative editing buffers (text, list, score)
  // Pattern: buffers hold the local editing state, originals hold the last
  // known server value. On SSE updates (data changes), we merge: if the server
  // value changed and the local user hasn't edited the field (buffer === original),
  // we update both buffer and original. If the user has local edits, we only
  // update the original so the unsaved indicator works.
  // ---------------------------------------------------------------------------
  let textBuffers: Record<string, string> = {};
  let textOriginals: Record<string, string> = {};
  let listBuffers: Record<string, string[]> = {};
  let listOriginals: Record<string, string[]> = {};
  let scoreBuffers: Record<string, string> = {};
  let scoreOriginals: Record<string, string> = {};
  let lastEntityId: string | null = null;

  // Collect all field descriptors from template (flattened)
  const collectFields = (tmpl: any): any[] => {
    if (!tmpl?.tabs) return [];
    const fields: any[] = [];
    for (const tab of tmpl.tabs) {
      for (const row of (tab.rows ?? [])) {
        if (row.main) {
          for (const f of (row.main.fields ?? [])) fields.push(f);
        }
        if (row.sidebar) {
          for (const f of (row.sidebar.fields ?? [])) fields.push(f);
        }
        for (const f of (row.fields ?? [])) fields.push(f);
      }
    }
    return fields;
  };

  // Reactive sync block — runs when data or entityId changes (SSE updates)
  $: if (data && entityId) {
    const allFields = collectFields(template);

    // Compute incoming normalized values
    const incomingText: Record<string, string> = {};
    const incomingList: Record<string, string[]> = {};
    for (const f of allFields) {
      if (f.type === 'text') {
        incomingText[f.key] = normalizeUseCaseMarkdown(data?.[f.key] || '');
      } else if (f.type === 'list') {
        incomingList[f.key] = Array.isArray(data?.[f.key]) ? [...data[f.key]] : [];
      }
    }

    // Incoming score values
    const incomingScores: Record<string, string> = {};
    for (const score of (data?.valueScores ?? [])) {
      incomingScores[`value-${score.axisId}`] = normalizeUseCaseMarkdown(score.description || '');
    }
    for (const score of (data?.complexityScores ?? [])) {
      incomingScores[`complexity-${score.axisId}`] = normalizeUseCaseMarkdown(score.description || '');
    }

    if (entityId !== lastEntityId) {
      // New entity — full init
      lastEntityId = entityId;
      textBuffers = { ...incomingText };
      textOriginals = { ...incomingText };
      listBuffers = { ...incomingList };
      listOriginals = { ...incomingList };
      scoreBuffers = { ...incomingScores };
      scoreOriginals = { ...incomingScores };
    } else {
      // Same entity — merge SSE updates
      let changed = false;
      const updatedTextBuffers = { ...textBuffers };
      const updatedTextOriginals = { ...textOriginals };
      const updatedListBuffers = { ...listBuffers };
      const updatedListOriginals = { ...listOriginals };
      const updatedScoreBuffers = { ...scoreBuffers };
      const updatedScoreOriginals = { ...scoreOriginals };

      // Text fields
      for (const key of Object.keys(incomingText)) {
        if (incomingText[key] !== textOriginals[key]) {
          // Server value changed — update original; update buffer only if not locally edited
          if (textBuffers[key] === textOriginals[key]) {
            updatedTextBuffers[key] = incomingText[key];
          }
          updatedTextOriginals[key] = incomingText[key];
          changed = true;
        }
      }

      // List fields
      for (const key of Object.keys(incomingList)) {
        if (JSON.stringify(incomingList[key]) !== JSON.stringify(listOriginals[key])) {
          if (JSON.stringify(listBuffers[key]) === JSON.stringify(listOriginals[key])) {
            updatedListBuffers[key] = [...incomingList[key]];
          }
          updatedListOriginals[key] = [...incomingList[key]];
          changed = true;
        }
      }

      // Score fields
      for (const key of Object.keys(incomingScores)) {
        if (incomingScores[key] !== scoreOriginals[key]) {
          if (scoreBuffers[key] === scoreOriginals[key]) {
            updatedScoreBuffers[key] = incomingScores[key];
          }
          updatedScoreOriginals[key] = incomingScores[key];
          changed = true;
        }
      }

      if (changed) {
        textBuffers = updatedTextBuffers;
        textOriginals = updatedTextOriginals;
        listBuffers = updatedListBuffers;
        listOriginals = updatedListOriginals;
        scoreBuffers = updatedScoreBuffers;
        scoreOriginals = updatedScoreOriginals;
      }
    }
  }

  // Reactive list markdowns derived from list buffers
  $: listMarkdowns = Object.keys(listBuffers).reduce<Record<string, string>>((acc, key) => {
    acc[key] = arrayToMarkdown(listBuffers[key] ?? []);
    return acc;
  }, {});

  // Reactive field value getter — reads from buffers (not raw data)
  $: getFieldValue = (key: string): any => {
    // For list fields, return the buffer array
    if (key in listBuffers) return listBuffers[key];
    // For text fields, return the buffer string
    if (key in textBuffers) return textBuffers[key];
    // Fallback to raw data for non-buffered fields (scores-summary, etc.)
    return data?.[key] ?? '';
  };

  // Handlers for buffer updates from EditableInput on:change
  const handleTextChange = (key: string, value: string) => {
    textBuffers = { ...textBuffers, [key]: value };
  };
  const handleListChange = (key: string, value: string[]) => {
    listBuffers = { ...listBuffers, [key]: value };
  };
  const handleScoreChange = (key: string, value: string) => {
    scoreBuffers = { ...scoreBuffers, [key]: value };
  };

  // Full-data getters for EditableInput save payloads
  const getTextFullData = (key: string): Record<string, unknown> | null => {
    const value = normalizeUseCaseMarkdown(textBuffers[key] || '');
    const cleaned = stripTrailingEmptyParagraph(value);
    return { [key]: cleaned };
  };

  const getListFullData = (key: string): Record<string, unknown> | null => {
    const arr = listBuffers[key] ?? [];
    const markdown = arrayToMarkdown(arr);
    const cleaned = stripTrailingEmptyParagraph(markdown);
    return { [key]: markdownToArray(cleaned) };
  };

  const getScoreFullDataFn = (type: 'value' | 'complexity') => (axisId: string): Record<string, unknown> | null => {
    if (!matrix) return null;
    const scoresKey = type === 'value' ? 'valueScores' : 'complexityScores';
    const scores = data?.[scoresKey] ?? [];
    const updated = scores.map((score: any) => {
      if (score.axisId === axisId) {
        const key = `${type}-${axisId}`;
        const buf = scoreBuffers[key] ?? score.description ?? '';
        const cleaned = stripTrailingEmptyParagraph(normalizeUseCaseMarkdown(buf));
        return { ...score, description: cleaned };
      }
      return score;
    });
    return { [scoresKey]: updated };
  };

  // Score summary
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);
  $: totalValueScore = data?.totalValueScore ?? (calculatedScores?.finalValueScore ?? null);
  $: totalComplexityScore = data?.totalComplexityScore ?? (calculatedScores?.finalComplexityScore ?? null);
  $: valueStars = calculatedScores?.valueStars ?? (totalValueScore != null ? Math.round(totalValueScore / 20) : 0);
  $: complexityStars = calculatedScores?.complexityStars ?? (totalComplexityScore != null ? Math.round(totalComplexityScore / 20) : 0);

  // Grid class lookups
  const gridColsClass: Record<number, string> = { 1: 'grid-cols-1', 2: 'md:grid-cols-2', 3: 'lg:grid-cols-3' };
  const colSpanClass: Record<number, string> = { 1: '', 2: 'md:col-span-2', 3: 'lg:col-span-3' };

  // i18n labels
  const i18nMap: Record<string, string> = {
    description: 'usecase.fields.description', problem: 'usecase.fields.problem',
    solution: 'usecase.fields.solution', benefits: 'usecase.fields.benefits',
    constraints: 'usecase.fields.constraints', metrics: 'usecase.fields.metrics',
    risks: 'usecase.fields.risks', nextSteps: 'usecase.fields.nextSteps',
    contact: 'usecase.info.contact', domain: 'usecase.info.domain',
    technologies: 'usecase.info.technologies', dataSources: 'usecase.info.dataSources',
    dataObjects: 'usecase.info.dataObjects', deadline: 'usecase.fields.deadline',
    references: 'common.references', totalValue: 'usecase.scores.totalValue',
    totalComplexity: 'usecase.scores.totalComplexity', valueScores: 'matrix.valueAxes',
    complexityScores: 'matrix.complexityAxes',
    size: 'organizations.fields.size', products: 'organizations.fields.products',
    processes: 'organizations.fields.processes', kpis: 'organizations.fields.kpis',
    challenges: 'organizations.fields.challenges', objectives: 'organizations.fields.objectives',
    synthese_executive: 'dashboard.execSummary', introduction: 'dashboard.introduction',
    analyse: 'dashboard.analysis', recommandation: 'dashboard.recommendations',
  };

  const fieldLabel = (key: string): string => {
    const i18nKey = i18nMap[key];
    if (i18nKey) {
      const translated = $_({ id: i18nKey });
      if (translated && translated !== i18nKey) return translated;
    }
    return key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1');
  };

  // Helpers for splitting fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isSpanField = (f: any): boolean => f.span && f.span > 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isNotSpanField = (f: any): boolean => !f.span || f.span <= 1;
</script>

{#if template}
  <!-- Tab bar -->
  {#if !singleFlatTab && visibleTabs.length > 1}
    <div class="border-b border-slate-200 mb-6">
      <nav class="flex gap-4" aria-label="Tabs">
        {#each visibleTabs as tab}
          <button
            type="button"
            class="px-3 py-2 text-sm font-medium border-b-2 transition-colors {activeTabKey === tab.key ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}"
            on:click={() => { activeTabKey = tab.key; }}
          >
            {tab.label}
          </button>
        {/each}
      </nav>
    </div>
  {/if}

  {#if activeTab}
    <div class="space-y-6">
      {#each activeTab.rows ?? [] as row}
        {#if row.main && row.sidebar}
          <!-- Main + Sidebar row -->
          <div class="grid gap-6 items-stretch {gridColsClass[row.columns] || 'lg:grid-cols-3'}">
            <!-- Main zone -->
            <div class="{colSpanClass[row.main?.span] || 'md:col-span-2'}">
              <!-- Span fields (full width within main) -->
              {#each (row.main.fields ?? []).filter(isSpanField) as field (field.key)}
                <div class="mb-6">
                  {#if field.type === 'text'}
                    <FieldCard label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                      <div class="prose prose-slate max-w-none">
                        <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
                          {#if isPrinting}
                            {@html renderMarkdownWithRefs(getFieldValue(field.key) || '', references, { addListStyles: true, listPadding: 1.5 })}
                          {:else}
                            <EditableInput {locked} label="" value={normalizeUseCaseMarkdown(getFieldValue(field.key) || '')} markdown={true} {apiEndpoint} fullData={getTextFullData(field.key)} fullDataGetter={() => getTextFullData(field.key)} changeId={entityId ? `${entityId}-${field.key}` : ''} originalValue={textOriginals[field.key] || ''} {references} on:change={(e) => handleTextChange(field.key, e.detail.value)} on:saved={() => { if (onFieldSaved) onFieldSaved(); }} />
                          {/if}
                        </div>
                      </div>
                    </FieldCard>
                  {:else if field.type === 'list'}
                    <FieldCard label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                      <div class="text-sm text-slate-600">
                        {#if field.key === 'references'}
                          <ol class="space-y-2 list-decimal list-outside pl-6 text-sm">
                            {#each (Array.isArray(getFieldValue(field.key)) ? getFieldValue(field.key) : []) as item, idx}
                              {@const linkMatch = typeof item === 'string' ? item.match(/\[([^\]]*)\]\(([^)]*)\)(.*)/) : null}
                              <li class="leading-relaxed">{#if linkMatch}<a href={linkMatch[2]} target="_blank" rel="noopener" class="text-blue-600 hover:text-blue-800 underline">{linkMatch[1]}</a>{#if linkMatch[3]}<span class="text-slate-500">{linkMatch[3]}</span>{/if}{:else}{item}{/if}</li>
                            {/each}
                          </ol>
                        {:else if isPrinting}
                          <ul class="space-y-2">
                            {#each (Array.isArray(getFieldValue(field.key)) ? getFieldValue(field.key) : []) as item}
                              <li class="flex items-start gap-2"><span class="mt-1">&#8226;</span><span>{@html renderMarkdownWithRefs(item, references, { addListStyles: true, listPadding: 1.5 })}</span></li>
                            {/each}
                          </ul>
                        {:else}
                          <EditableInput {locked} label="" value={listMarkdowns[field.key] || ''} markdown={true} forceList={true} {apiEndpoint} fullData={getListFullData(field.key)} fullDataGetter={() => getListFullData(field.key)} changeId={entityId ? `${entityId}-${field.key}` : ''} originalValue={arrayToMarkdown(listOriginals[field.key] ?? [])} {references} on:change={(e) => handleListChange(field.key, markdownToArray(e.detail.value))} on:saved={() => { if (onFieldSaved) onFieldSaved(); }} />
                        {/if}
                      </div>
                    </FieldCard>
                  {/if}
                </div>
              {/each}
              <!-- Grid fields (non-span, in sub-grid) -->
              {#if (row.main.fields ?? []).filter(isNotSpanField).length > 0}
                <div class="grid gap-6 {gridColsClass[row.main.columns] || 'md:grid-cols-2'}">
                  {#each (row.main.fields ?? []).filter(isNotSpanField) as field (field.key)}
                    <div class="h-full">
                      {#if field.type === 'text'}
                        <FieldCard label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                          <div class="prose prose-slate max-w-none">
                            <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
                              {#if isPrinting}
                                {@html renderMarkdownWithRefs(getFieldValue(field.key) || '', references, { addListStyles: true, listPadding: 1.5 })}
                              {:else}
                                <EditableInput {locked} label="" value={normalizeUseCaseMarkdown(getFieldValue(field.key) || '')} markdown={true} {apiEndpoint} fullData={getTextFullData(field.key)} fullDataGetter={() => getTextFullData(field.key)} changeId={entityId ? `${entityId}-${field.key}` : ''} originalValue={textOriginals[field.key] || ''} {references} on:change={(e) => handleTextChange(field.key, e.detail.value)} on:saved={() => { if (onFieldSaved) onFieldSaved(); }} />
                              {/if}
                            </div>
                          </div>
                        </FieldCard>
                      {:else if field.type === 'list'}
                        <FieldCard label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                          <div class="text-sm text-slate-600">
                            {#if field.key === 'references'}
                              <ol class="space-y-2 list-decimal list-outside pl-6 text-sm">
                                {#each (Array.isArray(getFieldValue(field.key)) ? getFieldValue(field.key) : []) as item, idx}
                                  {@const linkMatch = typeof item === 'string' ? item.match(/\[([^\]]*)\]\(([^)]*)\)(.*)/) : null}
                                  <li class="leading-relaxed">{#if linkMatch}<a href={linkMatch[2]} target="_blank" rel="noopener" class="text-blue-600 hover:text-blue-800 underline">{linkMatch[1]}</a>{#if linkMatch[3]}<span class="text-slate-500">{linkMatch[3]}</span>{/if}{:else}{item}{/if}</li>
                                {/each}
                              </ol>
                            {:else if isPrinting}
                              <ul class="space-y-2">
                                {#each (Array.isArray(getFieldValue(field.key)) ? getFieldValue(field.key) : []) as item}
                                  <li class="flex items-start gap-2"><span class="mt-1">&#8226;</span><span>{@html renderMarkdownWithRefs(item, references, { addListStyles: true, listPadding: 1.5 })}</span></li>
                                {/each}
                              </ul>
                            {:else}
                              <EditableInput {locked} label="" value={listMarkdowns[field.key] || ''} markdown={true} forceList={true} {apiEndpoint} fullData={getListFullData(field.key)} fullDataGetter={() => getListFullData(field.key)} changeId={entityId ? `${entityId}-${field.key}` : ''} originalValue={arrayToMarkdown(listOriginals[field.key] ?? [])} {references} on:change={(e) => handleListChange(field.key, markdownToArray(e.detail.value))} on:saved={() => { if (onFieldSaved) onFieldSaved(); }} />
                            {/if}
                          </div>
                        </FieldCard>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
            <!-- Sidebar zone -->
            <div class="{colSpanClass[row.sidebar?.span] || ''} h-full">
              <div class="space-y-6 h-full flex flex-col">
                {#each row.sidebar.fields ?? [] as field (field.key)}
                  {#if field.type === 'text'}
                    <FieldCard label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                      <div class="text-slate-600 text-sm">
                        {#if isPrinting}
                          {@html renderMarkdownWithRefs(getFieldValue(field.key) || '', references, { addListStyles: true, listPadding: 1.5 })}
                        {:else}
                          <EditableInput {locked} label="" value={normalizeUseCaseMarkdown(getFieldValue(field.key) || '')} markdown={true} {apiEndpoint} fullData={getTextFullData(field.key)} fullDataGetter={() => getTextFullData(field.key)} changeId={entityId ? `${entityId}-${field.key}` : ''} originalValue={textOriginals[field.key] || ''} {references} on:change={(e) => handleTextChange(field.key, e.detail.value)} on:saved={() => { if (onFieldSaved) onFieldSaved(); }} />
                        {/if}
                      </div>
                    </FieldCard>
                  {:else if field.type === 'list'}
                    <FieldCard label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                      <div class="text-sm text-slate-600">
                        {#if field.key === 'references'}
                          <ol class="space-y-2 list-decimal list-outside pl-6 text-sm">
                            {#each (Array.isArray(getFieldValue(field.key)) ? getFieldValue(field.key) : []) as item, idx}
                              {@const linkMatch = typeof item === 'string' ? item.match(/\[([^\]]*)\]\(([^)]*)\)(.*)/) : null}
                              <li class="leading-relaxed">{#if linkMatch}<a href={linkMatch[2]} target="_blank" rel="noopener" class="text-blue-600 hover:text-blue-800 underline">{linkMatch[1]}</a>{#if linkMatch[3]}<span class="text-slate-500">{linkMatch[3]}</span>{/if}{:else}{item}{/if}</li>
                            {/each}
                          </ol>
                        {:else if isPrinting}
                          <ul class="space-y-2">
                            {#each (Array.isArray(getFieldValue(field.key)) ? getFieldValue(field.key) : []) as item}
                              <li class="flex items-start gap-2"><span class="mt-1">&#8226;</span><span>{@html renderMarkdownWithRefs(item, references, { addListStyles: true, listPadding: 1.5 })}</span></li>
                            {/each}
                          </ul>
                        {:else}
                          <EditableInput {locked} label="" value={listMarkdowns[field.key] || ''} markdown={true} forceList={true} {apiEndpoint} fullData={getListFullData(field.key)} fullDataGetter={() => getListFullData(field.key)} changeId={entityId ? `${entityId}-${field.key}` : ''} originalValue={arrayToMarkdown(listOriginals[field.key] ?? [])} {references} on:change={(e) => handleListChange(field.key, markdownToArray(e.detail.value))} on:saved={() => { if (onFieldSaved) onFieldSaved(); }} />
                        {/if}
                      </div>
                    </FieldCard>
                  {/if}
                {/each}
              </div>
            </div>
          </div>
        {:else}
          <!-- Simple row with flat fields -->
          <div class="grid gap-6 {gridColsClass[row.columns] || 'grid-cols-1'}">
            {#each row.fields ?? [] as field (field.key)}
              {#if field.type === 'scores-summary'}
                {#if field.key === 'totalValue' && totalValueScore != null}
                  <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <div class="bg-green-100 text-green-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
                      <h3 class="font-semibold flex items-center gap-2">
                        <CheckCircle2 class="w-5 h-5" />
                        {fieldLabel('totalValue')}
                      </h3>
                    </div>
                    <div class="flex items-center gap-3">
                      <div class="flex items-center gap-1">
                        {#each range(5) as i (i)}
                          <Star class="w-6 h-6 {i < valueStars ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}" />
                        {/each}
                      </div>
                      <span class="font-bold text-green-600">({totalValueScore.toFixed(0)} {$_('common.pointsAbbr')})</span>
                    </div>
                  </div>
                {:else if field.key === 'totalComplexity' && totalComplexityScore != null}
                  <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <div class="bg-red-100 text-red-800 px-3 py-2 rounded-t-lg -mx-4 -mt-4 mb-4">
                      <h3 class="font-semibold flex items-center gap-2">
                        <AlertTriangle class="w-5 h-5" />
                        {fieldLabel('totalComplexity')}
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
                      <span class="font-bold text-red-600">({totalComplexityScore.toFixed(0)} {$_('common.pointsAbbr')})</span>
                    </div>
                  </div>
                {/if}
              {:else if field.type === 'text'}
                <div class="{field.span > 1 ? (colSpanClass[field.span] || '') : ''} h-full">
                  <FieldCard label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                    <div class="text-slate-600 text-sm leading-relaxed prose prose-sm max-w-none">
                      {#if isPrinting}
                        {@html renderMarkdownWithRefs(getFieldValue(field.key) || '', references, { addListStyles: true, listPadding: 1.5 })}
                      {:else}
                        <EditableInput {locked} label="" value={normalizeUseCaseMarkdown(getFieldValue(field.key) || '')} markdown={true} {apiEndpoint} fullData={getTextFullData(field.key)} fullDataGetter={() => getTextFullData(field.key)} changeId={entityId ? `${entityId}-${field.key}` : ''} originalValue={textOriginals[field.key] || ''} {references} on:change={(e) => handleTextChange(field.key, e.detail.value)} on:saved={() => { if (onFieldSaved) onFieldSaved(); }} />
                      {/if}
                    </div>
                  </FieldCard>
                </div>
              {:else if field.type === 'list'}
                <div class="{field.span > 1 ? (colSpanClass[field.span] || '') : ''} h-full">
                  <FieldCard label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                    <div class="text-sm text-slate-600">
                      {#if field.key === 'references'}
                        <ol class="space-y-2 list-decimal list-outside pl-6 text-sm">
                          {#each (Array.isArray(getFieldValue(field.key)) ? getFieldValue(field.key) : []) as item, idx}
                            {@const linkMatch = typeof item === 'string' ? item.match(/\[([^\]]*)\]\(([^)]*)\)(.*)/) : null}
                            <li class="leading-relaxed">{#if linkMatch}<a href={linkMatch[2]} target="_blank" rel="noopener" class="text-blue-600 hover:text-blue-800 underline">{linkMatch[1]}</a>{#if linkMatch[3]}<span class="text-slate-500">{linkMatch[3]}</span>{/if}{:else}{item}{/if}</li>
                          {/each}
                        </ol>
                      {:else if isPrinting}
                        <ul class="space-y-2">
                          {#each (Array.isArray(getFieldValue(field.key)) ? getFieldValue(field.key) : []) as item}
                            <li class="flex items-start gap-2"><span class="mt-1">&#8226;</span><span>{@html renderMarkdownWithRefs(item, references, { addListStyles: true, listPadding: 1.5 })}</span></li>
                          {/each}
                        </ul>
                      {:else}
                        <EditableInput {locked} label="" value={listMarkdowns[field.key] || ''} markdown={true} forceList={true} {apiEndpoint} fullData={getListFullData(field.key)} fullDataGetter={() => getListFullData(field.key)} changeId={entityId ? `${entityId}-${field.key}` : ''} originalValue={arrayToMarkdown(listOriginals[field.key] ?? [])} {references} on:change={(e) => handleListChange(field.key, markdownToArray(e.detail.value))} on:saved={() => { if (onFieldSaved) onFieldSaved(); }} />
                      {/if}
                    </div>
                  </FieldCard>
                </div>
              {:else if field.type === 'scores' && matrix}
                <div class={field.span > 1 ? (colSpanClass[field.span] || '') : ''}>
                  {#if field.key === 'valueScores'}
                    <FieldCard label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                      <ScoreTable axes={matrix.valueAxes ?? []} scores={data?.valueScores ?? []} displayMode="stars" {locked} {apiEndpoint} scorePrefix="value" {entityId} {scoreBuffers} {scoreOriginals} {references} onScoreChange={handleScoreChange} onScoreSaved={onFieldSaved} {isPrinting} getScoreFullData={getScoreFullDataFn('value')} />
                    </FieldCard>
                  {:else if field.key === 'complexityScores'}
                    <FieldCard label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                      <ScoreTable axes={matrix.complexityAxes ?? []} scores={data?.complexityScores ?? []} displayMode="xminus" {locked} {apiEndpoint} scorePrefix="complexity" {entityId} {scoreBuffers} {scoreOriginals} {references} onScoreChange={handleScoreChange} onScoreSaved={onFieldSaved} {isPrinting} getScoreFullData={getScoreFullDataFn('complexity')} />
                    </FieldCard>
                  {/if}
                </div>
              {:else if field.type === 'child-list'}
                <FieldCard label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                  <p class="text-sm text-slate-400 italic">Child list: {field.key}</p>
                </FieldCard>
              {:else if field.type === 'chart'}
                <!-- Chart fields are rendered by the parent page via slot -->
                <slot name="chart" chartKey={field.key} />
              {/if}
            {/each}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
{:else}
  <div class="rounded border border-red-200 bg-red-50 p-4 text-red-700">
    Template not found.
  </div>
{/if}
