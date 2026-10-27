<script>
  import { onMount } from 'svelte';
  import { ThemeProvider, Button, Badge, Card, Tile, Container } from '@sentropic/design-system-svelte';
  import { entropicTheme, createComponent } from '@sentropic/design-system-themes';
  import dossier from '../dossier.json';
  import content from './harness-content.json';
  import scenes from './harness-scenes.json';
  import ArchitectureFigure from "./ArchitectureFigure.svelte";
  import { diagramIcon } from './architecture-icons.js';
  const questions = dossier.sections.filter(s => s.kind === 'question');
  const options = id => dossier.sections.find(s => s.kind === 'optionSet' && s.questionId === id).options;
  const tabs = ['Vue d’ensemble', '1 · Plans validés', '2 · Espaces protégés', 'Inventaire · 24 + 8', 'Sources et corrections'];
  const plain = text => text.replaceAll('[FACT]', 'Fait sourcé —').replaceAll('[JUDGMENT]', 'Appréciation —').replaceAll('Incomplete', 'Incomplet');
  let current = $state(0), diagram = $state('qualification'), selections = $state({}), dark = $state(false);
  const { foundation, semantic } = entropicTheme.tokens;
  const slate = foundation.color.slate;
  const lighter = value => `color-mix(in srgb, ${value} 72%, ${slate[0]})`;
  const feedback = Object.fromEntries(Object.entries(semantic.feedback).map(([key, value]) => [key, lighter(value)]));
  const darkSemantic = { ...semantic,
    surface: { default: slate[90], subtle: slate[80], raised: slate[80], inverse: slate[10], overlay: semantic.surface.overlay },
    text: { primary: slate[10], secondary: slate[20], muted: lighter(semantic.text.muted), inverse: slate[90], link: lighter(semantic.action.primary) },
    border: { subtle: slate[60], strong: lighter(semantic.border.strong), interactive: lighter(semantic.action.primary) },
    action: { ...semantic.action, primary: lighter(semantic.action.primary), primaryHover: lighter(semantic.feedback.info), primaryText: slate[90], secondary: slate[80], secondaryHover: slate[60], secondaryText: slate[10], danger: feedback.error },
    feedback, status: { pending: feedback.warning, processing: feedback.info, completed: feedback.success, failed: feedback.error },
  };
  const darkTheme = { ...entropicTheme, id: 'entropic-dark', mode: 'dark', tokens: { foundation, semantic: darkSemantic, component: createComponent(darkSemantic, foundation) } };
  onMount(() => { document.getElementById('portable-fallback')?.remove(); dark = matchMedia('(prefers-color-scheme: dark)').matches; });
  function go(index) { current = index; window.scrollTo({top:0, behavior:'instant'}); }
  function download(name, value) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
    const a = document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
</script>

<svelte:head><title>{dossier.title}</title></svelte:head>

