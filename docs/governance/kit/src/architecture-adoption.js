// Unification de la gouvernance long terme : h2a, engram, sentropic (cluster-mesh) et design-system.
// Maquette SVG statique d’étude modélisant le croquis manuscrit du propriétaire (owner-sketch.jpg)
// et ses 4 vues gigognes d’approfondissement (annotate vs annotation, graphe × layout × skills,
// mémoire & temps D1=C, traçabilité 7 sauts).
import { nodeContent, labelSize } from './architecture-layout.js';
import { buildGovernanceCentral } from './governance-central.js';

// Compact card attributions; zone headings retain their complete wording.
const cardFooters = {
  "ann-ui": "Canvas MCP · annotate",
  "ann-auth": "Sécurité hôte · 2FA et routage",
  "ann-comments": "Sentropic · annotations/MCP",
  "ann-h2a": "h2a · agents, Focus et Track",
  "ann-engram": "Engram · admission de leçon",
  "onto-graph": "1. Graphes · Engram gardien WP9",
  "onto-skills": "3. Skills · synthèse par usage",
  "onto-layout": "2. DS · layout et autonomie JS",
  "onto-bpmn": "BPMN/D2D · modèle unique",
  "mem-core": "Engram · mémoire D3/D10",
  "mem-time": "Engram · temps D1=C",
  "mem-pipeline": "Sentropic · mémoire d’abord",
  "mem-live": "engram-live · savoir Git et enquêtes",
  "mem-h2a": "h2a · adoption et planification WP8",
  "trace-1-2": "1–2 · Demande et décision h2a",
  "trace-3-4": "3–4 · Code et qualification",
  "trace-5-6": "5–6 · Release scellée et prod",
  "trace-7": "7 · Acceptation et adoption aval",
  "trace-loop": "Engram · retour mémoire et temps",
};

const W = 1240;
const GAP = 16;

function create(id, title, shortCaption, caption, topBandTitle, bottomBandTitle, parentContainerIds = []) {
  return {
    id,
    title,
    shortCaption,
    caption,
    parentContainerIds,
    legend: 'Maquette statique d’étude (SVG autonome hors-ligne). Cadres : systèmes de référence et conteneurs ouvrables. Ambre : cible contractuelle ou brique en qualification ; bleu : identité, 2FA, mandats et garde des accès. Flèches pleines : liaisons du croquis ou routes actives ; pointillés : ajout proposé ou raccordement en cours.',
    nodes: [],
    groups: [],
    junctions: [],
    edges: [],
    bands: [
      { title: topBandTitle, y: 18 },
      { title: bottomBandTitle, x: 0, y: 0 },
    ],
  };
}

function box(s, id, parentId, x, y, width, title, fn, detail = '', tone = 'neutral', kind = 'component') {
  const data = { title, function: fn, detail, tone, kind, layoutWidth: width };
  const content = nodeContent(data);
  const node = {
    id,
    parentId,
    position: { x, y },
    width: content.width,
    height: content.height,
    data: { ...data, text: content.text },
  };
  s.nodes.push(node);
  return node;
}

function frame(s, id, parentId, title, subtitle, x, y, width, tone = 'neutral') {
  const group = {
    id,
    parentId,
    title,
    subtitle,
    cardFooter: cardFooters[id],
    position: { x, y },
    width,
    height: 0,
    tone,
    headerHeight: 66,
  };
  s.groups.push(group);
  return group;
}

function fit(s, group) {
  const children = [...s.nodes, ...s.groups].filter((n) => n.parentId === group.id);
  group.height = Math.max(...children.map((n) => n.position.y + n.height)) + GAP - group.position.y;
}

const right = (n) => n.position.x + n.width;
const bottom = (n) => n.position.y + n.height;

function link(s, id, source, target, label, points, options = {}) {
  const size = labelSize(label);
  const segmentIndex = options.labelSegment ?? points.length - 2;
  const a = points[segmentIndex];
  const b = points[segmentIndex + 1];
  let labelPoint;
  let anchor;
  if (a.y === b.y) {
    const x = options.labelX ?? (a.x + b.x) / 2;
    anchor = { x, y: a.y };
    const dy = options.labelDy ?? (options.labelBelow ? 18 : -18);
    labelPoint = { x, y: a.y + dy };
  } else {
    const y = options.labelY ?? (a.y + b.y) / 2;
    anchor = { x: a.x, y };
    const sideOffset = options.labelLeft ? -(8 + size.width / 2) : (8 + size.width / 2);
    labelPoint = { x: a.x + sideOffset, y };
  }
  const lengths = points.slice(1).map((p, i) => Math.abs(p.x - points[i].x) + Math.abs(p.y - points[i].y));
  const totalLength = lengths.reduce((sum, n) => sum + n, 0);
  const labelEdgeFraction = (
    lengths.slice(0, segmentIndex).reduce((sum, n) => sum + n, 0)
    + Math.abs(anchor.x - a.x)
    + Math.abs(anchor.y - a.y)
  ) / totalLength;
  s.edges.push({
    id,
    source,
    target,
    label,
    type: points.length === 2 ? 'straight' : 'architecture',
    class: options.pending ? 'reject' : 'active',
    data: {
      routedPoints: points,
      clearance: 20,
      marker: options.marker !== false,
      bus: options.bus ?? null,
      obstacleDetour: points.length > 2,
      labelPoint,
      labelBox: {
        left: labelPoint.x - size.width / 2,
        right: labelPoint.x + size.width / 2,
        top: labelPoint.y - 12,
        bottom: labelPoint.y + 12,
      },
      labelAnchor: anchor,
      labelEdgeFraction,
      ...options,
    },
  });
}

