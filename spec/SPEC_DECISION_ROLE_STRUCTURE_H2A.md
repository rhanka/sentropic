# DECISION — Builder/role structure for Sentropic (h2a model)

Status: **RATIFIED 2026-06-11** (rhanka). Co-designed and converged: Opus 4.8 (conductor) +
Codex 5.5-xhigh (architect-grade, via `codex exec`). Architect h2a peer
(`codex:sentropic:4d4f4105158c`) co-sign pending (offline at ratification time).

## 1. Problem

Sentropic builds are run by parallel builder lanes (today: `scale`, `architect`,
`sentropic-chat`, `39etc`). The structure must become the most productive way to parallelise,
under three forward constraints the current setup handles poorly:

- **Scale:** the conductor will soon launch N agents (headless or headfull, local or remote)
  via the `remote` CLI, without limit. Roles must be **scalable** (instantiable ×N) and
  **orthogonal** (disjoint scopes).
- **Availability for major (orientation) decisions:** orientation must not block on one human
  (or agent) being unavailable.
- **Recette / UAT:** weak today (the conductor is poor at acceptance testing) — needs a
  dedicated control role and an assisted decision-aid.

Plus an architectural requirement: **decorrelate production deploys from merges on `main`**.

## 2. Roles (h2a model)

Invariant: a `SCOPE` never signs; a **mandated INSTANCE** signs for it. `CONTROL` audits/vetoes
and owns nothing. `AGENTS` are execution-only / non-signing unless explicitly principal-délégué.

| Rôle h2a | Instance | SCOPE | Possède / signe |
|---|---|---|---|
| **PRINCIPAL** | rhanka | produit, prod, irréversible | POLICY majeures, promotion prod, recette finale |
| **PRINCIPAL-DÉLÉGUÉ** *(slots à créer)* | `principal.arch` / `principal.auth` / `principal.platform` | décisions **réversibles** par domaine | sous AUTHORITY bornée, déléguée par MANDATE |
| **EXECUTIF** (builders) | `scale` / `sentropic-chat` / `39etc` / `apps-*` | leur domaine **disjoint** | readiness technique ; **pas** les contrats globaux |
| **ARCHITECT** | codex (transversal) | contrats, études ARCH, arbitrages préparatoires | propose CONTRACT/POLICY ; signe **seulement** si principal-délégué-mandaté |
| **CONDUCTOR** | `claude:sentropic-conductor` | orchestration, dashboard, handoffs, events track | **rien** (ne décide pas) |
| **MANDATAIRE** | `claude:track` | registre/buckets/realization | enregistre ; **master de la sémantique** ; ne juge pas |
| **CONTROL-RECETTE** *(à créer)* | — | gates UAT / preprod→prod | **audite / veto** ; ne possède rien ; ne promeut jamais lui-même |
| **AGENTS / SUBAGENTS** | `recette-runner:*`, builders ×N | exécution sous MANDATE+BINDING | non-signataires par défaut |

**Scalabilité.** Chaque lane expose des **SLOT** instanciables ×N via la CLI `remote`
(`builder.scale.<wp>.N`, `recette.diag.headfull.N`). Chaque instance reçoit un **MANDATE**
précis + un **BINDING** (repo / branch / env / contrats / tests) et **aucune AUTHORITY de
signature** sauf slot explicitement principal-délégué.

## 3. Decision-authority POLICY — D0 / D1 / D2 (h2a-native)

Exprimée comme une POLICY `decision-authority` indexée par `(SCOPE × classe de décision)`, et
non un vocabulaire parallèle (exigence rhanka : les rôles respectent strictement h2a).

| Niveau | h2a | Périmètre | Résolution |
|---|---|---|---|
| **D0** | AUTHORITY réservée au **PRINCIPAL** | prod, sécurité, tenant-model, mutation de CONTRACT publié | une INSTANCE mandatée par rhanka signe ; escalade via le CONDUCTOR |
| **D1** | AUTHORITY **déléguée par MANDATE** à un principal-délégué, bornée | décisions **réversibles** par domaine | **NEGOTIATION** : quorum 2/3 des signataires mandatés **ou** fenêtre no-objection ; `CONTROL` peut veto |
| **D2** | **execution-only** sous MANDATE | exécution dans le mandat du builder | pas de signature séparée |