{#snippet table(columns, rows, label)}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable table region.) -->
  <div class="table-scroll" role="region" aria-label={label} tabindex="0">
    <table><thead><tr>{#each columns as column}<th scope="col">{column}</th>{/each}</tr></thead>
      <tbody>{#each rows as row}<tr>{#each row as cell,index}{#if index === 0}<th scope="row">{cell}</th>{:else}<td>{cell}</td>{/if}{/each}</tr>{/each}</tbody>
    </table>
  </div>
{/snippet}
{#snippet diagramTabs()}
  <div class="scene-tabs" role="group" aria-label="Vue du diagramme">
    <Button size="sm" variant={diagram === 'qualification' ? 'primary':'secondary'} aria-pressed={diagram === 'qualification'} onclick={()=>diagram='qualification'}>Qualification</Button>
    <Button size="sm" variant={diagram === 'roles' ? 'primary':'secondary'} aria-pressed={diagram === 'roles'} onclick={()=>diagram='roles'}>Rôles</Button>
  </div>
{/snippet}

<ThemeProvider theme={dark ? darkTheme : entropicTheme}>
  <div class="harness-dossier" data-mode={dark ? 'dark':'light'}>
    <header class="title-band"><h1>{dossier.title}</h1><Button variant="ghost" size="sm" aria-pressed={dark} onclick={()=>dark=!dark}>Thème {dark ? 'clair':'sombre'}</Button></header>
    <Container size="full"><main class="dossier">
      <div class="reading-meta"><span class="editorial-kicker">DOSSIER DE DÉCISION · 27 OCTOBRE 2026</span><span>2 questions · 7 min + inventaire 5 min · {content.revision}</span></div>
      <nav class="page-tabs" aria-label="Parcours du dossier">{#each tabs as tab,index}<Button size="sm" variant={current===index ? 'primary':'secondary'} aria-current={current===index ? 'page':undefined} onclick={()=>go(index)}>{tab}</Button>{/each}</nav>
      {#if current === 0}
        <section aria-labelledby="overview-title" class="overview">
          <div class="section-heading"><div><span class="editorial-kicker">CE QUI RESTE À DÉCIDER</span><h2 id="overview-title">Vos plans. Vos espaces de travail.</h2></div><Badge tone="warning">Décisions incomplètes</Badge></div>
          <p class="lede">{content.summary}</p>
          <div class="overview-cards">
            {#each questions as q,index}<Card><div class="overview-card"><svg viewBox="0 0 70 70" aria-hidden="true">{@html diagramIcon(index===0 ? 'people':'shield',0,0,70)}</svg><div><span class="editorial-kicker">QUESTION {index+1}</span><h3>{index===0?'Adopter le texte testé':'Choisir le défaut du garde'}</h3><p>{index===0?'Deux revues finales restent nécessaires.':'Le parcours complet reste à qualifier.'}</p><Button size="sm" variant="secondary" onclick={()=>go(index+1)}>Lire les trois options</Button></div></div></Card>{/each}
          </div>
          { diagramTabs()}
          <ArchitectureFigure scene={scenes[diagram]} title="Deux parcours indépendants" label={scenes[diagram].shortCaption}  />
          
          <div class="capitalization-note"><div><span class="editorial-kicker">CAPITALISER LES CORRECTIONS</span><p><strong>8 conventions restent à transmettre au harnais.</strong> Le titre discret et les questions courtes sont déjà prescrits ; les cartes, les zones et leurs interactions vivent encore dans les kits.</p></div><Button size="sm" variant="secondary" onclick={()=>go(3)}>Voir les écarts</Button></div>
        </section>
      {:else if current === 1 || current === 2}
        {@const q = questions[current-1]}
        {@const paragraphs = q.context.split('\n')}
        <section class="decision-page" aria-labelledby="question-title">
          <div class="section-heading"><div><span class="editorial-kicker">QUESTION {current} SUR 2 · MOINS DE 2 MINUTES</span><h2 id="question-title">{q.question}</h2></div><Badge tone="warning">Incomplet · choix ouvert</Badge></div>
          <blockquote>{paragraphs[0]}</blockquote>
          <div class="decision-context-grid">
            <Card class="fact-context"><h3>Ce qui est établi</h3><p>{plain(paragraphs[1])}</p></Card>
            <Card><h3>Ce que vous gagnez, ce que vous risquez</h3><p>{plain(paragraphs[2])}</p></Card>
            <Card><h3>Ce qui doit être vérifié</h3><p>{plain(paragraphs[3])}</p></Card>
          </div>
          <div class="recommendation"><span class="editorial-kicker">RECOMMANDATION PROPOSÉE</span><p>{plain(q.recommendedAnswer)}</p></div>
          <div class="option-grid harness-options" data-count={options(q.id).length} role="group" aria-label="Options de la question">
            {#each options(q.id) as option,index}<Tile variant="clickable" aria-label={option.label} onclick={()=>selections={...selections,[q.id]:option.id}} aria-pressed={selections[q.id]===option.id}>
              <div class="option-content"><div class="option-meta"><span class="editorial-kicker">OPTION {String.fromCharCode(65+index)}</span>{#if q.recommendedOptionId===option.id}<Badge tone="info">Proposée</Badge>{/if}</div><strong class="st-tile__title">{option.label}</strong><p>{option.consequence}</p><p class="option-cost">{option.body}</p></div>
            </Tile>{/each}
          </div>
          <p class="local-selection" aria-live="polite">{selections[q.id] ? 'Sélection locale : '+options(q.id).find(o=>o.id===selections[q.id]).label+'. Aucune décision enregistrée.':'Aucune option choisie. Un clic prépare seulement une réponse locale.'}</p>
          <p class="presenter-interest">{plain(paragraphs[4])}</p>
        </section>
      {:else if current === 3}
        <section aria-labelledby="inventory-title">
          <div class="section-heading"><div><span class="editorial-kicker">LES DEMANDES RESTENT ACQUISES</span><h2 id="inventory-title">24 demandes, 8 écarts de capitalisation</h2></div><Badge tone="neutral">Dates de 2026</Badge></div>
          <p>États repris de r2 et de la revue Muse Wonder ; essais limités au périmètre nommé. Les écarts de style s’ajoutent à l’inventaire, sans ouvrir une troisième décision.</p>
          <h3 class="table-heading">Le style existe dans les kits. Sa transmission reste incomplète.</h3>
          <p class="muted-copy">Comparaison avec origin/main du 27/10. Les chemins ci-dessous désignent le code h2a examiné ; les preuves des kits et les corrections successives figurent dans STYLE-RODE.md.</p>
          {@render table(['Convention à capitaliser','Acquis dans les kits','Limite dans h2a aujourd’hui'],content.gaps,'Écarts de capitalisation')}
          <h3 class="table-heading">Inventaire conservé — 24 demandes</h3>
          {@render table(['Mots du propriétaire et date','État','Reste'],content.inventory,'Inventaire des 24 demandes')}
        </section>
      {:else}
        <section aria-labelledby="sources-title">
          <div class="section-heading"><div><span class="editorial-kicker">PREUVES ET LIMITES</span><h2 id="sources-title">Sources et corrections successives</h2></div></div>
          <Card>{#each dossier.sections.find(s=>s.id==='sources-limites').markdown.split('\n').slice(1) as paragraph}<p>{plain(paragraph)}</p>{/each}</Card>
          <h3 class="table-heading">Vos corrections, puis la réponse apportée</h3>
          {#each content.rounds as round}<article class="owner-round"><span class="editorial-kicker">{round.date}</span><blockquote>« {round.quote} »</blockquote><p>{round.response}</p></article>{/each}
          <details class="supporting-detail"><summary>Origine du style et chaîne de construction</summary><p>Kit Sentropic livré à converge32, révision cfc60833120c3eaa2677a045d550bdc3c63e1547. Même chaîne Make → Svelte / design system → Vite → build-portable.mjs. Les données de ce dossier remplacent celles de la gouvernance. Le titre en bandeau suit le skill h2a du 27/10.</p><p>Le constructeur Focus valide toujours le JSON. Son rendu standard ne reproduit pas les huit conventions recensées intégralement. La livraison de référence signale 35 débordements de texte ; ce dossier est contrôlé séparément.</p></details>
          <details class="supporting-detail"><summary>Version et historique</summary><p>{dossier.provenance.source}</p><p>{dossier.cursor}</p><p>{dossier.hash}</p><ul>{#each dossier.amendmentTrace as step}<li>{step.at} · {step.author} : {step.summary}</li>{/each}</ul></details>
          <div class="export-actions"><Button size="sm" variant="secondary" onclick={()=>download('harness-dossier-r5.json',dossier)}>Télécharger le dossier JSON</Button><Button size="sm" variant="secondary" onclick={()=>download('harness-choix-locaux.json',{dossier:dossier.ref,sourceHash:dossier.hash,statut:'brouillon local, aucune approbation',selections})}>Télécharger les choix locaux</Button></div>
        </section>
      {/if}
      <nav class="dossier-nav" aria-label="Suite de la lecture"><Button size="sm" variant="secondary" disabled={current===0} onclick={()=>go(current-1)}>Précédent</Button><span>{current+1} / {tabs.length}</span><Button size="sm" variant="secondary" disabled={current===tabs.length-1} onclick={()=>go(current+1)}>Suivant</Button></nav>
      <footer class="dossier-footer">Les sélections restent en mémoire dans cette page et disparaissent à sa fermeture. Elles ne valent pas approbation. <span>Author: astra</span></footer>
    </main></Container>
  </div>
</ThemeProvider>
