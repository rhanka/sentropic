<script lang="ts">
  /* eslint-disable svelte/no-at-html-tags */
  // {@html} usage routed through renderMarkdownWithRefs(), sanitised via DOMPurify.
  import FieldCard from '$lib/components/FieldCard.svelte';
  import ScoreTable from '$lib/components/ScoreTable.svelte';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import { Star, X, Minus } from '@lucide/svelte';
  import { _ } from 'svelte-i18n';
  import { normalizeUseCaseMarkdown, stripTrailingEmptyParagraph, arrayToMarkdown, arrayToNumberedMarkdown, markdownToArray, renderMarkdownWithRefs } from '$lib/utils/markdown';
  import { resolveViewTemplate } from '$lib/stores/viewTemplateCache';

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
  export let variant: 'colored' | 'plain' | 'bordered' = 'colored';
  export let collections: Record<string, any[]> = {};
  export let workspaceId: string = '';
  export let workspaceType: string = '';
  export let objectType: string = '';

  // ---------------------------------------------------------------------------
  // Path-based nested value access
  // ---------------------------------------------------------------------------
  function getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((acc, part) => acc?.[part], obj);
  }

  /** Return the short key (last segment) for i18n lookups / comment sections */
  function shortKey(key: string): string {
    const idx = key.lastIndexOf('.');
    return idx >= 0 ? key.slice(idx + 1) : key;
  }

  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeReferenceTitle(value: string): string {
    let normalized = value.trim();
    while (/^\*\*[\s\S]*\*\*$/.test(normalized)) {
      normalized = normalized.replace(/^\*\*([\s\S]*)\*\*$/, '$1').trim();
    }
    normalized = normalized.replace(/^\[\d+\]\s*/, '').trim();
    return normalized;
  }

  function stripSingleParagraphWrapper(html: string): string {
    const trimmed = html.trim();
    const match = trimmed.match(/^<p>([\s\S]*)<\/p>$/i);
    return match ? match[1] : trimmed;
  }

  function renderReferenceExcerpt(excerpt: string): string {
    const rendered = stripSingleParagraphWrapper(renderMarkdownWithRefs(excerpt, references));
    return rendered.trim().length > 0
      ? `<span class="text-slate-500"> — ${rendered}</span>`
      : '';
  }

  function renderReferenceLink(title: string, url: string): string {
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="text-blue-600 hover:text-blue-800 underline">${escapeHtml(normalizeReferenceTitle(title))}</a>`;
  }

  function renderReferenceListItem(item: unknown): string {
    if (item && typeof item === 'object') {
      const source = item as Record<string, unknown>;
      const title = typeof source.title === 'string' ? source.title.trim() : '';
      const url = typeof source.url === 'string' ? source.url.trim() : '';
      const excerpt =
        typeof source.excerpt === 'string' && source.excerpt.trim().length > 0
          ? source.excerpt.trim()
          : '';

      if (title && url) {
        return `${renderReferenceLink(title, url)}${excerpt ? renderReferenceExcerpt(excerpt) : ''}`;
      }
      if (url) {
        return renderReferenceLink(url, url);
      }
      if (title) {
        return escapeHtml(title);
      }
    }

    if (typeof item === 'string') {
      const linkMatch = item.match(/^\[(.*?)\]\(([^)]*)\)([\s\S]*)$/);
      if (linkMatch) {
        const [, title, url, trailing] = linkMatch;
        const excerpt = trailing.trim();
        return `${renderReferenceLink(title, url)}${excerpt ? renderReferenceExcerpt(excerpt) : ''}`;
      }
      return stripSingleParagraphWrapper(renderMarkdownWithRefs(item, references));
    }

    try {
      return escapeHtml(JSON.stringify(item));
    } catch {
      return escapeHtml(String(item ?? ''));
    }
  }

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
      const rawVal = f.key.includes('.') ? getNestedValue(data, f.key) : data?.[f.key];
      if (f.type === 'text') {
        incomingText[f.key] = normalizeUseCaseMarkdown(rawVal || '');
      } else if (f.type === 'list') {
        incomingList[f.key] = Array.isArray(rawVal) ? [...rawVal] : [];
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
    // Fallback to raw data — support dot-path traversal for nested fields
    if (key.includes('.')) return getNestedValue(data, key) ?? '';
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

  /**
   * For dot-path keys, gather ALL sibling buffer values under the same parent
   * so the save payload includes the complete sub-object (not just the changed field).
   */
  const buildSiblingPayload = (changedKey: string, changedValue: unknown): Record<string, unknown> => {
    const parts = changedKey.split('.');
    if (parts.length <= 1) return { [changedKey]: changedValue };
    const parentPrefix = parts.slice(0, -1).join('.') + '.';
    const parentPath = parts.slice(0, -1);
    const parentKey = parentPath.join('.');
    const changedLeafKey = parts[parts.length - 1];
    const omitExecutiveSummaryReferences = parentKey === 'executiveSummary' && changedLeafKey !== 'references';
    const rawParent = getNestedValue(data, parentPath.join('.'));
    const merged: Record<string, unknown> = (rawParent && typeof rawParent === 'object') ? { ...rawParent } : {};
    if (omitExecutiveSummaryReferences) {
      delete merged.references;
    }
    for (const bufKey of Object.keys(textBuffers)) {
      if (bufKey.startsWith(parentPrefix)) {
        const leafKey = bufKey.slice(parentPrefix.length);
        merged[leafKey] = stripTrailingEmptyParagraph(normalizeUseCaseMarkdown(textBuffers[bufKey] || ''));
      }
    }
    for (const bufKey of Object.keys(listBuffers)) {
      if (bufKey.startsWith(parentPrefix)) {
        const leafKey = bufKey.slice(parentPrefix.length);
        if (omitExecutiveSummaryReferences && leafKey === 'references') continue;
        const arr = listBuffers[bufKey] ?? [];
        merged[leafKey] = markdownToArray(stripTrailingEmptyParagraph(arrayToMarkdown(arr)));
      }
    }
    merged[changedLeafKey] = changedValue;
    let obj: Record<string, unknown> = {};
    const root = obj;
    for (let i = 0; i < parentPath.length - 1; i++) {
      const next: Record<string, unknown> = {};
      obj[parentPath[i]] = next;
      obj = next;
    }
    obj[parentPath[parentPath.length - 1]] = merged;
    return root;
  };

  // Full-data getters for EditableInput save payloads
  const getTextFullData = (key: string): Record<string, unknown> | null => {
    const value = normalizeUseCaseMarkdown(textBuffers[key] || '');
    const cleaned = stripTrailingEmptyParagraph(value);
    if (key.includes('.')) return buildSiblingPayload(key, cleaned);
    return { [key]: cleaned };
  };

  const getListFullData = (key: string): Record<string, unknown> | null => {
    const arr = listBuffers[key] ?? [];
    const markdown = arrayToMarkdown(arr);
    const cleaned = stripTrailingEmptyParagraph(markdown);
    const listValue = markdownToArray(cleaned);
    if (key.includes('.')) return buildSiblingPayload(key, listValue);
    return { [key]: listValue };
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

  // Long content detection for description-compact-print
  $: isTextContentLong = ((textBuffers.description || '').length || 0) + Math.max(((textBuffers.problem || '').length || 0), ((textBuffers.solution || '').length || 0)) * 2 > 2000;

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
    const sk = shortKey(key);
    const i18nKey = i18nMap[sk] || i18nMap[key];
    if (i18nKey) {
      const translated = $_({ id: i18nKey });
      if (translated && translated !== i18nKey) return translated;
    }
    return sk.charAt(0).toUpperCase() + sk.slice(1).replace(/([A-Z])/g, ' $1');
  };

  // ---------------------------------------------------------------------------
  // Entity-loop: resolve sub-templates for templateRef fields
  // ---------------------------------------------------------------------------
  let entityLoopTemplates: Record<string, any> = {};

  $: {
    const allFields = collectFields(template);
    const loopFields = allFields.filter((f: any) => f.type === 'entity-loop' && f.templateRef);
    const templateRefs = [...new Set(loopFields.map((f: any) => f.templateRef as string))];
    if (workspaceId && workspaceType && templateRefs.length > 0) {
      for (const ref of templateRefs) {
        if (!entityLoopTemplates[ref]) {
          resolveViewTemplate(workspaceId, workspaceType, ref).then((tmpl) => {
            if (tmpl) {
              entityLoopTemplates = { ...entityLoopTemplates, [ref]: tmpl };
            }
          });
        }
      }
    }
  }

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
    <div class="{objectType ? 'template-' + objectType : ''} space-y-6">
      {#each activeTab.rows ?? [] as row}
        {#if row.main && row.sidebar}
          <!-- Main + Sidebar row -->
          <div class="grid gap-6 items-stretch {gridColsClass[row.columns] || 'lg:grid-cols-3'} {row.printClass || ''}">
            <!-- Main zone -->
            <div class="{colSpanClass[row.main?.span] || 'md:col-span-2'} {row.main?.printClass || ''}">
              <!-- Span fields (full width within main) -->
              {#each (row.main.fields ?? []).filter(isSpanField) as field (field.key)}
                <div>
                  {#if field.type === 'text'}
                    <FieldCard variant={field.variant || variant} label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                      <div class="prose prose-slate max-w-none" class:description-compact-print={isTextContentLong}>
                        <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
                          {#if isPrinting || locked}
                            {@html renderMarkdownWithRefs(getFieldValue(field.key) || '', references, { addListStyles: true, listPadding: 1.5 })}
                          {:else}
                            <EditableInput {locked} label="" value={normalizeUseCaseMarkdown(getFieldValue(field.key) || '')} markdown={true} {apiEndpoint} fullData={getTextFullData(field.key)} fullDataGetter={() => getTextFullData(field.key)} changeId={entityId ? `${entityId}-${field.key}` : ''} originalValue={textOriginals[field.key] || ''} {references} on:change={(e) => handleTextChange(field.key, e.detail.value)} on:saved={() => { if (onFieldSaved) onFieldSaved(); }} />
                          {/if}
                        </div>
                      </div>
                    </FieldCard>
                  {:else if field.type === 'list'}
                    <FieldCard variant={field.variant || variant} label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                      <div class="text-sm text-slate-600">
                        {#if shortKey(field.key) === 'references'}
                          <ol class="space-y-2 list-decimal list-outside pl-6 text-sm">
                            {#each (Array.isArray(getFieldValue(field.key)) ? getFieldValue(field.key) : []) as item}
                              <li class="leading-relaxed">{@html renderReferenceListItem(item)}</li>
                            {/each}
                          </ol>
                        {:else if isPrinting || locked}
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
                <div class="grid gap-6 {gridColsClass[row.main.columns] || 'md:grid-cols-2'} {row.main?.printGridClass || ''}">
                  {#each (row.main.fields ?? []).filter(isNotSpanField) as field (field.key)}
                    <div class="h-full">
                      {#if field.type === 'text'}
                        <FieldCard variant={field.variant || variant} label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                          <div class="prose prose-slate max-w-none" class:description-compact-print={isTextContentLong}>
                            <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
                              {#if isPrinting || locked}
                                {@html renderMarkdownWithRefs(getFieldValue(field.key) || '', references, { addListStyles: true, listPadding: 1.5 })}
                              {:else}
                                <EditableInput {locked} label="" value={normalizeUseCaseMarkdown(getFieldValue(field.key) || '')} markdown={true} {apiEndpoint} fullData={getTextFullData(field.key)} fullDataGetter={() => getTextFullData(field.key)} changeId={entityId ? `${entityId}-${field.key}` : ''} originalValue={textOriginals[field.key] || ''} {references} on:change={(e) => handleTextChange(field.key, e.detail.value)} on:saved={() => { if (onFieldSaved) onFieldSaved(); }} />
                              {/if}
                            </div>
                          </div>
                        </FieldCard>
                      {:else if field.type === 'list'}
                        <FieldCard variant={field.variant || variant} label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                          <div class="text-sm text-slate-600">
                            {#if shortKey(field.key) === 'references'}
                              <ol class="space-y-2 list-decimal list-outside pl-6 text-sm">
                                {#each (Array.isArray(getFieldValue(field.key)) ? getFieldValue(field.key) : []) as item}
                                  <li class="leading-relaxed">{@html renderReferenceListItem(item)}</li>
                                {/each}
                              </ol>
                            {:else if isPrinting || locked}
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
            <div class="{colSpanClass[row.sidebar?.span] || ''} h-full {row.sidebar?.printClass || ''}">
              <div class="space-y-6 h-full flex flex-col">
                {#each row.sidebar.fields ?? [] as field (field.key)}
                  {#if field.type === 'text'}
                    <FieldCard variant={field.variant || variant} label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                      <div class="text-slate-600 text-sm">
                        {#if isPrinting || locked}
                          {@html renderMarkdownWithRefs(getFieldValue(field.key) || '', references, { addListStyles: true, listPadding: 1.5 })}
                        {:else}
                          <EditableInput {locked} label="" value={normalizeUseCaseMarkdown(getFieldValue(field.key) || '')} markdown={true} {apiEndpoint} fullData={getTextFullData(field.key)} fullDataGetter={() => getTextFullData(field.key)} changeId={entityId ? `${entityId}-${field.key}` : ''} originalValue={textOriginals[field.key] || ''} {references} on:change={(e) => handleTextChange(field.key, e.detail.value)} on:saved={() => { if (onFieldSaved) onFieldSaved(); }} />
                        {/if}
                      </div>
                    </FieldCard>
                  {:else if field.type === 'list'}
                    <FieldCard variant={field.variant || variant} label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                      <div class="text-sm text-slate-600">
                        {#if shortKey(field.key) === 'references'}
                          <ol class="space-y-2 list-decimal list-outside pl-6 text-sm">
                            {#each (Array.isArray(getFieldValue(field.key)) ? getFieldValue(field.key) : []) as item}
                              <li class="leading-relaxed">{@html renderReferenceListItem(item)}</li>
                            {/each}
                          </ol>
                        {:else if isPrinting || locked}
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
          <div class="grid gap-6 {gridColsClass[row.columns] || 'grid-cols-1'} {row.printClass || ''}">
            {#each row.fields ?? [] as field (field.key)}
              <div id={field.id || null} class:hidden={field.printOnly && !isPrinting} class:print-block={field.printOnly} class:print-hidden={field.screenOnly} style:page={field.pageContext || null}>
              {#if field.type === 'scores-summary'}
                <FieldCard variant={field.variant || variant} label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                  {#if field.key === 'totalValue' && totalValueScore != null}
                    <div class="flex items-center gap-3">
                      <div class="flex items-center gap-1">
                        {#each range(5) as i (i)}
                          <Star class="w-5 h-5 {i < valueStars ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}" />
                        {/each}
                      </div>
                      <span class="text-sm font-bold text-green-600">({totalValueScore.toFixed(0)} {$_('common.pointsAbbr')})</span>
                    </div>
                  {:else if field.key === 'totalComplexity' && totalComplexityScore != null}
                    <div class="flex items-center gap-3">
                      <div class="flex items-center gap-1">
                        {#each range(5) as i (i)}
                          {#if i < complexityStars}
                            <X class="w-5 h-5 text-red-500" />
                          {:else}
                            <Minus class="w-5 h-5 text-gray-300" />
                          {/if}
                        {/each}
                      </div>
                      <span class="text-sm font-bold text-red-600">({totalComplexityScore.toFixed(0)} {$_('common.pointsAbbr')})</span>
                    </div>
                  {/if}
                </FieldCard>
              {:else if field.type === 'text'}
                <div class="{field.span > 1 ? (colSpanClass[field.span] || '') : ''} h-full">
                  <FieldCard variant={field.variant || variant} label={fieldLabel(field.key)} color={field.color || ''} commentSection={shortKey(field.key)} commentCount={commentCounts[shortKey(field.key)] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(shortKey(field.key)) : null}>
                    <div class="{variant === 'bordered' ? 'prose prose-slate max-w-none' : 'text-slate-600 text-sm leading-relaxed prose prose-sm max-w-none'}" class:description-compact-print={isTextContentLong}>
                      <div class="text-slate-700 leading-relaxed [&_p]:mb-4 [&_p:last-child]:mb-0">
                        {#if isPrinting || locked}
                          {@html renderMarkdownWithRefs(getFieldValue(field.key) || '', references, { addListStyles: true, listPadding: 1.5 })}
                        {:else}
                          <EditableInput {locked} label="" value={normalizeUseCaseMarkdown(getFieldValue(field.key) || '')} markdown={true} {apiEndpoint} fullData={getTextFullData(field.key)} fullDataGetter={() => getTextFullData(field.key)} changeId={entityId ? `${entityId}-${field.key}` : ''} originalValue={textOriginals[field.key] || ''} {references} on:change={(e) => handleTextChange(field.key, e.detail.value)} on:saved={() => { if (onFieldSaved) onFieldSaved(); }} />
                        {/if}
                      </div>
                    </div>
                  </FieldCard>
                </div>
              {:else if field.type === 'list'}
                <div class="{field.span > 1 ? (colSpanClass[field.span] || '') : ''} h-full">
                  <FieldCard variant={field.variant || variant} label={fieldLabel(field.key)} color={field.color || ''} commentSection={shortKey(field.key)} commentCount={commentCounts[shortKey(field.key)] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(shortKey(field.key)) : null}>
                    <div class="text-sm text-slate-600">
                      {#if shortKey(field.key) === 'references'}
                        <ol class="space-y-2 list-decimal list-outside pl-6 text-sm">
                          {#each (Array.isArray(getFieldValue(field.key)) ? getFieldValue(field.key) : []) as item}
                            <li class="leading-relaxed">{@html renderReferenceListItem(item)}</li>
                          {/each}
                        </ol>
                      {:else if isPrinting || locked}
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
                    <FieldCard variant={field.variant || variant} label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                      <ScoreTable axes={matrix.valueAxes ?? []} scores={data?.valueScores ?? []} displayMode="stars" {locked} {apiEndpoint} scorePrefix="value" {entityId} {scoreBuffers} {scoreOriginals} {references} onScoreChange={handleScoreChange} onScoreSaved={onFieldSaved} {isPrinting} getScoreFullData={getScoreFullDataFn('value')} />
                    </FieldCard>
                  {:else if field.key === 'complexityScores'}
                    <FieldCard variant={field.variant || variant} label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                      <ScoreTable axes={matrix.complexityAxes ?? []} scores={data?.complexityScores ?? []} displayMode="xminus" {locked} {apiEndpoint} scorePrefix="complexity" {entityId} {scoreBuffers} {scoreOriginals} {references} onScoreChange={handleScoreChange} onScoreSaved={onFieldSaved} {isPrinting} getScoreFullData={getScoreFullDataFn('complexity')} />
                    </FieldCard>
                  {/if}
                </div>
              {:else if field.type === 'child-list'}
                <FieldCard variant={field.variant || variant} label={fieldLabel(field.key)} color={field.color || ''} commentSection={field.key} commentCount={commentCounts[field.key] ?? 0} onOpenComments={onOpenComments ? () => onOpenComments(field.key) : null}>
                  <p class="text-sm text-slate-400 italic">Child list: {field.key}</p>
                </FieldCard>
              {:else if field.type === 'chart'}
                <!-- Chart fields are rendered by the parent page via slot -->
                <slot name="chart" chartKey={field.key} />
              {:else if field.type === 'component'}
                <!-- Component fields are rendered by the parent page via slot -->
                <slot name="component" fieldKey={field.key} />
              {:else if field.type === 'entity-loop'}
                {#if field.collection && collections[field.collection] && field.templateRef && entityLoopTemplates[field.templateRef]}
                  {#each collections[field.collection] as entity, idx (entity.id)}
                    <section id={entity.id ? `usecase-${entity.id}` : null} class="usecase-annex-section" style="page-break-before: always; {field.pageContext ? 'page: ' + field.pageContext : ''}" data-usecase-id={entity.id || ''} data-usecase-title={entity?.data?.name || entity?.name || ''}>
                      <h1 class="text-3xl font-semibold mb-4">{entity?.data?.name || entity?.name || ''}</h1>
                      <svelte:self
                        template={entityLoopTemplates[field.templateRef]}
                        data={entity?.data ? { ...entity, ...entity.data } : entity}
                        locked={true}
                        isPrinting={true}
                        variant="colored"
                        {matrix}
                        entityId={entity.id ?? ''}
                        references={[]}
                        objectType={field.templateRef}
                      />
                    </section>
                  {/each}
                {/if}
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

<style>
  @media print {
    :global(.template-initiative .column-b) > :global(div) { display: contents !important; }
    :global(.template-initiative .column-a) > :global(div:not(.layout-quad):not(.rounded-lg)) { display: contents !important; }
    .print-block { display: block !important; }
    .space-y-6 > :not([hidden]) ~ :not([hidden]) { margin-top: 0 !important; }
    .space-y-6 { gap: 0 !important; margin: 0 !important; padding: 0 !important; }
  }
</style>