// Construit une scène d’étude à 3 bandeaux avec espacement sans collision
function buildThreeTierScene(config) {
  const s = create(
    config.id,
    config.title,
    config.shortCaption,
    config.caption,
    config.topBand,
    config.bottomBand,
    config.parentContainerIds ?? [],
  );
  const halfW = 556;
  const rightX = W - halfW; // 684 (écart de 128px entre cadres ; 160px entre nœuds 540..700)
  const topY = 44;
  const rowGap = config.rowGap ?? 28;
  const midRowGap = config.midRowGap ?? rowGap;

  const topLeft = frame(s, config.topLeft.id, null, config.topLeft.title, config.topLeft.subtitle, 0, topY, halfW, config.topLeft.tone ?? 'neutral');
  const topRight = frame(s, config.topRight.id, null, config.topRight.title, config.topRight.subtitle, rightX, topY, halfW, config.topRight.tone ?? 'neutral');

  const placeChildren = (group, items) => {
    const colW = 248;
    const colGap = 28;
    const fullW = group.width - 32;
    let curY = group.position.y + group.headerHeight;
    for (const row of items) {
      if (row.length === 1) {
        const [id, title, fn, detail, tone, kind] = row[0];
        const n = box(s, id, group.id, group.position.x + 16, curY, fullW, title, fn, detail, tone, kind);
        curY = bottom(n) + rowGap;
      } else {
        const [a, b] = row;
        const na = box(s, a[0], group.id, group.position.x + 16, curY, colW, a[1], a[2], a[3], a[4], a[5]);
        const nb = box(s, b[0], group.id, group.position.x + 16 + colW + colGap, curY, colW, b[1], b[2], b[3], b[4], b[5]);
        curY = Math.max(bottom(na), bottom(nb)) + rowGap;
      }
    }
    fit(s, group);
  };

  placeChildren(topLeft, config.topLeft.rows);
  placeChildren(topRight, config.topRight.rows);

  const tier1Bottom = Math.max(bottom(topLeft), bottom(topRight));
  const corridor1 = 96;
  const midY = tier1Bottom + corridor1;

  const midFrame = frame(s, config.middle.id, null, config.middle.title, config.middle.subtitle, 0, midY, W, config.middle.tone ?? 'proposal');
  const col3W = 382;
  const colXs = [16, 429, 842]; // 31px d'écart entre colonnes
  let midCurY = midY + midFrame.headerHeight;
  for (const row of config.middle.rows) {
    const rowNodes = row.map((item, idx) => box(
      s,
      item[0],
      midFrame.id,
      colXs[idx],
      midCurY,
      col3W,
      item[1],
      item[2],
      item[3],
      item[4],
      item[5],
    ));
    midCurY = Math.max(...rowNodes.map(bottom)) + midRowGap;
  }
  fit(s, midFrame);

  const corridor2 = 96;
  const botY = bottom(midFrame) + corridor2;

  const botLeft = frame(s, config.bottomLeft.id, null, config.bottomLeft.title, config.bottomLeft.subtitle, 0, botY, halfW, config.bottomLeft.tone ?? 'proposal');
  const botRight = frame(s, config.bottomRight.id, null, config.bottomRight.title, config.bottomRight.subtitle, rightX, botY, halfW, config.bottomRight.tone ?? 'neutral');

  placeChildren(botLeft, config.bottomLeft.rows);
  placeChildren(botRight, config.bottomRight.rows);
  s.bands[1].y = Math.max(bottom(botLeft), bottom(botRight)) + 44;

  const getNode = (id) => s.nodes.find((n) => n.id === id);

  if (config.links.topHorizontal) {
    const { id, source, target, label, reverse = false, pending = false } = config.links.topHorizontal;
    const leftNode = getNode(reverse ? target : source);
    const rightNode = getNode(reverse ? source : target);
    const y = Math.round((Math.max(leftNode.position.y, rightNode.position.y) + Math.min(bottom(leftNode), bottom(rightNode))) / 2);
    const pts = reverse
      ? [{ x: rightNode.position.x, y }, { x: right(leftNode), y }]
      : [{ x: right(leftNode), y }, { x: rightNode.position.x, y }];
    link(s, id, source, target, label, pts, { pending });
  }
  if (config.links.bottomHorizontal) {
    const { id, source, target, label, reverse = false, pending = false } = config.links.bottomHorizontal;
    const leftNode = getNode(reverse ? target : source);
    const rightNode = getNode(reverse ? source : target);
    const y = Math.round((Math.max(leftNode.position.y, rightNode.position.y) + Math.min(bottom(leftNode), bottom(rightNode))) / 2);
    const pts = reverse
      ? [{ x: rightNode.position.x, y }, { x: right(leftNode), y }]
      : [{ x: right(leftNode), y }, { x: rightNode.position.x, y }];
    link(s, id, source, target, label, pts, { pending });
  }

  for (const h of config.links.intraHorizontal ?? []) {
    const leftNode = getNode(h.reverse ? h.target : h.source);
    const rightNode = getNode(h.reverse ? h.source : h.target);
    const rowTop = Math.max(leftNode.position.y, rightNode.position.y);
    const rowBot = Math.min(bottom(leftNode), bottom(rightNode));
    const y = h.edgeAtTop ? rowTop + 6 : rowBot - 6;
    const labelDy = h.edgeAtTop ? -23 : 23;
    const pts = h.reverse
      ? [{ x: rightNode.position.x, y }, { x: right(leftNode), y }]
      : [{ x: right(leftNode), y }, { x: rightNode.position.x, y }];
    link(s, h.id, h.source, h.target, h.label, pts, {
      pending: h.pending ?? false,
      labelDy,
      labelX: h.labelX,
    });
  }

  for (const v of config.links.intraVertical ?? []) {
    const topNode = getNode(v.topNode);
    const botNode = getNode(v.botNode);
    const yTop = bottom(topNode);
    const yBot = botNode.position.y;
    const pts = v.up ? [{ x: v.x, y: yBot }, { x: v.x, y: yTop }] : [{ x: v.x, y: yTop }, { x: v.x, y: yBot }];
    link(s, v.id, v.up ? botNode.id : topNode.id, v.up ? topNode.id : botNode.id, v.label, pts, {
      pending: v.pending ?? false,
      labelLeft: v.labelLeft ?? false,
      labelY: Math.round((yTop + yBot) / 2) + (v.labelDy ?? 0),
    });
  }

  const corridor1MidY = Math.round((tier1Bottom + midY) / 2);
  for (const v of config.links.corridor1) {
    const topNode = getNode(v.topNode);
    const midNode = getNode(v.midNode);
    const yTop = bottom(topNode);
    const yBot = midNode.position.y;
    if (v.xTop !== undefined && v.xBot !== undefined && v.xTop !== v.xBot) {
      const yBend = corridor1MidY + (v.bendDy ?? 0);
      const pts = v.up
        ? [{ x: v.xBot, y: yBot }, { x: v.xBot, y: yBend }, { x: v.xTop, y: yBend }, { x: v.xTop, y: yTop }]
        : [{ x: v.xTop, y: yTop }, { x: v.xTop, y: yBend }, { x: v.xBot, y: yBend }, { x: v.xBot, y: yBot }];
      link(s, v.id, v.up ? midNode.id : topNode.id, v.up ? topNode.id : midNode.id, v.label, pts, {
        pending: v.pending ?? false,
        labelSegment: 1,
        labelX: v.labelX ?? Math.round((v.xTop + v.xBot) / 2),
        labelDy: v.labelDy ?? -18,
      });
    } else {
      const pts = v.up ? [{ x: v.x, y: yBot }, { x: v.x, y: yTop }] : [{ x: v.x, y: yTop }, { x: v.x, y: yBot }];
      link(s, v.id, v.up ? midNode.id : topNode.id, v.up ? topNode.id : midNode.id, v.label, pts, {
        pending: v.pending ?? false,
        labelLeft: v.labelLeft ?? false,
        labelY: corridor1MidY + (v.labelDy ?? 0),
      });
    }
  }

  const corridor2MidY = Math.round((bottom(midFrame) + botY) / 2);
  for (const v of config.links.corridor2) {
    const midNode = getNode(v.midNode);
    const botNode = getNode(v.botNode);
    const yTop = bottom(midNode);
    const yBot = botNode.position.y;
    if (v.xTop !== undefined && v.xBot !== undefined && v.xTop !== v.xBot) {
      const yBend = corridor2MidY + (v.bendDy ?? 0);
      const pts = v.down
        ? [{ x: v.xTop, y: yTop }, { x: v.xTop, y: yBend }, { x: v.xBot, y: yBend }, { x: v.xBot, y: yBot }]
        : [{ x: v.xBot, y: yBot }, { x: v.xBot, y: yBend }, { x: v.xTop, y: yBend }, { x: v.xTop, y: yTop }];
      link(s, v.id, v.down ? midNode.id : botNode.id, v.down ? botNode.id : midNode.id, v.label, pts, {
        pending: v.pending ?? false,
        labelSegment: 1,
        labelX: v.labelX ?? Math.round((v.xTop + v.xBot) / 2),
        labelDy: v.labelDy ?? -18,
      });
    } else {
      const pts = v.down ? [{ x: v.x, y: yTop }, { x: v.x, y: yBot }] : [{ x: v.x, y: yBot }, { x: v.x, y: yTop }];
      link(s, v.id, v.down ? midNode.id : botNode.id, v.down ? botNode.id : midNode.id, v.label, pts, {
        pending: v.pending ?? false,
        labelLeft: v.labelLeft ?? false,
        labelY: corridor2MidY + (v.labelDy ?? 0),
      });
    }
  }

  return s;
}

// 1. VUE CENTRALE DU CROQUIS PROPRIÉTAIRE (GOUVERNANCE & ROUTAGE DES BESOINS)
const central = buildGovernanceCentral();

// 2. VUE GIGOGNE 1 : CAS D'ÉCOLE DU PROPRIÉTAIRE — UN SEUL MODÈLE DE DONNÉES (ANNOTATION) + UN OUTIL (ANNOTATE) SUR LES CANVAS DU CATALOGUE
const annotate = buildThreeTierScene({
  id: 'annotate',
  parentContainerIds: ['design-system', 'cluster-mesh', 'h2a', 'engram'],
  title: 'Vue gigogne d’étude 1 · Un seul modèle de données (annotation) + outil (annotate) sur les canvas (N19–N22)',
  shortCaption: 'Arbitrage propriétaire post-R3 : un seul modèle de données (annotation dans @sentropic/comments) + l’outil annotate sur les canvas inscrits au catalogue, exposés en MCP et hébergés sur artifacts / UI prod.',
  caption: 'Sources verbatim : OWNER-REQUEST.md:13-17 (arbitrage après round 3 Sol) : « Question très mal posée. Les canvas (ui+interaction ia) doivent être dans le catalogue, exposé avec un mcp, hosté par dessus artefact et potentiellement ui en prod. Mais j\'imagine que le modèle d\'annotation doit être annotation + annotate j\'imagine un modèle de donnée. A voir où tu gères la mise en catalog et mcp » ; SPEC_EVOL_CATALOG.md:99,150 ; SPEC_EVOL_APP_CATALOG.md:5,29,46 ; SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md:91,714 ; SPEC_EVOL_CLUSTER_MESH_MCP_REGISTRY_ARTIFACTS.md:101,109,135 (#679/#692) ; SPEC_EVOL_UI_ANNOTATE_OVERLAY.md:90,105,156 (#694) ; sentropic/packages/comments/src/anchors.ts:1,87 ; revisions.ts:1,29 ; #684 ; #695. L’agent destinataire est résolu depuis la table de confiance de l’hôte servi, jamais depuis le DOM ou l’image.',
  topBand: 'CANVAS CATALOGUE / MCP HÉBERGÉ SUR ARTIFACTS & OUTIL ANNOTATE (N19) · SÉCURITÉ 2FA (N26)',
  bottomBand: 'DÉLIVRANCE À L’AGENT RESPONSABLE (N21) & PROMOTION EXPLICITE EN ITEM TRACK OU LEÇON (N22)',
  topLeft: {
    id: 'ann-ui',
    title: 'Canvas catalogue/MCP & outil @sentropic/annotate',
    subtitle: 'Canvas (UI + interaction IA) sur @sentropic/artifacts et UI en prod',
    tone: 'neutral',
    rows: [
      [
        ['ann-screen', 'Canvas et UI en prod', 'kind: "canvas" · MCP ui:// · sur artifacts', 'tenantId · workspaceId · namespace', 'neutral'],
        ['ann-overlay', 'annotate · capture', 'Présentation DS · sélection/marqueurs', 'Ancre opaque → modèle Sentropic', 'proposal'],
      ],
    ],
  },
  topRight: {
    id: 'ann-auth',
    title: 'Sécurité hôte · 2FA & table de routage',
    subtitle: 'Preuve MFA et résolution du destinataire côté serveur',
    tone: 'identity',
    rows: [
      [
        ['ann-mfa', 'Auth IdP et 2FA', 'Session vérifiée · preuve amr: "mfa"', 'Namespace : droits d’écriture/élévation', 'identity'],
        ['ann-map', 'Destinataires hôte', 'Build/écran : routage de confiance', 'DOM/image : aucun choix d’agent', 'identity'],
      ],
    ],
  },
  middle: {
    id: 'ann-comments',
    title: 'sentropic · modèle de données unique annotation (@sentropic/comments #684), catalogue & MCP (N20–N21)',
    subtitle: 'Un seul modèle de données durable (annotation) et mise en catalogue / registre MCP dans cluster-mesh (#679/#692/#694)',
    tone: 'proposal',
    rows: [
      [
        ['ann-domain', 'Modèle d’annotation', 'comments 0.3.0 · ancres et révisions', 'Clé tenant/espace/namespace/type/id', 'neutral'],
        ['ann-store', 'Stockage annotation', 'Postgres #684 · ancres et révisions', 'Sérialisation durable du modèle unique', 'neutral'],
        ['ann-outbox', 'Envoi et médiation', 'Vérifie l’autorisation de délivrance', 'Reçu auditId → destinataire h2a', 'proposal'],
      ],
    ],
  },
  bottomLeft: {
    id: 'ann-h2a',
    title: 'h2a · réception agent, Focus & suivi Track',
    subtitle: 'Traitement opérationnel du feedback et suivi du correctif',
    tone: 'neutral',
    rows: [
      [
        ['ann-inbox', 'Messages à l’agent', 'Réception : session/rôle h2a cible', 'Acquittement dans le workspace lié', 'neutral'],
        ['ann-track', 'Amendement Track', 'Création explicite d’item d’annotation', 'Fil résolu ≠ item Track clôturé', 'proposal'],
      ],
    ],
  },
  bottomRight: {
    id: 'ann-engram',
    title: 'engram · admission éventuelle de leçon',
    subtitle: 'Aucune promotion automatique d’un commentaire en mémoire',
    tone: 'proposal',
    rows: [
      [
        ['ann-capture', 'Capture mémoire', 'Demande explicite · 6 outils MCP gelés', 'Portes de gouvernance et périmètre', 'proposal'],
        ['ann-d3', 'Journal D3 et graphe', 'Admission tracée · retrait et oubli', 'Aucune fuite entre namespaces', 'proposal'],
      ],
    ],
  },
  links: {
    topHorizontal: { id: 'e-ann-auth', source: 'ann-overlay', target: 'ann-mfa', label: 'vérifie 2FA' },
    bottomHorizontal: { id: 'e-ann-learn', source: 'ann-track', target: 'ann-capture', label: 'leçon explicite' },
    corridor1: [
      { id: 'e-ann-submit', topNode: 'ann-screen', midNode: 'ann-domain', x: 64, up: false, label: 'ancre + brouillon N19' },
      { id: 'e-ann-ack', topNode: 'ann-overlay', midNode: 'ann-store', x: 460, up: true, label: 'révision & statut N20' },
      { id: 'e-ann-policy', topNode: 'ann-mfa', midNode: 'ann-store', x: 760, up: false, label: 'namespace + destinataire' },
      { id: 'e-ann-audit', topNode: 'ann-map', midNode: 'ann-outbox', x: 1040, up: true, label: 'reçu de sécurité' },
    ],
    corridor2: [
      { id: 'e-ann-deliver', midNode: 'ann-domain', botNode: 'ann-inbox', x: 64, down: true, label: 'délivre à l’agent N21' },
      { id: 'e-ann-link', midNode: 'ann-store', botNode: 'ann-track', x: 460, down: false, label: 'référence item Track N22' },
      { id: 'e-ann-admit', midNode: 'ann-outbox', botNode: 'ann-capture', x: 880, down: true, label: 'capture autorisée N22', pending: true },
    ],
  },
});

