<script>
  import { language, setLanguage, t, localize } from './i18n.js';
  import { onMount } from 'svelte';
  import {
    Alert, AppShell, Badge, Button, Card, Container, Flex, ProgressBar,
    SlideIndicator, Stack, Textarea, Tile, ThemeProvider, Typography
  } from '@sentropic/design-system-svelte';
  import { entropicTheme, createComponent } from '@sentropic/design-system-themes';
  import dossierSource from '../dossier.json';
  import rawSpec from '../raw-spec.md?raw';
  import briefSource from './decision-brief.json';
  import ArchitectureFigure from './ArchitectureFigure.svelte';
  import presentation from './presentation-scenes.json';
  const dossier = $derived(localize(dossierSource, $language));
  const brief = $derived(localize(briefSource, $language));
  const architectureScenes = $derived(presentation[$language].architectureScenes);
  const decisionScenes = $derived(presentation[$language].decisionScenes);
  const ROUTED_NEEDS = $derived(localize(presentation.navigation.needs, $language));
  const GIGOGNE_VIEWS = $derived(localize(presentation.navigation.views, $language));

  const introduction = $derived(localize([
    { phase: 'central', title: 'Responsabilités des quatre projets', scene: null },
    { phase: 'capabilities', title: 'Capacités proposées', scene: 'annotate' },
    { phase: 'ontologies', title: 'Profils, moteur et rendu', scene: 'ontologies' },
    { phase: 'memory', title: 'Mémoire des agents', scene: 'memory' },
    { phase: 'migration', title: 'Livraison et qualification', scene: 'traceability' },
  ], $language));
  const introSlides = 5;
  const slidesTotal = dossier.decisions.length + introSlides;
  const storageKey = `focus:${dossier.id}:${dossier.revision}`;
  const ownerSelections = Object.fromEntries(
    dossier.decisions
      .filter((decision) => decision.ownerChoice !== null)
      .map((decision) => [decision.key, decision.ownerChoice])
  );

  function computeOptionSignature(decisionKey, optionKey) {
    const decision = dossierSource.decisions.find((item) => item.key === decisionKey);
    const option = decision?.options.find((item) => item.key === optionKey);
    if (!decision || !option) return null;
    const raw = `${decision.key}|${decision.question}|${option.key}|${option.title}|${option.consequence}`;
    let hash = 2166136261;
    for (let i = 0; i < raw.length; i += 1) {
      hash ^= raw.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `${decision.key}:${option.key}:${(hash >>> 0).toString(16).padStart(8, '0')}:${option.title}`;
  }

  let current = $state(0);
  let architectureMode = $state('central');
  let selectedNeedId = $state(null);
  let selections = $state({ ...ownerSelections });
  let optionSignatures = $state({});
  let staleSelections = $state({});
  let notes = $state({});
  let remarkComplements = $state({});
  let copied = $state('');
  let pointerStart = null;
  const swipePointers = new Set();
  let swipeBlocked = false;

  // The portable file stays readable while its script loads or is blocked.
  // The pinned Entropic theme supplies light tokens only. Build its dark
  // counterpart from the same DS foundation and regenerate component tokens.
  const { foundation, semantic } = entropicTheme.tokens;
  const slate = foundation.color.slate;
  const lighter = value => `color-mix(in srgb, ${value} 72%, ${slate[0]})`;
  const darkFeedback = Object.fromEntries(Object.entries(semantic.feedback).map(([key, value]) => [key, lighter(value)]));
  const darkSemantic = {
    ...semantic,
    surface: { default: slate[90], subtle: slate[80], raised: slate[80], inverse: slate[10], overlay: semantic.surface.overlay },
    text: { primary: slate[10], secondary: slate[20], muted: lighter(semantic.text.muted), inverse: slate[90], link: lighter(semantic.action.primary) },
    border: { subtle: slate[60], strong: lighter(semantic.border.strong), interactive: lighter(semantic.action.primary) },
    action: { ...semantic.action, primary: lighter(semantic.action.primary), primaryHover: lighter(semantic.feedback.info), primaryText: slate[90], secondary: slate[80], secondaryHover: slate[60], secondaryText: slate[10], danger: darkFeedback.error },
    feedback: darkFeedback,
    status: { pending: darkFeedback.warning, processing: darkFeedback.info, completed: darkFeedback.success, failed: darkFeedback.error },
  };
  const darkComponents = createComponent(darkSemantic, foundation);
  const darkTheme = { ...entropicTheme, id: 'entropic-dark', mode: 'dark', tokens: {
    foundation, semantic: darkSemantic, component: { ...darkComponents,
      badge: { ...darkComponents.badge, infoBackground: `color-mix(in srgb, ${darkFeedback.info} 14%, ${slate[90]})` },
    },
  } };
  let activeTheme = $state(entropicTheme);
  $effect(() => { document.documentElement.lang = $language; });
  onMount(() => {
    document.getElementById('portable-fallback')?.remove();
    const preference = window.matchMedia('(prefers-color-scheme: dark)');
    const updateTheme = () => { activeTheme = preference.matches ? darkTheme : entropicTheme; };
    updateTheme();
    preference.addEventListener('change', updateTheme);
    return () => preference.removeEventListener('change', updateTheme);
  });

  const currentLabel = $derived(
    current < introSlides ? introduction[current].title :
    `${t('Décision', $language)} ${current - introSlides + 1} / ${dossier.decisions.length}`
  );

  const selectedNeed = $derived(
    ROUTED_NEEDS.find((item) => item.id === selectedNeedId) ?? null
  );

  const activeHighlight = $derived.by(() => {
    if (!selectedNeed) return null;
    if (architectureMode === 'central') {
      return { needId: selectedNeed.id, ...selectedNeed.highlight };
    }
    const scene = architectureScenes[architectureMode];
    if (!scene) return null;
    return {
      needId: selectedNeed.id,
      groups: scene.groups.map((g) => g.id),
      nodes: scene.nodes.map((n) => n.id),
      edges: scene.edges.map((e) => e.id),
    };
  });

  function selectNeed(needId) {
    selectedNeedId = needId;
    architectureMode = 'central';
  }

  function selectGigogneView(viewId) {
    architectureMode = viewId;
    if (viewId !== 'central' && (!selectedNeed || selectedNeed.gigogneScene !== viewId)) {
      const matching = ROUTED_NEEDS.find((item) => item.gigogneScene === viewId);
      if (matching) selectedNeedId = matching.id;
    }
  }

  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        selections,
        optionSignatures,
        staleSelections,
        notes,
        remarkComplements,
      }));
    } catch {
      // Opaque-origin previews and private WebViews can deny storage. Keep the
      // current answers in memory so selection, typing and export still work.
    }
  }

  function choose(decisionKey, optionKey) {
    if (dossierSource.decisions.find(d => d.key === decisionKey)?.decisionStatus === 'accepted') return;
    selections[decisionKey] = optionKey;
    optionSignatures[decisionKey] = computeOptionSignature(decisionKey, optionKey);
    delete staleSelections[decisionKey];
    selections = { ...selections };
    optionSignatures = { ...optionSignatures };
    staleSelections = { ...staleSelections };
    persist();
  }

  function setNote(decisionKey, value) {
    notes[decisionKey] = value;
    notes = { ...notes };
    persist();
  }

  function setRemarkComplement(decisionKey, value) {
    remarkComplements[decisionKey] = value;
    remarkComplements = { ...remarkComplements };
    persist();
  }

  function previous() { current = Math.max(0, current - 1); }
  function next() { current = Math.min(slidesTotal - 1, current + 1); }

  function onPointerDown(event) {
    if (event.target.closest('button, textarea, input, a, summary, .table-scroll, .architecture-figure')) return;
    swipePointers.add(event.pointerId);
    if (!event.isPrimary || swipePointers.size > 1) {
      swipeBlocked = true;
      pointerStart = null;
      return;
    }
    if (swipeBlocked || event.button !== 0) return;
    pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event) {
    const start = pointerStart;
    swipePointers.delete(event.pointerId);
    if (!swipePointers.size) swipeBlocked = false;
    pointerStart = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (dx < 0) next(); else previous();
  }

  function cancelSwipe() {
    pointerStart = null;
    swipePointers.clear();
    swipeBlocked = false;
  }

  function answerSet() {
    return {
      dossier: dossier.id,
      revision: dossier.revision,
      architectureHash: dossier.architectureHash,
      capturedAt: new Date().toISOString(),
      capturedFrom: 'focus decision kit',
      answers: Object.fromEntries(dossier.decisions.map((decision) => {
        const selectedKey = selections[decision.key] ?? null;
        const selectedOption = selectedKey ? decision.options.find((candidate) => candidate.key === selectedKey) ?? null : null;
        return [decision.key, {
          option: selectedOption ? selectedOption.key : null,
          optionTitle: selectedOption ? selectedOption.title : null,
          optionSignature: selectedOption ? computeOptionSignature(decision.key, selectedOption.key) : null,
          staleDraft: staleSelections[decision.key] ?? null,
          decisionStatus: decision.decisionStatus,
          decidedAt: decision.decidedAt,
          ownerQuote: decision.ownerQuote,
          note: notes[decision.key]?.trim() ?? '',
          ownerRemarks: decision.ownerRemarks,
          briefProvenance: decision.briefProvenance ?? null,
          responses: decision.response,
          remarkComplement: remarkComplements[decision.key]?.trim() ?? ''
        }];
      }))
    };
  }

  function summary() {
    const lines = [
      `# ${dossier.title}`, '',
      `${t("Révision", $language)} : ${dossier.revision}`,
      `Architecture : ${dossier.architectureHash}`, ''
    ];
    for (const decision of dossier.decisions) {
      const option = decision.options.find((candidate) => candidate.key === selections[decision.key]);
      const stale = staleSelections[decision.key];
      lines.push(`## ${decision.key} · ${decision.title}`);
      lines.push(`${t("Choix", $language)} : ${option ? `${option.key} — ${option.title} [${computeOptionSignature(decision.key, option.key)}]` : stale ? `${t('non choisi', $language)} (${decision.key}-${stale.option}: ${t('Brouillon à reconfirmer après modification du libellé', $language)})` : t('non choisi', $language)}`);
      if (decision.briefProvenance) {
        lines.push(`${t('Provenance du brief/conductor', $language)} ${decision.briefProvenance.round} : ${decision.briefProvenance.text}`);
      }
      if (decision.ownerRemarks.length === 0) {
        lines.push(`${t('Remarque owner', $language)} : —`);
      } else {
        decision.ownerRemarks.forEach((remark, index) => {
          lines.push(`${t("Remarque owner", $language)} ${remark.round} : ${remark.text}`);
          lines.push(`${t("Réponse", $language)} ${decision.response[index]?.round ?? '—'} : ${decision.response[index]?.text ?? t('RÉPONSE MANQUANTE', $language)}`);
        });
      }
      lines.push(`${t("Complément de remarque", $language)} : ${remarkComplements[decision.key]?.trim() || '—'}`);
      lines.push(`Note : ${notes[decision.key]?.trim() || '—'}`, '');
    }
    if (dossier.convergence.ownerFeedbackAnnex) {
      lines.push(`## ${dossier.convergence.ownerFeedbackAnnex.title}`);
      lines.push(`Source : ${dossier.convergence.ownerFeedbackAnnex.source}`, '');
      lines.push('```text', dossier.convergence.ownerFeedbackAnnex.rawText, '```', '');
    }
    return lines.join('\n');
  }

  async function copy(value, kind) {
    await navigator.clipboard.writeText(value);
    copied = kind;
    window.setTimeout(() => { if (copied === kind) copied = ''; }, 2400);
  }

  if (typeof window !== 'undefined') {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      const nextNotes = saved?.notes && typeof saved.notes === 'object' ? { ...saved.notes } : {};
      const nextRemarks = saved?.remarkComplements && typeof saved.remarkComplements === 'object' ? { ...saved.remarkComplements } : {};
      const nextSelections = { ...ownerSelections };
      const nextSignatures = {};
      const nextStale = saved?.staleSelections && typeof saved.staleSelections === 'object' ? { ...saved.staleSelections } : {};
      for (const [key, optKey] of Object.entries(nextSelections)) {
        const sig = computeOptionSignature(key, optKey);
        if (sig) nextSignatures[key] = sig;
      }
      if (saved?.selections && typeof saved.selections === 'object') {
        for (const decision of dossier.decisions) {
          if (decision.decisionStatus === 'accepted') { delete nextStale[decision.key]; continue; }
          const savedOptKey = saved.selections[decision.key];
          if (!savedOptKey) continue;
          const expectedSig = computeOptionSignature(decision.key, savedOptKey);
          const savedSig = saved.optionSignatures?.[decision.key] ?? null;
          if (expectedSig && savedSig === expectedSig) {
            nextSelections[decision.key] = savedOptKey;
            nextSignatures[decision.key] = expectedSig;
            delete nextStale[decision.key];
          } else {
            delete nextSelections[decision.key];
            delete nextSignatures[decision.key];
            nextStale[decision.key] = {
              option: savedOptKey,
              savedSignature: savedSig,
              priorNote: nextNotes[decision.key] ?? '',
            };
          }
        }
      }
      selections = nextSelections;
      optionSignatures = nextSignatures;
      staleSelections = nextStale;
      notes = nextNotes;
      remarkComplements = nextRemarks;
      if (Object.keys(nextStale).length > 0) {
        persist();
      }
    } catch {
      selections = { ...ownerSelections };
      optionSignatures = {};
      staleSelections = {};
      notes = {};
      remarkComplements = {};
    }
  }