**Timeout** (indisponibilité) → les agents ne continuent **que** sur du **réversible**
(derrière flag / en preprod). Jamais d'irréversible ni de prod sans signature D0.

## 4. Décisions ratifiées (dossier)

Quatre forks d'orientation, double-recommandés Opus+Codex, tranchés par rhanka le 2026-06-11.

### D-ROLE-1 — Disponibilité / délégation décisionnelle
- A — rhanka seul sur tout (simple, mais bloque dès indispo ; incompatible scaling N-agents).
- **B — POLICY D0/D1/D2 + principal-délégué (RETENU).**
- C — quorum agents autonome (rapide, mais AUTHORITY floue).
- **Choix rhanka : B**, avec exigence que **les rôles respectent strictement le framework h2a**
  (D-levels = AUTHORITY/MANDATE/POLICY/NEGOTIATION, cf. §3).

### D-ROLE-2 — Recette / UAT
- **A — CONTROL-RECETTE veto bloquant + rhanka accepte la prod (RETENU).**
- B — recette consultative sans veto (trop faible).
- C — CONTROL promeut la prod lui-même (viole l'invariant CONTROL).
- **Choix rhanka : A**, avec raffinement : un **UAT est accompagné d'une AIDE À LA DÉCISION**
  (cf. §6) et les **preuves peuvent inclure vidéo / screenshots** de démonstration.

### D-ROLE-3 — Découplage prod / main
- **A — `main`→preprod (CD) ; prod = promotion gated du même artifact (RETENU).**
- B — `main`→prod direct pour petits changements (rapide mais dangereux).
- C — branches d'environnement longues (dérive de config).
- **Choix rhanka : A** (cf. §7).

### D-ROLE-4 — Couplage libs-UX (auth/foundation/ui) ↔ apps + contrats publiés
- **A — loose coupling semver + coexistence vN/vN+1 (RETENU).**
- B — lockstep monorepo (lent).
- C — mutation ad hoc (non scalable).
- **Choix rhanka : A** (cf. §7).

## 5. RACI

| Décision | R | A | C | I |
|---|---|---|---|---|
| merge `main` | EXECUTIF lane | principal-délégué scope (rhanka si majeur) | CONTROL-CI/CONTRACT, ARCHITECT | CONDUCTOR, TRACK |
| promotion preprod→prod | EXECUTIF deployment / ARCH-17 | **rhanka** | CONTROL-RECETTE, CONTROL-SEC | builders, CONDUCTOR, TRACK |
| mutation CONTRACT publié | ARCHITECT + EXECUTIF concerné | rhanka **ou** principal-délégué contract | consommateurs impactés | CONDUCTOR, TRACK |
| orientation / spec | ARCHITECT ou EXECUTIF lane | PRINCIPAL scope | lanes impactées, CONTROL | CONDUCTOR, TRACK |
| recette / UAT | AIDEURS-RECETTE | CONTROL-RECETTE (verdict) ; rhanka (acceptation finale) | EXECUTIF app, utilisateurs | CONDUCTOR, TRACK |

## 6. Recette + UAT = aide à la décision

`CONTROL-RECETTE` possède un **ENGAGEMENT-RECETTE** par candidat de promotion. Chaque UAT est un
**dossier d'aide à la décision** :

1. **ENTRÉES** — diff, versions de libs, migrations, contrats touchés, chaîne de dépendances.
2. **ITEMS test/approuver pilotés par le risque** — dérivés de ce que le changement touche, pour
   lever les risques de la chaîne (ex. *« lib auth bumpée → tester le login SSO sur diag
   preprod »*, *« migration 0032 → vérifier l'intégrité des données »*).
3. **PROTOCOLE d'évaluation/test assisté** — étapes + résultats attendus + pass/fail, exécutables
   par les agents `recette-runner` (headfull via `remote` pour SSO / navigation / UAT visuelle).
4. **PREUVES** — résultats + **vidéo / screenshots** de démonstration → **attestation**.

Un veto renvoie aux builders ; une attestation alimente la NEGOTIATION de promotion prod. Ce
dossier EST le module « aide-à-la-décision » (∩ ARCH-09 track/dossier ; se complète d'une vue
kanban du track).

## 7. Découplage prod / main

Flux : `merge main` → build + tests + contract-tests → **CD vers PREPROD / validation
uniquement**. **La prod ne bouge JAMAIS par effet de bord du merge.**

**Promotion preprod→prod** = **même artifact (digest, pas de rebuild)** + dossier de promotion
(commit, versions libs, migrations, contrats touchés, preuves UAT, **attestation
CONTROL-RECETTE**, rollback) + **signature PRINCIPAL (rhanka)**.

**Loose coupling libs-UX ↔ apps** : `auth`, `foundation`, `ui` publient en **semver +
contract-tests + matrice de compatibilité par app**. Les apps **pinnent** en prod, consomment le
neuf **en preprod**, puis promeuvent **app par app**. Breaking change = **CONTRACT vN+1 +
période de coexistence**. Articulé avec **D5 edge-proxy** (preview sur domaine registrable
distinct) + **ARCH-17** (`AppDeployment` / `UatEndpoint` / routing / gate de promotion).
Sentropic reste **control-plane typé**, pas god-runtime.

## 8. Répartition immédiate des builders (mandats émis)

| Builder | SCOPE | Engagement (reste-à-faire) | Statut mandat |
|---|---|---|---|
| **`scale`** | `scope:foundations` | BR-60 outbox-v0 (en cours) · BR-59 registry-v0 · BR-61 ubo-storage · BR-52 artifact-store-port · BR-71a-e resource-plane · contrat storage/scale (gated rhanka) · infra preprod-CD + ARCH-17. BR-45/48 = impl follow-up (études mergées). | **ACK** |
| **`sentropic-chat`** | `scope:chat` | host-tools / `LocalToolName` ouvert (#1, débloque diag+openerp) · WP-CHAT B · chat-server wire (F1 openerp) · BR-58 ARCH-08 h2a-chat · résidu BR-38c. | **émis (lane à reconnecter)** |
| **`39etc`** | `scope:auth` | **BR-39e DÉJÀ FAIT** (#283, auth-hono 0.5.0). Clôture : clients OAuth openerp #288 (tenantId=null) + DS · fédération openerp (contrat IdP-side + D1-D5) · smoke UAT IdP · rotation secrets · 39n role-claim (mineur). Prérequis : `fix/ci-artifact-version-skew`. | **ACK** |
| **`apps-diag` / `apps-immo` / `apps-graphify`** *(à créer)* | `scope:apps:*` | BR-62 Diag (ARCH-03) · BR-63 Immo (repo org-B, ARCH-04) · BR-34 graphify-fusion. | à créer |

L'`architect` garde ARCH-02/05/06/09/10/15/16/17 + les mutations de CONTRACT/POLICY.

## 9. Open / next

- Créer les lanes **CONTROL-RECETTE** + **recette-runner** + **principal-délégué** + **apps-***
  (instanciation via `remote`).
- Co-sign de l'architecte h2a (codex) à la reconnexion.
- Reconnecter la lane **chat** pour livrer son mandat.
- Brancher l'aide-à-la-décision UAT sur **ARCH-09** + la vue **kanban** du track.

## 10. Review log

- 2026-06-11 — Co-design Opus 4.8 (conductor) + Codex 5.5-xhigh (architect-grade, `codex exec`).
  4 forks d'orientation présentés en dossier ; ratifiés par rhanka (D-ROLE-1=B, 2=A, 3=A, 4=A)
  avec 2 raffinements (rôles strictement h2a ; UAT = aide-à-la-décision + preuves vidéo). Mandats
  builders émis (`scale`, `39etc` ACK ; `sentropic-chat` en attente de reconnexion).