// 3. VUE GIGOGNE 2 : DIAGRAMMES GIGOGNES — GRAPHE (ENGRAM WP9) × LAYOUT (SOUCHES JS) × SKILLS DE PRÉSENTATION
const ontologies = buildThreeTierScene({
  id: 'ontologies',
  parentContainerIds: ['engram', 'design-system', 'h2a'],
  title: 'Vue gigogne d’étude 2 · Graphe (engram WP9) × Layout (souches JS) × Skills de présentation',
  shortCaption: 'Maquette d’étude des arbitrages propriétaire : tout diagramme est un graphe ouvrable (gigogne), mis en page par nos propres souches JS, avec éditions atomiques et mode offline sans CDN.',
  caption: 'Sources verbatim : owner-diagram-decisions-via-hcond.md (2026-10-18) : (1) « Les algo open licence libre ou algo public mais dans notre js a nous … On respect mais on libere au max et on a nos propres souches » ; (2) « diagrammes gigogne (ouvrables) … Tout diagramme est un graph et toute representation est une forme de synthese. Il faut bie modeliser diagramme layout et skills de presentation » ; (3) « L enjeu n est pas la taille mais la reactivité et l atomicité des editions … la acapacite offline sans cdn doit etre possible donc ok la 32Mo qd js embedb ». Note : les 5 scènes SVG de ce dossier constituent une maquette statique d’étude illustrant la cible ; la projection dynamique depuis SemanticDocument sera câblée au jalon M4.',
  topBand: 'COUCHE 1 : GRAPHE & ONTOLOGIES (ENGRAM WP9) · COUCHE 3 : SKILLS DE SYNTHÈSE (H2A & CATALOGUE)',
  bottomBand: 'CONTINUITÉ BPMN / D2D & FRONTIÈRE BUILD-TIME VS RUNTIME',
  topLeft: {
    id: 'onto-graph',
    title: '1. Diagramme = Graphe · engram gardien WP9',
    subtitle: 'Vérité sémantique, profils empilables et hiérarchie gigogne',
    tone: 'proposal',
    rows: [
      [
        ['onto-profiles', 'Profils d’ontologie', 'dev · track · archi · generic@1 · bpmn@1', 'Identifiants EN · anciens alias en lecture', 'proposal'],
        ['onto-gigogne', 'SemanticDocument', 'Sous-graphes liés et dépliables', 'Exécuteur DS · profils Engram · G2 actée', 'proposal'],
      ],
    ],
  },
  topRight: {
    id: 'onto-skills',
    title: '3. Skills de présentation · synthèse par usage',
    subtitle: 'Toute représentation est une synthèse gouvernée d’un graphe',
    tone: 'neutral',
    rows: [
      [
        ['skill-focus', 'Skill Focus', 'Synthèse : DecisionDossierDocument', 'DS : rendu <st-decision-dossier>', 'neutral'],
        ['skill-ui', 'MCP ui:// et canvas', 'Skills : architecture, BPMN, audit', 'Registres cluster-mesh · Option E', 'proposal'],
      ],
    ],
  },
  middle: {
    id: 'onto-layout',
    title: '2. Layout, réactivité atomique & autonomie offline · Design System (nos propres souches JS)',
    subtitle: 'Algorithmes libres/publics dans notre JS · transactions atomiques · 100 % offline sans CDN',
    tone: 'proposal',
    rows: [
      [
        ['layout-js', 'Layout en JS local', 'diagram-canvas · routage orthogonal', 'Sugiyama · labels · couverture ELK', 'proposal'],
        ['layout-atomic', 'Éditions atomiques', 'SemanticDocument ↔ ViewDocument', 'Recalcul local · sémantique ≠ géométrie', 'neutral'],
        ['layout-offline', 'Hors ligne sans CDN', 'JS autonome embarqué · Focus/canvas', 'Aucun CDN · JS embarqué, même 32 Mo', 'identity'],
      ],
    ],
  },
  bottomLeft: {
    id: 'onto-bpmn',
    title: 'Continuité BPMN & D2D · zéro second modèle',
    subtitle: 'Préservation intégrale des acquis bpmn-canvas (0.3.0) et d2d',
    tone: 'neutral',
    rows: [
      [
        ['bpmn-f1', 'bpmn@1 ↔ moddle F1', 'Préserve extensionElements/xmlns/xsi', 'Sans perte · modèle BPMN unique', 'neutral'],
        ['bpmn-c14n', 'Profil canonique', 'Hachage stable · watermark serveur', 'Clé watermark absente du JS client', 'identity'],
      ],
    ],
  },
  bottomRight: {
    id: 'onto-boundary',
    title: 'Frontière Build-time vs Runtime',
    subtitle: 'Aucun appel réseau/MCP dans la boucle de rendu ou d’import',
    tone: 'neutral',
    rows: [
      [
        ['bound-build', 'Build/rendu SHA-256', 'Validation/rendu local et synchrone', 'Garantit la résilience hors-ligne (R-10)', 'neutral'],
        ['bound-runtime', 'Outil ontology_call', 'Registre cluster-mesh et catalogue', 'Agents : requêtes/validation de profils', 'proposal'],
      ],
    ],
  },
  links: {
    topHorizontal: { id: 'e-onto-synth', source: 'onto-gigogne', target: 'skill-focus', label: 'synthèse graphe' },
    bottomHorizontal: { id: 'e-bpmn-pin', source: 'bpmn-c14n', target: 'bound-build', label: 'SHA-256 local' },
    corridor1: [
      { id: 'e-graph-layout', topNode: 'onto-profiles', midNode: 'layout-js', x: 64, up: false, label: 'SemanticDocument → ViewDocument' },
      { id: 'e-skill-layout', topNode: 'skill-focus', midNode: 'layout-atomic', x: 760, up: false, label: 'pilote le layout & le rendu' },
    ],
    corridor2: [
      { id: 'e-layout-bpmn', midNode: 'layout-js', botNode: 'bpmn-f1', x: 64, down: true, label: 'applique F1 & profile-c14n/2' },
      { id: 'e-layout-bound', midNode: 'layout-offline', botNode: 'bound-runtime', x: 1020, down: true, label: 'build hors-ligne / MCP runtime' },
    ],
  },
});

