<script lang="ts">
  /* eslint-disable svelte/no-at-html-tags */
  // {@html} usage routed through renderMarkdownWithRefs(), sanitised via DOMPurify.
  import FieldCard from '$lib/components/FieldCard.svelte';
  import ScoreTable from '$lib/components/ScoreTable.svelte';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import { scoreToStars } from '$lib/utils/scoring';
  import { Star, X, Minus, CheckCircle2, AlertTriangle } from '@lucide/svelte';
  import { _ } from 'svelte-i18n';
  import { normalizeUseCaseMarkdown, stripTrailingEmptyParagraph, arrayToMarkdown, markdownToArray, renderMarkdownWithRefs } from '$lib/utils/markdown';

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

  // ---------------------------------------------------------------------------
  // Field buffers — managed externally; renderer is stateless per design.
  // The parent page owns all buffers (text, list, score) and passes them via
  // data + callbacks.  The renderer reads from data and forwards save events.
  // ---------------------------------------------------------------------------

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
  // Field data access helpers
  // ---------------------------------------------------------------------------
  const getFieldValue = (key: string): any => data?.[key] ?? '';

  const getTextFullData = (key: string): Record<string, unknown> | null => {
    const value = normalizeUseCaseMarkdown(getFieldValue(key) || '');
    const cleaned = stripTrailingEmptyParagraph(value);
    return { [key]: cleaned };
  };

  const getListFullData = (key: string): Record<string, unknown> | null => {
    const arr = Array.isArray(getFieldValue(key)) ? getFieldValue(key) : [];
    const markdown = arrayToMarkdown(arr);
    const cleaned = stripTrailingEmptyParagraph(markdown);
    return { [key]: markdownToArray(cleaned) };
  };

  const getScoreFullData = (type: 'value' | 'complexity') => (axisId: string): Record<string, unknown> | null => {
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

  // Score buffers managed inside renderer for simplicity (they're internal editing state)
  let scoreBuffers: Record<string, string> = {};
  let scoreOriginals: Record<string, string> = {};
  let lastEntityId: string | null = null;

  $: if (entityId && entityId !== lastEntityId) {
    lastEntityId = entityId;
    scoreBuffers = {};
    scoreOriginals = {};
    initScoreBuffers();
  }

  const initScoreBuffers = () => {
    const vals: Record<string, string> = {};
    for (const score of (data?.valueScores ?? [])) {
      const key = `value-${score.axisId}`;
      vals[key] = normalizeUseCaseMarkdown(score.description || '');
    }
    for (const score of (data?.complexityScores ?? [])) {
      const key = `complexity-${score.axisId}`;
      vals[key] = normalizeUseCaseMarkdown(score.description || '');
    }
    scoreBuffers = { ...vals };
    scoreOriginals = { ...vals };
  };

  const handleScoreChange = (key: string, value: string) => {
    scoreBuffers = { ...scoreBuffers, [key]: value };
  };

  // ---------------------------------------------------------------------------
  // Score summary helpers
  // ---------------------------------------------------------------------------
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

  $: totalValueScore = data?.totalValueScore ?? (calculatedScores?.finalValueScore ?? null);
  $: totalComplexityScore = data?.totalComplexityScore ?? (calculatedScores?.finalComplexityScore ?? null);
  $: valueStars = calculatedScores?.valueStars ?? (totalValueScore != null ? Math.round(totalValueScore / 20) : 0);
  $: complexityStars = calculatedScores?.complexityStars ?? (totalComplexityScore != null ? Math.round(totalComplexityScore / 20) : 0);

  // Grid column class lookup (Tailwind needs full strings)
  const gridColsClass: Record<number, string> = {
    1: 'grid-cols-1',
    2: 'md:grid-cols-2',
    3: 'lg:grid-cols-3',
  };
  const colSpanClass: Record<number, string> = {
    1: '',
    2: 'md:col-span-2',
    3: 'lg:col-span-3',
  };

  // i18n label helper
  const fieldLabel = (key: string): string => {
    // Try common i18n keys — use field key as fallback
    const i18nMap: Record<string, string> = {
      description: 'usecase.fields.description',
      problem: 'usecase.fields.problem',
      solution: 'usecase.fields.solution',
      benefits: 'usecase.fields.benefits',
      constraints: 'usecase.fields.constraints',
      metrics: 'usecase.fields.metrics',
      risks: 'usecase.fields.risks',
      nextSteps: 'usecase.fields.nextSteps',
      contact: 'usecase.info.contact',
      domain: 'usecase.info.domain',
      technologies: 'usecase.info.technologies',
      dataSources: 'usecase.info.dataSources',
      dataObjects: 'usecase.info.dataObjects',
      deadline: 'usecase.fields.deadline',
      references: 'common.references',
      totalValue: 'usecase.scores.totalValue',
      totalComplexity: 'usecase.scores.totalComplexity',
      valueScores: 'matrix.valueAxes',
      complexityScores: 'matrix.complexityAxes',
      // Organization fields
      size: 'organizations.fields.size',
      products: 'organizations.fields.products',
      processes: 'organizations.fields.processes',
      kpis: 'organizations.fields.kpis',
      challenges: 'organizations.fields.challenges',
      objectives: 'organizations.fields.objectives',
      // Dashboard fields
      synthese_executive: 'dashboard.execSummary',
      introduction: 'dashboard.introduction',
      analyse: 'dashboard.analysis',
      recommandation: 'dashboard.recommendations',
    };
    const i18nKey = i18nMap[key];
    if (i18nKey) {
      const translated = $_({ id: i18nKey });
      if (translated && translated !== i18nKey) return translated;
    }
    // Capitalize first letter as fallback
    return key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1');
  };
</script>

{#if template}
  <!-- Tab bar (only if multiple visible tabs) -->
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

  <!-- Render active tab rows -->
  {#if activeTab}
    <div class="space-y-6">
      {#each activeTab.rows ?? [] as row, rowIdx}
        {#if row.main && row.sidebar}
          <!-- Row with main + sidebar zones -->
          <div class="grid gap-6 {gridColsClass[row.columns] || 'lg:grid-cols-3'}">
            <div class="{colSpanClass[row.main.span] || 'md:col-span-2'}">
              <!-- Main sub-grid -->
              {#each row.main.fields ?? [] as field}
                {#if field.span && field.span > 1}
                  <div class="{colSpanClass[field.span] || ''} mb-6">
                    <svelte:self
                      template={{ tabs: [{ key: '_inline', always: true, rows: [{ columns: 1, fields: [{ ...field, span: 1 }] }] }] }}
                      {data} {locked} {apiEndpoint} {commentCounts} {onOpenComments} {references} {matrix} {calculatedScores} {entityId} {onFieldSaved} {isPrinting}
                    />
                  </div>
                {:else}
                  <!-- Render in sub-grid context -->
                {/if}
              {/each}
              <!-- Render main fields as a sub-grid -->
              {#if row.main.columns && row.main.columns > 1}
                {@const mainFields = row.main.fields ?? []}
                {@const spanFields = mainFields.filter((f) => f.span && f.span > 1)}
                {@const normalFields = mainFields.filter((f) => !f.span || f.span <= 1)}
                {#each spanFields as field}
                  <div class="mb-6">
                    {@const fKey = field.key}
                    {@const fType = field.type}
                    {@const fColor = field.color || ''}
                    {#if fType === 'text'}
                      <FieldCard label={fieldLabel(fKey)} color={fColor} commentSection={fKey} commentCount={commentCounts[fKey] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(fKey) : null}>
                        <div class="prose prose-slate max-w-none">
                          <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
                            {#if isPrinting}
                              {@html renderMarkdownWithRefs(getFieldValue(fKey) || '', references, { addListStyles: true, listPadding: 1.5 })}
                            {:else}
                              <EditableInput
                                {locked}
                                label=""
                                value={normalizeUseCaseMarkdown(getFieldValue(fKey) || '')}
                                markdown={true}
                                {apiEndpoint}
                                fullData={getTextFullData(fKey)}
                                fullDataGetter={() => getTextFullData(fKey)}
                                changeId={entityId ? `${entityId}-${fKey}` : ''}
                                originalValue={normalizeUseCaseMarkdown(getFieldValue(fKey) || '')}
                                {references}
                                on:saved={() => { if (onFieldSaved) onFieldSaved(); }}
                              />
                            {/if}
                          </div>
                        </div>
                      </FieldCard>
                    {:else if fType === 'list'}
                      <FieldCard label={fieldLabel(fKey)} color={fColor} commentSection={fKey} commentCount={commentCounts[fKey] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(fKey) : null}>
                        <div class="text-sm text-slate-600">
                          {#if isPrinting}
                            <ul class="space-y-2">
                              {#each (Array.isArray(getFieldValue(fKey)) ? getFieldValue(fKey) : []) as item}
                                <li class="flex items-start gap-2 text-sm text-slate-600">
                                  <span class="mt-1">&#8226;</span>
                                  <span>{@html renderMarkdownWithRefs(item, references, { addListStyles: true, listPadding: 1.5 })}</span>
                                </li>
                              {/each}
                            </ul>
                          {:else}
                            <EditableInput
                              {locked}
                              label=""
                              value={arrayToMarkdown(Array.isArray(getFieldValue(fKey)) ? getFieldValue(fKey) : [])}
                              markdown={true}
                              forceList={true}
                              {apiEndpoint}
                              fullData={getListFullData(fKey)}
                              fullDataGetter={() => getListFullData(fKey)}
                              changeId={entityId ? `${entityId}-${fKey}` : ''}
                              originalValue={arrayToMarkdown(Array.isArray(getFieldValue(fKey)) ? getFieldValue(fKey) : [])}
                              {references}
                              on:saved={() => { if (onFieldSaved) onFieldSaved(); }}
                            />
                          {/if}
                        </div>
                      </FieldCard>
                    {/if}
                  </div>
                {/each}
                <div class="grid gap-6 {gridColsClass[row.main.columns] || 'md:grid-cols-2'}">
                  {#each normalFields as field}
                    {@const fKey = field.key}
                    {@const fType = field.type}
                    {@const fColor = field.color || ''}
                    <div>
                      {#if fType === 'text'}
                        <FieldCard label={fieldLabel(fKey)} color={fColor} commentSection={fKey} commentCount={commentCounts[fKey] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(fKey) : null}>
                          <div class="prose prose-slate max-w-none">
                            <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
                              {#if isPrinting}
                                {@html renderMarkdownWithRefs(getFieldValue(fKey) || '', references, { addListStyles: true, listPadding: 1.5 })}
                              {:else}
                                <EditableInput
                                  {locked}
                                  label=""
                                  value={normalizeUseCaseMarkdown(getFieldValue(fKey) || '')}
                                  markdown={true}
                                  {apiEndpoint}
                                  fullData={getTextFullData(fKey)}
                                  fullDataGetter={() => getTextFullData(fKey)}
                                  changeId={entityId ? `${entityId}-${fKey}` : ''}
                                  originalValue={normalizeUseCaseMarkdown(getFieldValue(fKey) || '')}
                                  {references}
                                  on:saved={() => { if (onFieldSaved) onFieldSaved(); }}
                                />
                              {/if}
                            </div>
                          </div>
                        </FieldCard>
                      {:else if fType === 'list'}
                        <FieldCard label={fieldLabel(fKey)} color={fColor} commentSection={fKey} commentCount={commentCounts[fKey] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(fKey) : null}>
                          <div class="text-sm text-slate-600">
                            {#if isPrinting}
                              <ul class="space-y-2">
                                {#each (Array.isArray(getFieldValue(fKey)) ? getFieldValue(fKey) : []) as item}
                                  <li class="flex items-start gap-2 text-sm text-slate-600">
                                    <span class="mt-1">&#8226;</span>
                                    <span>{@html renderMarkdownWithRefs(item, references, { addListStyles: true, listPadding: 1.5 })}</span>
                                  </li>
                                {/each}
                              </ul>
                            {:else}
                              <EditableInput
                                {locked}
                                label=""
                                value={arrayToMarkdown(Array.isArray(getFieldValue(fKey)) ? getFieldValue(fKey) : [])}
                                markdown={true}
                                forceList={true}
                                {apiEndpoint}
                                fullData={getListFullData(fKey)}
                                fullDataGetter={() => getListFullData(fKey)}
                                changeId={entityId ? `${entityId}-${fKey}` : ''}
                                originalValue={arrayToMarkdown(Array.isArray(getFieldValue(fKey)) ? getFieldValue(fKey) : [])}
                                {references}
                                on:saved={() => { if (onFieldSaved) onFieldSaved(); }}
                              />
                            {/if}
                          </div>
                        </FieldCard>
                      {/if}
                    </div>
                  {/each}
                </div>
              {:else}
                <!-- Single column main -->
                {#each row.main.fields ?? [] as field}
                  {@const fKey = field.key}
                  {@const fType = field.type}
                  {@const fColor = field.color || ''}
                  <div class="mb-6">
                    {#if fType === 'text'}
                      <FieldCard label={fieldLabel(fKey)} color={fColor} commentSection={fKey} commentCount={commentCounts[fKey] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(fKey) : null}>
                        <div class="text-slate-700 leading-relaxed">
                          {#if isPrinting}
                            {@html renderMarkdownWithRefs(getFieldValue(fKey) || '', references, { addListStyles: true, listPadding: 1.5 })}
                          {:else}
                            <EditableInput
                              {locked}
                              label=""
                              value={normalizeUseCaseMarkdown(getFieldValue(fKey) || '')}
                              markdown={true}
                              {apiEndpoint}
                              fullData={getTextFullData(fKey)}
                              fullDataGetter={() => getTextFullData(fKey)}
                              changeId={entityId ? `${entityId}-${fKey}` : ''}
                              originalValue={normalizeUseCaseMarkdown(getFieldValue(fKey) || '')}
                              {references}
                              on:saved={() => { if (onFieldSaved) onFieldSaved(); }}
                            />
                          {/if}
                        </div>
                      </FieldCard>
                    {:else if fType === 'list'}
                      <FieldCard label={fieldLabel(fKey)} color={fColor} commentSection={fKey} commentCount={commentCounts[fKey] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(fKey) : null}>
                        <div class="text-sm text-slate-600">
                          <EditableInput
                            {locked}
                            label=""
                            value={arrayToMarkdown(Array.isArray(getFieldValue(fKey)) ? getFieldValue(fKey) : [])}
                            markdown={true}
                            forceList={true}
                            {apiEndpoint}
                            fullData={getListFullData(fKey)}
                            fullDataGetter={() => getListFullData(fKey)}
                            changeId={entityId ? `${entityId}-${fKey}` : ''}
                            originalValue={arrayToMarkdown(Array.isArray(getFieldValue(fKey)) ? getFieldValue(fKey) : [])}
                            {references}
                            on:saved={() => { if (onFieldSaved) onFieldSaved(); }}
                          />
                        </div>
                      </FieldCard>
                    {/if}
                  </div>
                {/each}
              {/if}
            </div>
            <!-- Sidebar -->
            <div class="{colSpanClass[row.sidebar.span] || ''}">
              <div class="space-y-6">
                {#each row.sidebar.fields ?? [] as field}
                  {@const fKey = field.key}
                  {@const fType = field.type}
                  {@const fColor = field.color || ''}
                  {#if fType === 'text'}
                    <FieldCard label={fieldLabel(fKey)} color={fColor} commentSection={fKey} commentCount={commentCounts[fKey] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(fKey) : null}>
                      <div class="text-slate-600 text-sm">
                        {#if isPrinting}
                          {@html renderMarkdownWithRefs(getFieldValue(fKey) || '', references, { addListStyles: true, listPadding: 1.5 })}
                        {:else}
                          <EditableInput
                            {locked}
                            label=""
                            value={normalizeUseCaseMarkdown(getFieldValue(fKey) || '')}
                            markdown={true}
                            {apiEndpoint}
                            fullData={getTextFullData(fKey)}
                            fullDataGetter={() => getTextFullData(fKey)}
                            changeId={entityId ? `${entityId}-${fKey}` : ''}
                            originalValue={normalizeUseCaseMarkdown(getFieldValue(fKey) || '')}
                            {references}
                            on:saved={() => { if (onFieldSaved) onFieldSaved(); }}
                          />
                        {/if}
                      </div>
                    </FieldCard>
                  {:else if fType === 'list'}
                    <FieldCard label={fieldLabel(fKey)} color={fColor} commentSection={fKey} commentCount={commentCounts[fKey] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(fKey) : null}>
                      <div class="text-sm text-slate-600">
                        {#if isPrinting}
                          <ul class="space-y-2">
                            {#each (Array.isArray(getFieldValue(fKey)) ? getFieldValue(fKey) : []) as item}
                              <li class="flex items-start gap-2 text-sm text-slate-600">
                                <span class="mt-1">&#8226;</span>
                                <span>{@html renderMarkdownWithRefs(item, references, { addListStyles: true, listPadding: 1.5 })}</span>
                              </li>
                            {/each}
                          </ul>
                        {:else}
                          <EditableInput
                            {locked}
                            label=""
                            value={arrayToMarkdown(Array.isArray(getFieldValue(fKey)) ? getFieldValue(fKey) : [])}
                            markdown={true}
                            forceList={true}
                            {apiEndpoint}
                            fullData={getListFullData(fKey)}
                            fullDataGetter={() => getListFullData(fKey)}
                            changeId={entityId ? `${entityId}-${fKey}` : ''}
                            originalValue={arrayToMarkdown(Array.isArray(getFieldValue(fKey)) ? getFieldValue(fKey) : [])}
                            {references}
                            on:saved={() => { if (onFieldSaved) onFieldSaved(); }}
                          />
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
            {#each row.fields ?? [] as field}
              {@const fKey = field.key}
              {@const fType = field.type}
              {@const fColor = field.color || ''}
              {@const fSpan = field.span || 1}
              <div class={fSpan > 1 ? (colSpanClass[fSpan] || '') : ''}>
                {#if fType === 'scores-summary'}
                  <!-- Score summary card (totalValue / totalComplexity) -->
                  {#if fKey === 'totalValue' && totalValueScore != null}
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
                        <span class="font-bold text-green-600">
                          ({totalValueScore.toFixed(0)} {$_('common.pointsAbbr')})
                        </span>
                      </div>
                    </div>
                  {:else if fKey === 'totalComplexity' && totalComplexityScore != null}
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
                        <span class="font-bold text-red-600">
                          ({totalComplexityScore.toFixed(0)} {$_('common.pointsAbbr')})
                        </span>
                      </div>
                    </div>
                  {/if}
                {:else if fType === 'text'}
                  <FieldCard label={fieldLabel(fKey)} color={fColor} commentSection={fKey} commentCount={commentCounts[fKey] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(fKey) : null}>
                    <div class="text-slate-600 text-sm leading-relaxed prose prose-sm max-w-none">
                      {#if isPrinting}
                        {@html renderMarkdownWithRefs(getFieldValue(fKey) || '', references, { addListStyles: true, listPadding: 1.5 })}
                      {:else}
                        <EditableInput
                          {locked}
                          label=""
                          value={normalizeUseCaseMarkdown(getFieldValue(fKey) || '')}
                          markdown={true}
                          {apiEndpoint}
                          fullData={getTextFullData(fKey)}
                          fullDataGetter={() => getTextFullData(fKey)}
                          changeId={entityId ? `${entityId}-${fKey}` : ''}
                          originalValue={normalizeUseCaseMarkdown(getFieldValue(fKey) || '')}
                          {references}
                          on:saved={() => { if (onFieldSaved) onFieldSaved(); }}
                        />
                      {/if}
                    </div>
                  </FieldCard>
                {:else if fType === 'list'}
                  <FieldCard label={fieldLabel(fKey)} color={fColor} commentSection={fKey} commentCount={commentCounts[fKey] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(fKey) : null}>
                    <div class="text-sm text-slate-600">
                      {#if isPrinting}
                        <ul class="space-y-2">
                          {#each (Array.isArray(getFieldValue(fKey)) ? getFieldValue(fKey) : []) as item}
                            <li class="flex items-start gap-2 text-sm text-slate-600">
                              <span class="mt-1">&#8226;</span>
                              <span>{@html renderMarkdownWithRefs(item, references, { addListStyles: true, listPadding: 1.5 })}</span>
                            </li>
                          {/each}
                        </ul>
                      {:else}
                        <EditableInput
                          {locked}
                          label=""
                          value={arrayToMarkdown(Array.isArray(getFieldValue(fKey)) ? getFieldValue(fKey) : [])}
                          markdown={true}
                          forceList={true}
                          {apiEndpoint}
                          fullData={getListFullData(fKey)}
                          fullDataGetter={() => getListFullData(fKey)}
                          changeId={entityId ? `${entityId}-${fKey}` : ''}
                          originalValue={arrayToMarkdown(Array.isArray(getFieldValue(fKey)) ? getFieldValue(fKey) : [])}
                          {references}
                          on:saved={() => { if (onFieldSaved) onFieldSaved(); }}
                        />
                      {/if}
                    </div>
                  </FieldCard>
                {:else if fType === 'scores'}
                  <!-- Score table (valueScores / complexityScores) -->
                  {#if matrix}
                    {@const isValue = fKey === 'valueScores'}
                    {@const scoreAxes = isValue ? (matrix.valueAxes ?? []) : (matrix.complexityAxes ?? [])}
                    {@const scoreData = data?.[fKey] ?? []}
                    {@const scoreType = isValue ? 'value' : 'complexity'}
                    <FieldCard label={fieldLabel(fKey)} color={fColor} commentSection={fKey} commentCount={commentCounts[fKey] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(fKey) : null}>
                      <ScoreTable
                        axes={scoreAxes}
                        scores={scoreData}
                        displayMode={isValue ? 'stars' : 'xminus'}
                        {locked}
                        apiEndpoint={apiEndpoint}
                        scorePrefix={scoreType}
                        {entityId}
                        {scoreBuffers}
                        {scoreOriginals}
                        {references}
                        onScoreChange={handleScoreChange}
                        onScoreSaved={onFieldSaved}
                        {isPrinting}
                        getScoreFullData={getScoreFullData(scoreType)}
                      />
                    </FieldCard>
                  {/if}
                {:else if fType === 'child-list'}
                  <!-- Placeholder for child-list (future implementation) -->
                  <FieldCard label={fieldLabel(fKey)} color={fColor} commentSection={fKey} commentCount={commentCounts[fKey] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(fKey) : null}>
                    <p class="text-sm text-slate-400 italic">Child list: {fKey}</p>
                  </FieldCard>
                {:else if fType === 'chart'}
                  <!-- Chart placeholder — parent page provides actual chart via slot -->
                  <slot name="chart-{fKey}" />
                {/if}
              </div>
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