</script>

<svelte:head><title>{t("Focus · contrat d’unification de la gouvernance", $language)}</title></svelte:head>

{#snippet detailTable(detailSection, prefix)}
  <section class="decision-details" aria-labelledby={`${prefix}-${encodeURIComponent(detailSection.title)}`}>
    <Typography variant="h3" id={`${prefix}-${encodeURIComponent(detailSection.title)}`}>{detailSection.title}</Typography>
    {#each detailSection.paragraphs ?? [] as paragraph}<p class="decision-context">{paragraph}</p>{/each}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard focus enables native table scrolling.) -->
    {#if detailSection.rows}
    <div class="table-scroll" tabindex="0" role="region" aria-label={detailSection.title}>
      <table>
        <thead><tr>{#each detailSection.columns as column}<th scope="col">{column}</th>{/each}</tr></thead>
        <tbody>
          {#each detailSection.rows as row}
            <tr>{#each row as cell, index}
              {#if index === 0}<th scope="row">{cell}</th>{:else}<td>{cell}</td>{/if}
            {/each}</tr>
          {/each}
        </tbody>
      </table>
    </div>
    {/if}
  </section>
{/snippet}

<ThemeProvider theme={activeTheme}>
  <AppShell variant="workspace" class="dossier-shell">
    {#snippet main()}
      <Container size="full" padding>
        <main class="dossier" aria-labelledby="dossier-title" onpointerdown={onPointerDown} onpointerup={onPointerUp} onpointercancel={cancelSwipe}>
          <Stack gap={4}>
            <header class="dossier-header">
              <Stack gap={2}>
                <Flex align="center" justify="between" wrap gap={2}>
                  <Flex align="center" wrap gap={2}>
                    <Badge tone="info">{t("Dossier décisionnel", $language)}</Badge>
                    <Badge tone="neutral">{t("h2a · Engram · Sentropic · Design System", $language)}</Badge>
                    <Badge tone="warning">{dossier.decisions.length} {t("décisions actées (G1–G3)", $language)}</Badge>
                  </Flex>
                  <Flex align="center" gap={2}>
                    <div class="language-switch" role="group" aria-label={t('Langue du dossier', $language)}>
                      <Button size="sm" variant={$language === 'fr' ? 'primary' : 'secondary'} aria-pressed={$language === 'fr'} aria-label="Français" onclick={() => setLanguage('fr')}>FR</Button>
                      <Button size="sm" variant={$language === 'en' ? 'primary' : 'secondary'} aria-pressed={$language === 'en'} aria-label="English" onclick={() => setLanguage('en')}>EN</Button>
                    </div>
                    <Badge tone="neutral">{t("Révision", $language)} {dossier.revision}</Badge>
                  </Flex>
                </Flex>
                <Typography variant="h1" id="dossier-title">{dossier.title}</Typography>
                <p class="lede">{dossier.summary}</p>
                <ProgressBar label={t("Progression du dossier", $language)} value={current + 1} max={slidesTotal} valueText={currentLabel} showValue />
              </Stack>
            </header>

            {#if current < introSlides}
              {@const intro = introduction[current]}
              <Card>
                <Stack gap={4}>
                  <Flex align="center" justify="between" wrap gap={2}>
                    <Typography variant="h2">{intro.title}</Typography>
                    <span>{t("Carte", $language)} {current + 1} {t("sur", $language)} {slidesTotal}</span>
                  </Flex>
                  {#if current === 0}
                    <section aria-label={t("Sélecteur de besoins à router sur le diagramme central", $language)}>
                      <Stack gap={2}>
                        <Flex align="center" justify="between" wrap gap={2}>
                          <Typography variant="h3">{t("Choisir un besoin", $language)}</Typography>
                          <Badge tone="info">{selectedNeed ? `${selectedNeed.shortLabel} (${selectedNeed.needIds.join(', ')})` : t("Vue complète (N01–N33)", $language)}</Badge>
                        </Flex>
                        <div class="need-selector-bar" role="group" aria-label={t("Besoins routés sur le diagramme central", $language)}>
                          <Button size="sm"
                            variant={selectedNeedId === null ? 'primary' : 'secondary'}
                            data-need-id="all"
                            onclick={() => selectNeed(null)}
                          >{t("Vue complète (N01–N33)", $language)}</Button>
                          {#each ROUTED_NEEDS as need}
                            <Button size="sm"
                              variant={selectedNeedId === need.id ? 'primary' : 'secondary'}
                              data-need-id={need.id}
                              onclick={() => selectNeed(need.id)}
                            >{need.shortLabel}</Button>
                          {/each}
                        </div>
                      </Stack>
                    </section>

                    <section aria-label={t("Vues gigognes d’étude du diagramme", $language)}>
                      <Stack gap={2}>
                        <Flex align="center" justify="between" wrap gap={2}>
                          <Typography variant="h3">{t("Vues détaillées", $language)}</Typography>
                        </Flex>
                        <div class="gigogne-selector-bar" role="group" aria-label={t("Vues gigognes ouvrables", $language)}>
                          {#each GIGOGNE_VIEWS as view}
                            <Button size="sm"
                              variant={architectureMode === view.id ? 'primary' : 'secondary'}
                              data-gigogne-id={view.id}
                              onclick={() => selectGigogneView(view.id)}
                            >{view.label} · {view.badge}</Button>
                          {/each}
                        </div>
                      </Stack>
                    </section>

                    <div class="central-workspace">
                      <ArchitectureFigure
                        scene={architectureScenes[architectureMode]}
                        highlight={activeHighlight}
                        label={`${t("Architecture — ", $language)}${GIGOGNE_VIEWS.find(view => view.id === architectureMode)?.label}`}
                        title={architectureScenes[architectureMode].title}
                      />

                      <Stack gap={3}>
                        {#if selectedNeed}
                          <Tile data-active-route-card={selectedNeed.id}>
                            <Stack gap={2}>
                              <Flex align="center" justify="between" wrap gap={2}>
                                <Badge tone="warning">{t("Route active ·", $language)} {selectedNeed.needIds.join(', ')}</Badge>
                                <Badge tone="info">{t("Capacité", $language)} {selectedNeed.capabilityId}</Badge>
                              </Flex>
                              <Typography variant="h3">{selectedNeed.title}</Typography>
                              <p><strong>{t("Question :", $language)}</strong> {selectedNeed.question}</p>
                              <p data-route-owner><strong>{t("Responsable principal proposé :", $language)}</strong> {selectedNeed.accountableOwner}</p>
                              <p data-route-contributors><strong>{t("Projets contributeurs :", $language)}</strong> {selectedNeed.contributingOwners}</p>
                              <div class="readiness-strip" aria-label={t("État de disponibilité actuel sur 4 axes", $language)}>
                                <Badge tone="neutral" size="sm">{t("Décision :", $language)} {selectedNeed.readiness.decision}</Badge>
                                <Badge tone="neutral" size="sm">{t("Code source :", $language)} {selectedNeed.readiness.source}</Badge>
                                <Badge tone="neutral" size="sm">{t("Publication :", $language)} {selectedNeed.readiness.release}</Badge>
                                <Badge tone="neutral" size="sm">{t("Exécution hôte :", $language)} {selectedNeed.readiness.host}</Badge>
                              </div>
                              <p><strong>{t("Garde de frontière :", $language)}</strong> {selectedNeed.nonOwnerGuard}</p>
                              {#if selectedNeed.gigogneScene !== architectureMode}
                                <Button size="sm"
                                  variant="secondary"
                                  onclick={() => selectGigogneView(selectedNeed.gigogneScene)}
                                >{t("Ouvrir la vue d’étude détaillée (", $language)}{GIGOGNE_VIEWS.find(view => view.id === selectedNeed.gigogneScene)?.label})</Button>
                              {:else if architectureMode !== 'central'}
                                <Button size="sm"
                                  variant="secondary"
                                  onclick={() => selectGigogneView('central')}
                                >{t("Revenir à la vue centrale du croquis", $language)}</Button>
                              {/if}
                            </Stack>
                          </Tile>
                        {/if}

                      </Stack>
                    </div>

                  {:else if intro.scene}
                    <ArchitectureFigure scene={architectureScenes[intro.scene]} label={intro.title} title={architectureScenes[intro.scene].title} />
                  {/if}
                  {@render detailTable(brief[intro.phase], intro.phase)}
                </Stack>
              </Card>
            {:else}
              {@const decision = dossier.decisions[current - introSlides]}
              <Card>
                <Stack gap={4}>
                  <Flex align="center" justify="between" wrap gap={2}>
                    <Flex align="center" wrap gap={2}>
                      <Badge tone="info">{decision.key}</Badge>
                      <Badge tone="neutral" size="sm">{decision.statusLabel}</Badge>
                    </Flex>
                    <span>{t("Décision", $language)} {current - introSlides + 1} {t("sur", $language)} {dossier.decisions.length}</span>
                  </Flex>
                  <Stack gap={2}>
                    <Typography variant="h2">{decision.title}</Typography>
                    <div class="owner-entry">{#each decision.ownerRemarks as remark}<p class="verbatim" lang="fr" translate="no">{remark.text}</p>{/each}</div>
                  </Stack>
                  {#if decision.diagram}
                    <section class="decision-diagram" aria-labelledby={`diagram-${decision.key}`}>
                      <Typography variant="h3" id={`diagram-${decision.key}`}>{t("Ce qui change entre les options", $language)}</Typography>
                      <ArchitectureFigure scene={decisionScenes[decision.diagram.scene]} label={`${decision.key} — ${decision.diagram.title}`} title={`${decision.key} · ${decision.diagram.title}`} compact />
                    </section>
                  {/if}
                  {#if staleSelections[decision.key]}
                    <div data-stale-selection={decision.key}>
                      <Alert
                        tone="warning"
                        title={`${t("Choix précédent (", $language)}${decision.key}-${staleSelections[decision.key].option}${t(") à reconfirmer — le libellé de l’option a évolué", $language)}`}
                        message={`${t("Votre brouillon local désignait l’option ", $language)}${staleSelections[decision.key].option}${t(" d’une version antérieure de cette question. Aucune option n’est sélectionnée d’office afin d’éviter tout ré-engagement implicite : votre note précédente est conservée ci-dessous", $language)}${staleSelections[decision.key].priorNote ? ` (« ${staleSelections[decision.key].priorNote} »)` : ''}${t(" et vous pouvez sélectionner explicitement une option à jour.", $language)}`}
                      />
                    </div>
                  {/if}
                  <div class="option-grid">
                    {#each decision.options as option}
                      <Tile variant="default" data-owner-decision={`${decision.key}-${option.key}`}>
                        <Stack gap={2}>
                          <Flex align="center" wrap gap={2}>
                            <Badge tone="neutral">{option.key}</Badge>
                            {#if selections[decision.key] === option.key}<Badge tone="info" size="sm">{t("Votre choix", $language)}</Badge>{/if}
                          </Flex>
                          <p>{option.consequence}</p>
                          <p><strong>{t("Atouts :", $language)}</strong> {option.strengths}</p>
                          <p><strong>{t("Coûts et conditions :", $language)}</strong> {option.openPoints}</p>
                        </Stack>
                      </Tile>
                    {/each}
                  </div>
                  <Textarea label={t("Votre note", $language)} helperText={t("Réserve ou condition à transmettre.", $language)} rows={4} value={notes[decision.key] ?? ''} oninput={(event) => setNote(decision.key, event.currentTarget.value)} />
                </Stack>
              </Card>
            {/if}

            <nav class="dossier-nav" aria-label={t("Navigation dans le dossier", $language)}>
              <Button size="sm" variant="secondary" onclick={previous} disabled={current === 0}>{t("Précédente", $language)}</Button>
              <SlideIndicator count={slidesTotal} current={current} onChange={(index) => current = index} label={t("Accéder à une carte", $language)} variant="bars" />
              <Button size="sm" variant="primary" onclick={next} disabled={current === slidesTotal - 1}>{t("Suivante", $language)}</Button>
            </nav>
            <Card>
              <Stack gap={3}>
                <Flex align="center" justify="between" wrap gap={2}>
                  <div><Typography variant="h2">{t("Copier le dossier ou les réponses", $language)}</Typography><p class="muted-copy">{t("Vos notes restent dans ce navigateur.", $language)}</p></div>
                  <Badge tone="neutral">{Object.keys(selections).length} / {dossier.decisions.length} {t("choix", $language)}</Badge>
                </Flex>
                <Flex align="center" wrap gap={2}>
                  <Button size="sm" variant="primary" onclick={() => copy(JSON.stringify(answerSet(), null, 2), 'answers')}>{t("Copier les réponses JSON", $language)}</Button>
                  <Button size="sm" variant="secondary" onclick={() => copy(summary(), 'summary')}>{t("Copier la synthèse Markdown", $language)}</Button>
                  <Button size="sm" variant="secondary" onclick={() => copy(rawSpec, 'spec')}>{t("Copier la demande brute", $language)}</Button>
                </Flex>
                {#if copied}<Alert tone="success" title={t("Copié", $language)} message={copied === 'answers' ? t("Jeu de réponses JSON copié.", $language) : copied === 'summary' ? t("Synthèse Markdown copiée.", $language) : t("Demande brute copiée.", $language)} />{/if}
              </Stack>
            </Card>
          </Stack>
        </main>
      </Container>
    {/snippet}
  </AppShell>
</ThemeProvider>