// 4. VUE GIGOGNE 3 : MÉMOIRE AGENTIQUE (D3/D10, ORDRE #685 → L5 → R2/R7a/R3), ENGRAM-LIVE & TEMPS (D1=C)
const memory = buildThreeTierScene({
  id: 'memory',
  parentContainerIds: ['engram', 'cluster-mesh', 'h2a'],
  title: 'Vue gigogne d’étude 3 · Mémoire agentique (D3/D10), engram-live et références de temps (D1=C)',
  shortCaption: 'Ordre impératif #685 → L5 → R2/R7a/R3. Engram déclare ses surfaces transactionnelle (D3), analytique (D1=C) et graphe live (Git/D10) à l’interface DB neutre de cluster-mesh, sans choisir de backend ni embarquer de pilote DB natif.',
  caption: 'Sources : threads/memory/OWNER-DECISION.md:3 ; PIPELINE.md:158,355,379 ; engram/spec/SPEC_EVOL_AGENT_MEMORY_SUBSTRATE.md:11,73 ; src/mcp/memory/contracts.ts:142 ; #393 (D10) ; #388–#391 & #400 (engram-live) ; 01M57PXN14JMZ23BM3YK537JWH (D1=C) ; 01M57KSPC5VJN455J69W4A4ZH3 (WP8) ; ../cluster-mesh-storage/OWNER-ORIENTATIONS.md (binding via OWNER-REQUEST.md). Cible : trois surfaces optimisées, SQLite et Postgres prioritaires ; qualification transactionnelle E2/L5 sur SQLite (Node 24) avant Postgres, analytique et graphe live à qualifier séparément. Les éléments Postgres/S3 #684 observés ne prouvent pas cette qualification. La gouvernance des ontologies ne bloque jamais la chaîne mémoire ; aucun MemoryRef dans Git.',
  topBand: 'AUTORITÉ MÉMOIRE (D3/D10) & CENTRE DES RÉFÉRENCES DE TEMPS (D1 = C) DANS ENGRAM',
  bottomBand: 'ENGRAM-LIVE GIT & ADOPTION H2A (WP8)',
  topLeft: {
    id: 'mem-core',
    title: 'engram · substrat mémoire D3 & D10 (C05)',
    subtitle: 'Autorité canonique unique et projection filtrée par périmètre',
    tone: 'proposal',
    rows: [
      [
        ['mem-d3', 'Journal canonique D3', 'Seule autorité : admission/retrait/oubli', 'MCP v3.2 : 6 outils mémoire gelés', 'proposal'],
        ['mem-d10', 'Graphe D10 filtré', '.engram/graph.json purgé à l’oubli', 'Non-résurrection X4 · purge X2/X2b', 'proposal'],
      ],
    ],
  },
  topRight: {
    id: 'mem-time',
    title: 'engram · références de temps D1=C (C14)',
    subtitle: 'Service central de vélocité et de durées CI/CD avec exports typés',
    tone: 'proposal',
    rows: [
      [
        ['time-center', 'Service des temps', 'P50/P80/P95 · 4 horloges · config', 'Observations CI/CD #698 · agent-stats', 'proposal'],
        ['time-export', 'Exports de savoir Git', 'Manifestes, temps CI, architecture', 'Aucun MemoryRef dans Git', 'identity'],
      ],
    ],
  },
  middle: {
    id: 'mem-pipeline',
    title: 'sentropic · ordre d’exécution impératif « Mémoire d’abord » (#685 → L5 → R2/R7a/R3)',
    subtitle: 'L’hôte qualifié injecte identité, tenant, workspace, génération de politique et stockage avant toute exposition',
    tone: 'proposal',
    rows: [
      [
        ['pipe-685', '1. Interface stockage', 'DB neutre · 3 surfaces optimisées', 'Trans./analyse/graphe · identité/scope', 'identity'],
        ['pipe-l5', '2. Transactionnel', 'SQLite (Node 24), puis Postgres', '6 MCP à qualifier · deny-as-missing', 'proposal'],
        ['pipe-r2', '3. Catalogue MCP', 'Registre MCP et catalogue unifié', 'Lookup sans activation paresseuse', 'proposal'],
      ],
    ],
  },
  bottomLeft: {
    id: 'mem-live',
    title: 'engram-live · connaissance Git & enquêtes (C06)',
    subtitle: 'Surface distincte de la mémoire canonique pour l’analyse du code',
    tone: 'neutral',
    rows: [
      [
        ['live-read', 'Lecture engram-live', 'Lignes, symboles et 20 enquêtes', 'L9-H intégré · engram 0.20.0 (#400)', 'neutral'],
        ['live-seal', 'Diffs privés scellés', 'Historique Git ≠ brouillons privés', 'Stockage : cluster-mesh #664/#684', 'identity'],
      ],
    ],
  },
  bottomRight: {
    id: 'mem-h2a',
    title: 'h2a · adoption volontaire & planification (WP8)',
    subtitle: 'Consommation par les agents et par la skill de planification',
    tone: 'neutral',
    rows: [
      [
        ['h2a-r5', 'Mémoire h2a 0.98.8', 'Session/agent autorisé · adoption libre', 'Mémoire agent : vue ciblée, aucun silo', 'neutral'],
        ['h2a-wp8', 'Estimateur/plan WP8', 'D1=C · agent-stats · dépendances', 'Prévoir les temps sans sauter de revue', 'proposal'],
      ],
    ],
  },
  links: {
    topHorizontal: { id: 'e-mem-no-ref', source: 'mem-d10', target: 'time-center', label: '0 MemoryRef Git' },
    bottomHorizontal: { id: 'e-live-investig', source: 'live-seal', target: 'h2a-r5', label: 'enquêtes N33' },
    corridor1: [
      { id: 'e-d3-pipe', topNode: 'mem-d3', midNode: 'pipe-685', x: 64, up: false, label: 'contrats MCP v3.2 co-signés' },
      { id: 'e-time-pipe', topNode: 'time-center', midNode: 'pipe-l5', x: 760, up: true, label: 'observations CI/CD #698' },
    ],
    corridor2: [
      { id: 'e-pipe-live', midNode: 'pipe-685', botNode: 'live-read', x: 64, down: true, label: 'active & persiste engram-live' },
      { id: 'e-pipe-h2a', midNode: 'pipe-r2', botNode: 'h2a-wp8', x: 1020, down: true, label: 'équipe R5/R6 & alimente WP8' },
    ],
  },
});

// 5. VUE GIGOGNE 4 : TRAÇABILITÉ BOUT-EN-BOUT DE LA DEMANDE À LA PRODUCTION EN 7 SAUTS (C04 / N06)
const traceability = buildThreeTierScene({
  id: 'traceability',
  parentContainerIds: ['h2a', 'cluster-mesh', 'engram', 'surfaces'],
  title: 'Vue gigogne d’étude 4 · Traçabilité bout-en-bout en 7 sauts : demande → mise en prod → acceptation (C04)',
  shortCaption: 'Vue fédérée assemblant les preuves des 7 sauts sans journal doublon : chaque saut conserve son registre d’autorité primaire.',
  caption: 'Sources : OWNER-REQUEST.md (« traçabilité end to end des demandes jusque mise en prod ») ; h2a.md ; study-astra.md:201-226 ; study.md §4.4 ; h2a/packages/track/README.md:3,72 ; sentropic/packages/harness/README.md:3,42 ; packages/artifacts/README.md:3,53 ; SPEC_EVOL_DEPLOYMENT_PLANE.md ; threads/ds-history/treatment.md:9-10. Une CI verte ou une publication npm ne vaut jamais acceptation propriétaire ou adoption applicative.',
  topBand: 'SAUTS 1 À 4 : DEMANDE, DÉCISION, CHANGEMENT DE CODE ET QUALIFICATION MÉCANIQUE',
  bottomBand: 'SAUT 7 : ACCEPTATION & APPRENTISSAGE',
  topLeft: {
    id: 'trace-1-2',
    title: 'Sauts 1 & 2 · Demande, Organisation et Décision (h2a)',
    subtitle: 'Autorité d’intention, de périmètre et d’arbitrage architectural',
    tone: 'neutral',
    rows: [
      [
        ['hop-1', '1. Demande organisée', 'Journal Track : demande → item', 'WP · périmètre BRANCH.md · mandat', 'neutral'],
        ['hop-2', '2. Décision et archi', 'Dossier Focus · decision.select Track', 'Versions du contrat et profil d’ontologie', 'proposal'],
      ],
    ],
  },
  topRight: {
    id: 'trace-3-4',
    title: 'Sauts 3 & 4 · Code et Qualification (Git / harness)',
    subtitle: 'Preuves de commit, de périmètre et de revue contradictoire',
    tone: 'neutral',
    rows: [
      [
        ['hop-3', '3. Changement code', 'Commits base/head/merged · Git live', 'Trace des PR fermées ou remplacées', 'neutral'],
        ['hop-4', '4. Qualification', 'harness : VerificationRun · ≥ 2 pairs', 'test-*/e2e-* · non qualifié sans couleur', 'proposal'],
      ],
    ],
  },
  middle: {
    id: 'trace-5-6',
    title: 'Sauts 5 & 6 · Release scellée et Mise en production (Sentropic & opérateur)',
    subtitle: 'Chaîne d’intégrité SHA-256 entre le commit qualifié, l’artefact publié et l’environnement déployé',
    tone: 'proposal',
    rows: [
      [
        ['hop-5', '5. Release qualifiée', 'artifacts · CanonicalManifest 0.1.1', 'SHA-256 immuable · provenance · canal', 'neutral'],
        ['hop-6', '6. Mise en production', 'Reçu d’installation par environnement', 'Santé/rollback · fusion ≠ installation', 'proposal'],
        ['hop-corr', 'États d’exécution', 'Clés auditId/correlationId bout en bout', 'Soumis → commis → visible → accepté', 'identity'],
      ],
    ],
  },
  bottomLeft: {
    id: 'trace-7',
    title: 'Saut 7 · Acceptation & adoption aval (h2a / apps)',
    subtitle: 'Distinction stricte entre réalisation technique et valeur acceptée',
    tone: 'proposal',
    rows: [
      [
        ['hop-7a', '7a. Acceptation', 'Acceptation (4 états) ≠ done', 'Vérification sur l’environnement réel', 'proposal'],
        ['hop-7b', '7b. Adoption aval', 'Package publié ≠ adopté dans l’app', 'Suivi d’adoption des 8 sujets historiques', 'identity'],
      ],
    ],
  },
  bottomRight: {
    id: 'trace-loop',
    title: 'Boucle de retour · Mémoire & Temps (engram)',
    subtitle: 'Capitalisation gouvernée sans écriture dans les autres registres',
    tone: 'proposal',
    rows: [
      [
        ['loop-mem', 'Leçon admise si utile', 'Capture explicite · périmètre autorisé', 'Aucun MemoryRef dans les artefacts Git', 'proposal'],
        ['loop-time', 'Temps prédits/réels', 'Distributions par phase et régime', 'Estimateur WP8 affiné · qualité intacte', 'proposal'],
      ],
    ],
  },
  links: {
    topHorizontal: { id: 'e-hops-12-34', source: 'hop-2', target: 'hop-3', label: 'cadrage → code' },
    bottomHorizontal: { id: 'e-hop7-loop', source: 'hop-7b', target: 'loop-mem', label: 'retour validé' },
    corridor1: [
      { id: 'e-hop2-5', topNode: 'hop-1', midNode: 'hop-5', x: 64, up: false, label: 'contrat & périmètre attendus' },
      { id: 'e-hop4-5', topNode: 'hop-4', midNode: 'hop-5', xTop: 1020, xBot: 360, bendDy: 14, up: false, label: 'preuves VerificationRun & revues', labelX: 720, labelDy: -18 },
    ],
    corridor2: [
      { id: 'e-hop6-7', midNode: 'hop-6', botNode: 'hop-7a', xTop: 520, xBot: 64, bendDy: 14, down: true, label: 'reçu prod → acceptation Saut 7', labelX: 292, labelDy: -18 },
      { id: 'e-hop6-loop', midNode: 'hop-corr', botNode: 'loop-time', x: 1020, down: true, label: 'métriques & durées observées' },
    ],
  },
});

// Dérive mécaniquement les nœuds et groupes actifs à partir des arêtes de la route
function deriveHighlight(scene, edgeIds) {
  const edgeSet = new Set(edgeIds);
  const nodeIds = new Set();
  for (const edge of scene.edges) {
    if (edgeSet.has(edge.id)) {
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }
  }
  const groupIds = new Set();
  for (const node of scene.nodes) {
    if (nodeIds.has(node.id)) {
      let parentId = node.parentId;
      while (parentId) {
        groupIds.add(parentId);
        parentId = scene.groups.find(group => group.id === parentId)?.parentId;
      }
    }
  }
  return {
    groups: [...groupIds],
    nodes: [...nodeIds],
    edges: [...edgeIds],
  };
}

// LES 12 PARCOURS DE BESOINS CLIQUABLES SUR LE DIAGRAMME CENTRAL (PARTITION EXACTE DE N01 À N33)
export const ROUTED_NEEDS = [
  {
    id: 'annotate-vs-annotation',
    shortLabel: '1. annotate vs annotation',
    title: 'Outil annotate (capture sur canvas/UI) + modèle de données unique annotation (@sentropic/comments)',
    needIds: ['N19', 'N20', 'N21', 'N22'],
    capabilityId: 'C11',
    gigogneScene: 'annotate',
    question: 'Comment s’articulent l’outil de capture (annotate sur les canvas du catalogue et l’UI prod) et le modèle de données unique (annotation), et où résident la mise en catalogue et le MCP ?',
    accountableOwner: 'Sentropic : ancres, fils, résolution, persistance, catalogue et MCP ; DS : présentation annotate (G3 actée le 2026-10-19 : « g3 = a ok »).',
    contributingOwners: 'h2a (réception dans l’inbox de l’agent responsable N21 et création explicite d’item Track N22a) · engram (admission explicite de leçon N22b)',
    routeSteps: [
      '1. N19 : le DS présente annotate sur les canvas/UI et émet une proposition avec une ancre opaque. Sentropic résout cette ancre ; le DS ne la résout ni ne la persiste (G3 actée le 2026-10-19 : « g3 = a ok »).',
      '2. N26 + N20 (modèle de données unique annotation) : Sentropic vérifie la session et le 2FA (#695) puis persiste l’enregistrement dans l’unique modèle de données durable @sentropic/comments (0.3.0, anchors.ts, revisions.ts) sous la clé (tenantId, workspaceId, namespace, kind, id). Stockage observé : Postgres (#684) ; cible : sérialisation par l’interface DB neutre de cluster-mesh (C-02), à qualifier.',
      '3. N21 (routage agent) : Sentropic résout l’agent destinataire depuis la table de routage de confiance du build/hôte servi (jamais depuis le DOM ou l’image) et remet le message à l’inbox de l’agent dans h2a.',
      '4. N22 (promotion aval) : sur demande explicite, l’annotation alimente la création d’un item @sentropic/track (résoudre le fil ne clôt pas l’item) ou une demande d’admission mémoire dans engram.',
    ],
    nonOwnerGuard: 'Un seul modèle de données d’annotation (@sentropic/comments) ; la mise en catalogue (types.ts / SPEC_EVOL_CATALOG.md) et l’exposition MCP (packages/mcp-platform/src/registry.ts / #692) résident dans sentropic (cluster-mesh).',
    readiness: {
      decision: 'G3 actée le 2026-10-19 : « g3 = a ok » ; présentation DS, modèle Sentropic.',
      source: 'fusionné sur main (comments 0.3.0, annotate 0.1.0, catalog types.ts:22)',
      release: 'paquets publiés',
      host: 'configuré (raccordement de bout en bout au jalon M3)',
    },
    clauseIds: ['C-01', 'C-02', 'C-04', 'C-07', 'C-10', 'C-14', 'C-15'],
    highlight: deriveHighlight(central, [
      'e-ds-comments', 'e-comments-store', 'e-comments-sec', 'e-comments-inbox', 'e-mesh-h2a', 'e-track-agent',
    ]),
  },
  {
    id: 'catalog',
    shortLabel: '2. Catalogue · MCP, IA & ressources',
    title: 'Découvrir, inscrire en catalogue ou exposer en MCP une capacité (dont les canvas UI + interaction IA)',
    needIds: ['N14', 'N15', 'N16', 'N24'],
    capabilityId: 'C08 / C10 / C13',
    gigogneScene: 'central',
    question: 'Où résident la mise en catalogue et l’exposition MCP pour les skills, tools, agents, workflows, canvas (UI + interaction IA sur artifacts/prod) et apps ?',
    accountableOwner: 'sentropic (catalogue unifié cluster-mesh api/src/services/catalog/types.ts:22 & registre MCP synchrone packages/mcp-platform/src/registry.ts:61)',
    contributingOwners: 'h2a (distributeur d’équipement natif R5/R6 & serveur MCP ui:// H-4) · engram (producteur MCP mémoire v3.2 & ontologies) · design-system (producteur de templates canvas/UI)',
    routeSteps: [
      '1. N14 (mise en catalogue & découverte) : MCP (harnais, mémoire/ontologies et connecteurs à broker), IA (LLM, juge, vision/SAM-YOLO, TTS, STT…), ressources et catalogues UI/canvas/apps (bpmn-canvas, templater Sentropic…) appartiennent au catalogue logique de sentropic. La liste des 5 kinds observés en code (skill, tool, agent, workflow, canvas) et des 3 en spécification (app, ontology, ui) décrit l’état d’implémentation ; elle ne limite pas les familles demandées. Sources : SPEC_EVOL_CATALOG.md:99,150, SPEC_EVOL_APP_CATALOG.md:5,29,46, SPEC_EVOL_CLUSTER_MESH_CENTRAL_CONTROL_PLANE.md:227 D13 /catalog ; découverte deny-as-missing.',
      '2. N15 (exposition MCP & équipement) : le registre MCP synchrone vit dans sentropic (SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md:91,714, SPEC_EVOL_CLUSTER_MESH_MCP_REGISTRY_ARTIFACTS.md:101,109 #679/#692). h2a y expose ses outils dans l’entrée « harnais », dont annotate, Track, Focus, sessions et autres outils ; le modèle annotation reste canonique via comments. Chaque domaine inscrit son fournisseur MCP et h2a équipe les sessions (PluginManifest / NativeQualification).',
      '3. N16 (connecteurs) : Sentropic doit broker Gmail, GChat, Atlassian, GitHub, Notion, Slack, OpenERP, WaveApps, Stripe… via son registre MCP, la garde des secrets et une autorisation scopée (ConnectorGrant) avec identifiant d’audit (auditId). Ces entrées cibles nécessitent une qualification par connecteur.',
      '4. N24 (applications managées) : un modèle kind="app" (OpenERP, nc-fullstack, CV) reste distinct de l’instance déployée et de sa base de données métier.',
    ],
    nonOwnerGuard: 'La mise en catalogue et la médiation MCP vivent dans sentropic (cluster-mesh) ; chaque domaine reste propriétaire de ses descripteurs et de sa sémantique.',
    readiness: {
      decision: 'actée par le propriétaire (OWNER-FEEDBACK.md & arbitrage post-R3)',
      source: 'fusionné (5 kinds dans types.ts:22 + #679) / en spécification (app, ontology, ui)',
      release: 'paquet publié (cluster-mesh 0.18.0)',
      host: 'configuré (exposition complète au jalon M2 après #685 → L5)',
    },
    clauseIds: ['C-04', 'C-06', 'C-07', 'C-10', 'C-15'],
    highlight: deriveHighlight(central, [
      'e-api-mcp', 'e-api-comments', 'e-api-connectors', 'e-api-ai', 'e-api-catalog', 'e-eng-mem', 'e-eng-onto', 'e-catalog-artifacts', 'e-cloud-catalog', 'e-ui-resources',
    ]),
  },
  {
    id: 'ontology',
    shortLabel: '3. Ontologies (WP9)',
    title: 'Définir, composer, migrer et exposer les ontologies (dev, track, archi, diagrammes)',
    needIds: ['N11'],
    capabilityId: 'C07',
    gigogneScene: 'ontologies',
    question: 'Qui gouverne le cycle de vie des ontologies et comment concilier paternité métier, identifiants anglais, affichage BCP 47 et journaux historiques ?',
    accountableOwner: 'engram (gardien de toutes les ontologies WP9 : validation, composition, jeux d’essai figés, migrations)',
    contributingOwners: 'h2a (auteur sémantique track/focus/org) · design-system (consommateur rendu/layout) · sentropic (exposition catalogue & registre MCP)',
    routeSteps: [
      '1. Le propriétaire métier (h2a, sentropic, bpmn-canvas, d2d) définit le sens et les invariants de son vocabulaire.',
      '2. Engram (lot WP9) valide le profil (identifiants 100 % en anglais), vérifie l’absence de collision lors de l’empilement, fige les jeux d’essai par empreinte SHA-256 et publie les migrations.',
      '3. Au build et au rendu : les consommateurs chargent les profils figés hors-ligne sans appel réseau ni MCP. À l’exécution : l’outil MCP ontology_call est exposé via cluster-mesh.',
      '4. Les valeurs françaises historiques persistées dans Track (mergé, déployé, relance) sont résolues par une table d’alias de lecture à vie avec affichage dans la langue utilisateur BCP 47, sans jamais réécrire .track/events.jsonl (Clause C-05).',
    ],
    nonOwnerGuard: 'La garde d’une ontologie par Engram ne transfère jamais la propriété des événements Track ni des bases de données applicatives.',
    readiness: {
      decision: 'actée par le propriétaire (lot WP9, anglais + BCP 47 + alias de lecture)',
      source: 'fusionné sur main (src/ontology-profile.ts, src/profile-validate.ts, src/merge-graphs.ts)',
      release: 'non publié en paquet unifié (interne)',
      host: 'non raccordé (outil MCP ontology_call au jalon M4)',
    },
    clauseIds: ['C-03', 'C-05', 'C-06', 'C-08', 'C-11'],
    highlight: deriveHighlight(central, [
      'e-eng-onto', 'e-eng-ds', 'e-api-mcp',
    ]),
  },
  {
    id: 'memory',
    shortLabel: '4. Mémoire agentique & live',
    title: 'Rappeler, capturer, admettre, oublier un souvenir (D3/D10) ou inspecter les faits Git (engram-live)',
    needIds: ['N07', 'N08', 'N09', 'N10'],
    capabilityId: 'C05 / C06',
    gigogneScene: 'memory',
    question: 'Comment fonctionne la mémoire live par agent sans créer de silos par processus ni retarder la chaîne prioritaire #685 → L5 → R2/R7a/R3 ?',
    accountableOwner: 'engram (journal canonique D3, projection filtrée D10 #393, 6 outils MCP gelés v3.2, faits Git engram-live)',
    contributingOwners: 'sentropic (hôte MCP qualifié #685 et lot L5 #697, stockage #684, catalogue R2/R7a/R3) · h2a (contexte agent/session et adoption volontaire R5/R6)',
    routeSteps: [
      '1. Ordre impératif « Mémoire d’abord » (jalon M1 avant M2) : qualification de l’hôte MCP (#685) et du stockage (#684) → raccordement des 6 outils MCP mémoire (lot L5 / #697) → exposition au catalogue (lots R2/R7a/R3).',
      '2. Contrat de stockage (OWNER-REQUEST.md → OWNER-ORIENTATIONS.md) : Sentropic/cluster-mesh fournit l’interface de sérialisation DB neutre et optimise trois surfaces. Engram déclare le transactionnel pour le journal D3, l’analytique pour les références de temps D1=C et le graphe live pour les faits Git/projections D10 ; il ne choisit aucun backend et sa fermeture de dépendances ne contient aucun pilote DB natif. SQLite et Postgres sont prioritaires ; E2/L5 doit qualifier le transactionnel sur SQLite (Node 24), puis Postgres. L’analytique et le graphe live restent à qualifier séparément.',
      '3. N07 (rappel) : l’hôte lie l’identité, le tenantId, le workspaceId et le périmètre (scope_ref) ; memory_search et memory_get lisent les souvenirs admis (accepted_current) autorisés sans révéler les entrées refusées (deny-as-missing).',
      '4. N08/N09 (admission et oubli) : memory_capture et memory_request_admission écrivent dans le journal D3 ; memory_withdraw et memory_forget appliquent la marque d’oubli (tombstone), filtrent .engram/graph.json (D10) et purgent le stockage (X2/X2b) sans résurrection lors d’une restauration (X4).',
      '5. N10 (engram-live) : surface distincte fournissant l’attribution de lignes (G1 #389), les symboles (G2 #390) et les 20 enquêtes de code (L9 #391 / L9-H #400).',
    ],
    nonOwnerGuard: 'Aucune sortie modèle ou annotation ne devient mémoire sans admission D3 ; aucune référence mémoire (MemoryRef) n’est commitée dans Git.',
    readiness: {
      decision: 'actée par le propriétaire',
      source: 'fusionné sur main (Engram 0.20.0, src/mcp/memory/contracts.ts:142, L9-H #400)',
      release: 'paquet publié (@sentropic/engram 0.20.0)',
      host: 'cible E2/L5 à qualifier : transactionnel SQLite (Node 24), puis Postgres ; preuves distinctes pour analytique et graphe live',
    },
    clauseIds: ['C-02', 'C-07', 'C-12', 'C-14'],
    highlight: deriveHighlight(central, [
      'e-eng-mem', 'e-eng-store', 'e-wf-store', 'e-mesh-h2a', 'e-apis-wf', 'e-api-sec',
    ]),
  },
  {
    id: 'diagram-meta',
    shortLabel: '5. Diagrammes gigognes & BPMN',
    title: 'Modéliser en diagrammes gigognes (Graphe × Layout × Skills) et éditer BPMN sans perte',
    needIds: ['N12', 'N13'],
    capabilityId: 'C07',
    gigogneScene: 'ontologies',
    question: 'Comment articuler graphe sémantique, algorithmes de mise en page dans nos propres souches JS, skills de présentation, éditions atomiques et autonomie hors-ligne sans CDN ?',
    accountableOwner: 'Engram : profils WP9 ; DS : diagram-core, layout et rendu (G2 actée le 2026-10-19 : « G2 = option 1 »).',
    contributingOwners: 'h2a (skills de présentation Focus & ui://) · bpmn-canvas & d2d (mapping bpmn-moddle F1 & profile-c14n/2)',
    routeSteps: [
      '1. Tout diagramme est un graphe (SemanticDocument) ouvrable en sous-diagrammes gigognes ; toute représentation est une synthèse pilotée par une skill de présentation.',
      '2. La mise en page (ViewDocument, diagram-canvas L8, routage orthogonal et couverture ELK planifiée) utilise des algorithmes libres/publics implémentés dans nos propres souches JS.',
      '3. Les éditions mutent le graphe par transactions atomiques réactives ; les livrables embarqués fonctionnent 100 % hors-ligne sans CDN (le propriétaire acceptant l’embarquement JS autonome, y compris ~32 Mo si nécessaire).',
      '4. Pour BPMN (N13) : un seul mapping bpmn@1 ↔ bpmn-moddle (F1 conservant extensionElements/xmlns/xsi) et canonicalisation profile-c14n/2.',
    ],
    nonOwnerGuard: 'Zéro second méta-modèle de diagramme ; aucune dépendance CDN requise pour ouvrir ou éditer un dossier ou un diagramme hors-ligne.',
    readiness: {
      decision: 'G2 actée le 2026-10-19 : « G2 = option 1 » ; profils Engram et exécuteur DS.',
      source: 'fusionné (diagram-core 0.1.0, bpmn-canvas 0.3.0) ; focus-kit sur adaptateur provisoire',
      release: 'publié (bpmn-canvas) / privé dans DS (diagram-core, diagram-canvas)',
      host: 'configuré (convergence du moteur au jalon M4)',
    },
    clauseIds: ['C-05', 'C-06', 'C-11', 'C-14', 'C-16'],
    highlight: deriveHighlight(central, [
      'e-eng-ds', 'e-dossier-diagram', 'e-ds-components', 'e-ds-store', 'e-focus-dossier',
    ]),
  },
  {
    id: 'ci-timing',
    shortLabel: '6. Temps CI/CD & vélocité (D1=C)',
    title: 'Estimer un lot avec les références de temps mesurées (D1=C + agent-stats) ou expliquer un retard',
    needIds: ['N32', 'N33'],
    capabilityId: 'C14',
    gigogneScene: 'memory',
    question: 'Où résident les références de temps (vélocité IA, durées CI/CD) et comment alimentent-elles la planification h2a sans fausse certitude ?',
    accountableOwner: 'engram (service central des références de temps D1=C, 01M57PXN14JMZ23BM3YK537JWH)',
    contributingOwners: 'h2a (estimateur de délai WP8 & agent-stats) · sentropic (collecte d’observations CI/CD #698 et reçus d’exécution)',
    routeSteps: [
      '1. Sentropic et les runners collectent les durées d’exécution horodatées (#698) avec l’empreinte du régime de configuration.',
      '2. Engram (D1=C) maintient les distributions (P50/P80/P95) par phase comparable et génère les exports typés commités (knowledge/ci/timings.json sous repo-knowledge@1).',
      '3. N32 : l’estimateur h2a (lot WP8, articulé avec agent-stats) et la skill plan combinent ces cohortes avec la capacité et les dépendances courantes, en marquant explicitement incomplete/unknown.',
      '4. N33 : en cas d’échec ou de lenteur, corrélation par auditId/correlationId entre reçu hôte, trace Track et faits Engram.',
    ],
    nonOwnerGuard: 'Les temps de jobs CI ne remplacent jamais les temps de codage/revue ; une prédiction ne permet jamais de sauter une porte de qualification.',
    readiness: {
      decision: 'actée par le propriétaire (D1=C)',
      source: 'sur branche (#698, .graphify/scratch/design/velocity/) & fusionné (agent-stats 0.1.0)',
      release: 'non publié pour D1=C (interne)',
      host: 'non raccordé (déploiement au jalon M4)',
    },
    clauseIds: ['C-02', 'C-10', 'C-12', 'C-13'],
    highlight: deriveHighlight(central, [
      'e-eng-observe', 'e-infra-observe', 'e-wf-observe', 'e-mesh-h2a', 'e-track-agent',
    ]),
  },
  {
    id: 'security-2fa',
    shortLabel: '7. Sécurité, IAM & 2FA (#695)',
    title: 'Authentifier un humain ou une identité non-humaine (NHI), isoler par namespace et exiger le 2FA (amr: "mfa")',
    needIds: ['N26'],
    capabilityId: 'C12',
    gigogneScene: 'annotate',
    question: 'Qui vérifie l’identité, la révocation, l’isolation par espace (namespace) et l’élévation 2FA pour les actions sensibles ?',
    accountableOwner: 'sentropic (auth-idp, auth-hono session-resolver.ts, politique MFA par application #695)',
    contributingOwners: 'h2a (identités d’acteurs vérifiées DEC-114, gouvernance NHI1..NHI9 et mandats)',
    routeSteps: [
      '1. L’hôte Sentropic résout la session (session-resolver.ts:18,47), vérifie l’absence de révocation/expiration et lie tenantId, workspaceId et namespace.',
      '2. Pour toute route ou action exigeant le 2FA (#695), le middleware vérifie la preuve amr: "mfa" (neutre vis-à-vis du facteur : passkey/WebAuthn ou TOTP) et le prérequis de récupération R-REC-1.',
      '3. Pour un agent/NHI, la couture vérifie la chaîne de délégation h2a (NHI1..NHI9) sans jamais accorder plus de droits que le mandat courant.',
      '4. Un reçu de sécurité transactionnel est enregistré.',
    ],
    nonOwnerGuard: 'Ne jamais confondre par homonymie workspaceId, tenantId, namespace Hono, namespace de ressource, schéma SQL et namespace Kubernetes (Clause C-07).',
    readiness: {
      decision: 'actée par le propriétaire',
      source: 'fusionné (session-resolver, nhi.ts) / sur branche (#695 r2)',
      release: 'paquet publié',
      host: 'actif sur l’hôte',
    },
    clauseIds: ['C-01', 'C-07', 'C-10', 'C-17'],
    highlight: deriveHighlight(central, [
      'e-roles-track', 'e-track-agent', 'e-h2a-cli', 'e-cli-api', 'e-api-sec', 'e-sec-observe',
    ]),
  },
  {
    id: 'custody-judge',
    shortLabel: '8. Garde des sièges & Juge LLM',
    title: 'Gérer la garde centrale des sièges CLI (#596), router un appel modèle ou invoquer le Juge LLM',
    needIds: ['N27', 'N28'],
    capabilityId: 'C13',
    gigogneScene: 'central',
    question: 'Où sont gardés les identifiants de sièges (Claude, Codex, Gemini) et quel est le statut exact du Juge LLM ?',
    accountableOwner: 'sentropic (@sentropic/llm-mesh & @sentropic/llm-gateway #596 ; @sentropic/llm-mesh/judge sur branche)',
    contributingOwners: 'h2a (matérialisation locale en lecture seule access-only sur l’hôte CLI #348, jamais propriétaire de la garde centrale)',
    routeSteps: [
      '1. N27 (garde des sièges & routage) : @sentropic/llm-mesh garde le trousseau chiffré (SeatBundle ≤ 48 Kio) avec un seul rafraîchisseur actif par siège ; h2a et engram ne reçoivent que des projections access-only.',
      '2. Le catalogue IA expose LLM, juge, vision/SAM-YOLO, TTS, STT… ; llm-gateway sélectionne le modèle et le siège éligibles, puis émet les observations. La garde des sièges et l’autorisation relèvent du bloc sécurité ; le code de garde #596 reste dans llm-mesh. Les familles supplémentaires restent à qualifier.',
      '3. N28 (Juge LLM) : @sentropic/llm-mesh/judge exécute l’évaluation multi-modèles sous enveloppe JEV avec reçu de règlement. Tant que la branche feat/llm-judge (030198a3) n’est pas fusionnée sur main, son statut reste affiché comme « sur branche ».',
    ],
    nonOwnerGuard: 'Un verdict du Juge LLM est une preuve d’évaluation technique, jamais une décision ni une acceptation propriétaire dans Track.',
    readiness: {
      decision: 'actée par le propriétaire (#596)',
      source: 'fusionné (llm-mesh 0.26.1) / sur branche (feat/llm-judge 030198a3)',
      release: 'publié (llm-mesh) / non publié (judge)',
      host: 'actif (gateway) / non raccordé (judge)',
    },
    clauseIds: ['C-01', 'C-04', 'C-07', 'C-10'],
    highlight: deriveHighlight(central, [
      'e-wf-ai', 'e-ai-sec', 'e-mesh-h2a',
    ]),
  },
  {
    id: 'canvas-ui',
    shortLabel: '9. Canvas UI & Focus (Option E)',
    title: 'Inscrire les canvas (UI + interaction IA) au catalogue, les exposer en MCP, les héberger sur artifacts et en UI prod',
    needIds: ['N05', 'N17', 'N18'],
    capabilityId: 'C03 / C09',
    gigogneScene: 'ontologies',
    question: 'Comment les canvas (UI + interaction IA) sont-ils inscrits au catalogue, exposés en MCP, hébergés par-dessus @sentropic/artifacts et servis en UI de production ?',
    accountableOwner: 'design-system (221 composants Svelte exportés, thèmes, <st-decision-dossier>, diagram-canvas L8) · h2a (schéma/skill @sentropic/focus, module MCP ui:// H-4) · sentropic (catalogue kind="canvas", registre MCP #692 & hébergement @sentropic/artifacts)',
    contributingOwners: 'sentropic (catalogue types.ts:22, registre MCP packages/mcp-platform/src/registry.ts, @sentropic/artifacts 0.1.1 et adaptateurs d’hôte prod)',
    routeSteps: [
      '1. N05 (Focus, Option E) : @sentropic/focus (h2a, H-1/H-3) définit DecisionDossierDocument et la skill ; @sentropic/h2a (H-4) fournit le module MCP ui:// ; cluster-mesh l’inscrit dans son catalogue et son registre MCP ; le Design System rend <st-decision-dossier>.',
      '2. N18 (canvas = UI + interaction IA) : chaque canvas est inscrit au catalogue (kind="canvas" dans api/src/services/catalog/types.ts:22, SPEC_EVOL_CATALOG.md:99,150), exposé via un serveur MCP (SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md:91, SPEC_EVOL_CLUSTER_MESH_MCP_REGISTRY_ARTIFACTS.md:101,109 #679/#692), hébergé par-dessus @sentropic/artifacts (CanonicalManifest SHA-256) et montable comme UI en production.',
      '3. N17 (écrans managés en prod) : les applications consomment les 221 composants exportés, les jetons --st-* et le moteur L8 dans nos propres souches JS (transactions atomiques, 100 % offline sans CDN).',
    ],
    nonOwnerGuard: 'Tout canvas combine UI et interaction IA via le catalogue et le registre MCP de sentropic (cluster-mesh), hébergé sur @sentropic/artifacts et potentiellement en UI de prod.',
    readiness: {
      decision: 'actée par le propriétaire (Option E, arbitrages diagrammes & arbitrage post-R3 sur les canvas)',
      source: 'fusionné (DS Svelte 0.36.0, focus 0.5.0, catalog kind="canvas", artifacts 0.1.1)',
      release: 'paquets publiés (Svelte, focus, artifacts)',
      host: 'configuré',
    },
    clauseIds: ['C-01', 'C-04', 'C-05', 'C-11', 'C-15', 'C-16'],
    highlight: deriveHighlight(central, [
      'e-focus-dossier', 'e-dossier-diagram', 'e-dossier-annotations', 'e-ds-components', 'e-ds-catalog', 'e-ui-resources', 'e-ui-artifacts', 'e-catalog-artifacts', 'e-canvas-mcp',
    ]),
  },
  {
    id: 'artifacts',
    shortLabel: '10. Modèles & artefacts (#684)',
    title: 'Sérialiser les modèles par une interface DB neutre et publier des artefacts scellés',
    needIds: ['N23', 'N25'],
    capabilityId: 'C10',
    gigogneScene: 'traceability',
    question: 'Qui porte l’interface de sérialisation neutre et les trois surfaces optimisées, quelles bases sont prioritaires, et comment distinguer modèles persistés et artefacts publiés ?',
    accountableOwner: 'sentropic / cluster-mesh (interface DB neutre, trois surfaces optimisées, stockage #684, @sentropic/artifacts 0.1.1, règles DL-8/13/17)',
    contributingOwners: 'Propriétaires des applications managées (schéma métier) · engram (cascade d’oubli mémoire X2/X2b et non-résurrection X4)',
    routeSteps: [
      '1. N25 (contrat cible) : Sentropic/cluster-mesh porte l’interface de sérialisation DB neutre et trois surfaces optimisées : transactionnel, analytique et graphe live. SQLite et Postgres sont prioritaires. Les éléments observés #684 (/storage/postgres et S3) ne prouvent pas la qualification de ce contrat. Spanner, Iceberg et Neo4j sont des extensions possibles à étudier/qualifier ; S3 reste aussi une piste de sérialisation à faible fréquence.',
      '2. Engram consomme cette interface de façon agnostique : il déclare la surface (journal D3 transactionnel, temps D1=C analytique, faits Git/projection D10 en graphe live), ne choisit aucun backend et n’embarque aucun pilote DB natif dans sa fermeture de dépendances. E2/L5 doit qualifier le transactionnel sur SQLite (Node 24), puis Postgres ; les deux autres surfaces nécessitent leurs propres preuves.',
      '3. N25 (modèles & cycle de vie) : graphe live en base, annotations, documents/vues et états de sessions sont sérialisés par cette interface, séparément des bundles et releases. Export, restauration et effacement respectent DL-8/13/17 ; Engram reste l’autorité D3/D10. Les tombstones sont réappliqués avant toute réouverture après restauration.',
      '4. N23 (artefacts observés) : @sentropic/artifacts 0.1.1 crée un manifeste scellé par empreinte SHA-256 (CanonicalManifest), publie une release/canal et délivre l’accès via un jeton HMAC court (55 s) sur origine isolée (<artifactId>.<base> / <releaseId>.pinned.<base>). Cette responsabilité reste distincte de la sérialisation des modèles.',
    ],
    nonOwnerGuard: 'Un hachage non cryptographique de mise en page (FNV) ne remplace jamais une empreinte SHA-256 d’artefact (Clause C-06).',
    readiness: {
      decision: 'actée par le propriétaire',
      source: 'observé : #679, #684 Postgres/S3 et artifacts 0.1.1 ; contrat neutre et trois surfaces optimisées à qualifier',
      release: 'artifacts 0.1.1 publié ; aucune livraison déduite pour les adaptateurs cibles ou supplémentaires',
      host: 'Postgres/S3 selon preuves existantes ; E2/L5 SQLite puis Postgres et autres surfaces à qualifier',
    },
    clauseIds: ['C-02', 'C-06', 'C-10', 'C-12'],
    highlight: deriveHighlight(central, [
      'e-ds-store', 'e-ds-components', 'e-ds-catalog', 'e-ui-artifacts', 'e-catalog-artifacts', 'e-comments-store', 'e-eng-store',
    ]),
  },
  {
    id: 'trace-e2e',
    shortLabel: '11. Traçabilité 7 sauts (demande → prod)',
    title: 'Suivre de bout en bout une demande propriétaire jusqu’à la mise en production et l’acceptation',
    needIds: ['N03', 'N04', 'N06', 'N31'],
    capabilityId: 'C02 / C04',
    gigogneScene: 'traceability',
    question: 'Comment relier demande, lot de travail (WP) Track, décision Focus, PR/commit, test harness, artefact, déploiement prod et acceptation sans créer un journal doublon ?',
    accountableOwner: 'h2a (lignée @sentropic/track : demand → WP/item → decision → acceptance) en fédération avec chaque autorité de saut',
    contributingOwners: 'sentropic (@sentropic/harness VerificationRun, @sentropic/artifacts SHA-256, reçus d’installation/déploiement) · engram (faits Git engram-live)',
    routeSteps: [
      '1. Sauts 1 & 2 (h2a) : la demande propriétaire (demand.raised) est rattachée à un lot de travail (WP) dans Track avec son périmètre (BRANCH.md) et sa décision Focus (decision.select).',
      '2. Sauts 3 & 4 (Git / engram-live / harness) : les commits et PRs sont indexés par engram-live ; @sentropic/harness émet la preuve mécanique (VerificationRun) et au moins 2 pairs indépendants signent la revue.',
      '3. Sauts 5 & 6 (Sentropic / k8s) : @sentropic/artifacts scelle l’empreinte SHA-256 de la release ; le déploiement produit un reçu d’installation par environnement avec cible de retour arrière (fusion ≠ installation).',
      '4. Saut 7 (Acceptation) : le propriétaire ou l’application consommatrice enregistre l’acceptation dans Track (distincte de done et de la simple publication npm).',
    ],
    nonOwnerGuard: 'Ni une fusion Git, ni une CI verte, ni une publication npm ne valent preuve d’installation en production ou d’acceptation propriétaire.',
    readiness: {
      decision: 'actée par le propriétaire',
      source: 'fusionné sur main (briques des 7 sauts)',
      release: 'paquets publiés',
      host: 'configuré (fermeture bout-en-bout au jalon M5)',
    },
    clauseIds: ['C-02', 'C-08', 'C-10', 'C-11', 'C-14'],
    highlight: deriveHighlight(central, [
      'e-track-agent', 'e-focus-agent', 'e-mesh-h2a', 'e-wf-observe', 'e-infra-observe', 'e-artifacts-infra', 'e-api-provider', 'e-api-cluster',
    ]),
  },
  {
    id: 'cowork-cloud',
    shortLabel: '12. Organisation & accès CLI / Cowork / Cloud / IA',
    title: 'Résoudre les mandats et accéder aux capacités par CLI, Cowork, Cloud ou les fournisseurs IA',
    needIds: ['N01', 'N02', 'N29', 'N30'],
    capabilityId: 'C01 / C04 / C08 / C13',
    gigogneScene: 'central',
    question: 'Comment s’articulent les rôles h2a, la garde de périmètre d’espace de travail et l’exécution sur poste local (CLI / Cowork) ou Cloud ?',
    accountableOwner: 'h2a (rôles org.h2a.yaml, RACI, workspace-scope-guard) · sentropic (cowork-bridge/desktop, WorkspaceBindingStore, workloads K8s)',
    contributingOwners: 'Opérateur d’infrastructure (exploitation du cluster poc-k8s distincte des workloads tenants Sentropic)',
    routeSteps: [
      '1. N01/N02 (organisation & espace de travail) : résolution de l’identité d’acteur vérifiée (DEC-114), du mandat par acte (G1) et du droit d’accès au dépôt/worktree (workspace-scope-guard).',
      '2. N29 (Cowork) : @sentropic/cowork-bridge et cowork-desktop vérifient l’enrôlement de l’appareil, la présence et le consentement explicite par action (drive.instruction).',
      '3. N30 (CLI / Cowork / Cloud) : WorkspaceBindingStore (D1=A) lie durablement le projet aux sessions des deux moteurs (PTY local et moteur API Sentropic) sous exclusion prioritaire.',
      '4. ChatGPT, Gemini, Claude et Muse sont aussi des surfaces d’accès, avec des liaisons Cowork / MCP à qualifier par fournisseur. Les façades API exposent les capacités partagées ; l’accès ne suppose pas une chaîne Cowork → CLI → Cloud.',
    ],
    nonOwnerGuard: 'Une étiquette de rôle non ratifiée n’accorde aucun droit d’écriture ; la coordination h2a ne contourne jamais le consentement de l’appareil Cowork.',
    readiness: {
      decision: 'G1 actée le 2026-10-19 : « G1 = option 1 » ; contrat fédéré par acte.',
      source: 'briques CLI/Cowork/Cloud fusionnées ; liaisons fournisseurs IA à qualifier',
      release: 'paquets existants publiés ; aucun statut de publication déduit pour les nouveaux raccordements',
      host: 'CLI/Cowork/Cloud selon qualification existante ; raccordements IA à établir',
    },
    clauseIds: ['C-01', 'C-03', 'C-07', 'C-08', 'C-09', 'C-17', 'C-18'],
    highlight: deriveHighlight(central, [
      'e-roles-track', 'e-track-agent', 'e-h2a-cli', 'e-cli-api', 'e-cowork-api', 'e-cloud-api', 'e-ai-api', 'e-ai-cowork', 'e-api-sec',
    ]),
  },
];

export const GIGOGNE_VIEWS = [
  { id: 'central', label: 'Vue centrale', badge: 'Gouvernance' },
  { id: 'annotate', label: 'Annotation', badge: 'annotate / annotation' },
  { id: 'ontologies', label: 'Ontologies', badge: 'Graphe × Layout × Skills' },
  { id: 'memory', label: 'Mémoire', badge: 'D3/D10 · Temps D1=C' },
  { id: 'traceability', label: 'Traçabilité', badge: 'Demande → Prod' },
];

export const architectureScenes = {
  central,
  annotate,
  ontologies,
  memory,
  traceability,
};

export const decisionScenes = {};
