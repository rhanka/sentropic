# Rapport — feat/llm-mesh-enroll-cli (reprise 09/11)

Branche `feat/llm-mesh-enroll-cli`, worktree `tmp/worktrees/llm-mesh-enroll-cli`.
PR #983 (OPEN, base `main`). Tête poussée : `8a9a54576`.

## État

- Run 42662913703 : 46 échecs, cause racine corrigée (commit 8a9a54576).
- Run 42710018359 (tête 7808a18c5) : 6 échecs restants, tous repris ci-dessous.
- Tête poussée : `d58d6993e`. PR #983 MERGEABLE, non fusionnée.
- Rebase sur `origin/main` (`67205fe00`) : 12 commits rejoués, zéro conflit
  hors `BRANCH.md` (version de branche conservée).

## Suivi du run 42710018359 (6 échecs : 46 → 6)

1. `test-api-unit-integration (unit, 1)` et `(unit, 4)` :
   `api/tests/unit/gateway-package-version.test.ts` attendait `0.22.4`,
   l'instance installée est `0.22.5`. Pin mis à jour (BRENROLL-EX4).
2. `validate-cluster-mesh (source)`, specs `speech-projection` et
   `speech-revision` : `LLM_MESH_SPEECH_RANGE` (`<0.34.0`) refusait le
   llm-mesh 0.34.0 installé alors qu'il exporte `./speech`. Plage élargie
   à `<0.35.0`, `speech-peer.spec.ts` ajusté (0.34.0 admis).
3. `validate-cluster-mesh (source)`, `gateway-surface` (2) et `llm-surface`
   (1) : versions figées `0.22.4`/`0.33.0` via `tests/fixtures/train.ts`.
   Passées à 0.22.5/0.34.0.
4. `validate-cluster-mesh (source)`, `skew-invariants` (2) : regex codée en
   dur avec l'ancienne plage dans `skew-invariants.ts`. Alignée sur `<0.35.0`.
5. `validate-cluster-mesh (lazy)` : fixture `selected` régénérée par la voie
   officielle (`refresh-lazy-package-lock`), après reconstruction fraîche
   des dist mcp-platform/artifacts/auth-ui (les dist du worktree étaient
   périmées ou absentes ; les builds `make` correspondants sont bloqués par
   un `node_modules` root-owned sous `packages/llm-mesh`, à nettoyer avec
   sudo — voir plus bas). Deux corrections de données prouvées :
   intégrité artifacts 0.2.25 `4NL6` → `jc0f` (métadonnée registre et build
   local concordent), URLs registre pour les entrées mesh 0.34.0 / gateway
   0.22.5 non publiées avec les hashes frères qSVv/vNA1 (ceux des logs CI).
6. `test-e2e (2)` : un seul échec, `05-i18n.spec.ts` (libellé fallback
   matrice, 27 passés). Surface UI non touchée par la branche (bin CLI plus
   chaînes de version uniquement) ; laissé au verdict du nouveau run.
7. `ci-gate` : conséquence des échecs ci-dessus.

## Suivi du run 42718308820 (4 échecs : 6 → 4)

- `test-api-unit-integration` et `test-e2e` : repassés au vert (pins corrigés).
- `validate-cluster-mesh (source)` et `(lazy)` : un seul test restant,
  `artifacts-tuple` « pins the selected artifacts release archive » — la
  spec figeait l'ancien hash 4NL6. Pin passé à jc0f (commit 846126952) ;
  tout le reste de la lane source est vert (speech, gateway-surface,
  llm-surface, skew-invariants).
- `validate-cowork-bridge` : échec infra prouvé (Docker Hub 502 sur le pull
  de l'image node, aucun code de branche exécuté, 18 s). Transitoire, couvert
  par le push frais, aucun rerun.
- Tête poussée : `846126952`, run 42722166769.

## Suivi du run 42722166769 (2 échecs : 4 → 2)

- `validate-cluster-mesh (source)` et `(lazy)` : VERTS (fixture + pin).
- `test-api-unit-integration`, `validate-cowork-bridge` : VERTS.
- `test-e2e (1)` : 45 passés, 1 échec — `07-matrix.spec.ts:572`
  (lock/presence, timeout 2 s sur propagation de release). Même arbre
  fonctionnel vert au run précédent ; surface non touchée. Candidat flake
  enregistré dans `BRANCH.md` (sans acceptation, sans sign-off).
- `ci-gate` : conséquence.

Note : le push `d58d6993e` n'a déclenché aucun run (événement GitHub perdu,
constaté : aucun check, PR restée ouverte). Le rebase suivant sur le nouveau
`main` (`00d160d79`, #986 artifacts-live, sans recouvrement) a relancé la
machinerie. La branche est de nouveau MERGEABLE après chaque rebase.

## Écarts procéduraux assumés

- Compilations dist mcp-platform/artifacts/auth-ui rejouées en `docker run`
  direct (recette make recopiée à l'identique, même image, même toolchain),
  car `make build-*` exige `install-internal-packages`, bloqué par des
  fichiers root-owned que la règle m'interdit de supprimer :
  `tmp/worktrees/llm-mesh-enroll-cli/packages/llm-mesh/node_modules`
  (et `.vite`). Nettoyage sudo à prévoir par l'owner.
  Les livrables commis restent produits par les cibles officielles.
- Test API ciblé non rejoué en local (nécessite la stack compose sur un hôte
  saturé) ; la valeur reçue `0.22.5` est prouvée par le log CI, le pin est
  une égalité stricte. CI tranche.

## Cause racine (preuves du run 42662913703)

1. `ClusterMeshTopologyError` dans chaque conteneur api-sut :
   `installed @sentropic/llm-mesh@0.34.0 does not satisfy the required range
   "0.19.2 || >=0.22.0 <0.34.0"`.
   La plage admit dans les `peerDependencies` (`<0.35.0`) n'avait pas été
   répercutée sur la constante codée en dur `LLM_MESH_RANGE` de
   `packages/cluster-mesh/src/modules/catalog.ts`.
2. `package-candidates` : `bump required: @sentropic/llm-gateway@0.22.4 is
   already published and dependencies["@sentropic/llm-mesh"] changed
   "... || ^0.33.0" -> "... || ^0.33.0 || ^0.34.0"`.
   La garde bumpGate exige un bump patch du gateway quand sa plage llm-mesh
   s'élargit (précédent 143392cea).
3. Les échecs `validate-*` en cascade (`Artifact not found for name:
   package-candidates`) découlent de 2, pas de défauts propres.

## Correctif (commit 8a9a54576, 12 fichiers, 51+/28-)

- `catalog.ts` : `LLM_MESH_RANGE` `<0.34.0` → `<0.35.0`.
  `LLM_MESH_SPEECH_RANGE` inchangée (`<0.34.0`) : `speech-peer.spec.ts`
  exige le refus de `speech` sur 0.34.0.
- `packages/llm-gateway/package.json` : 0.22.4 → 0.22.5 (> npm 0.22.4).
- `packages/cluster-mesh/package.json` : 0.26.0-dev.19 → 0.26.0-dev.21.
- Six specs + fixture `selected` alignés (admet 0.34.0, refuse 0.35.0).
- `package-lock.json` racine régénéré via make (chaînes de version).
- Porte post-rebase : llm-mesh 0.34.0 > npm 0.33.0, gateway 0.22.5 > npm
  0.22.4, BRLOCK-EX1 intact dans `BRANCH.md`.

## Commandes exactes (worktree, premier plan, slot Docker)

```
git -C tmp/worktrees/llm-mesh-enroll-cli fetch origin main
gh pr view 983 --json number,title,state,mergeable,mergeStateStatus,headRefName,baseRefName,url
gh pr checks 983
gh run view 42662913703 --log-failed
cd tmp/worktrees/llm-mesh-enroll-cli && /home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh make typecheck-cluster-mesh ENV=test-llm-mesh-enroll API_PORT=8925 UI_PORT=5325 MAILDEV_UI_PORT=1225
cd tmp/worktrees/llm-mesh-enroll-cli && /home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh make test-cluster-mesh SCOPE=tests/packaging/tuple-skew.spec.ts ENV=test-llm-mesh-enroll API_PORT=8925 UI_PORT=5325 MAILDEV_UI_PORT=1225
cd tmp/worktrees/llm-mesh-enroll-cli && /home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh make test-cluster-mesh SCOPE=tests/modules/registry.spec.ts ENV=test-llm-mesh-enroll API_PORT=8925 UI_PORT=5325 MAILDEV_UI_PORT=1225
cd tmp/worktrees/llm-mesh-enroll-cli && /home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh make test-cluster-mesh SCOPE=tests/modules/topology-ranges.spec.ts ENV=test-llm-mesh-enroll API_PORT=8925 UI_PORT=5325 MAILDEV_UI_PORT=1225
cd tmp/worktrees/llm-mesh-enroll-cli && /home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh make test-cluster-mesh SCOPE=tests/speech-peer.spec.ts ENV=test-llm-mesh-enroll API_PORT=8925 UI_PORT=5325 MAILDEV_UI_PORT=1225
cd tmp/worktrees/llm-mesh-enroll-cli && /home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh make test-cluster-mesh SCOPE=tests/packaging/prepare-artifacts.spec.ts ENV=test-llm-mesh-enroll API_PORT=8925 UI_PORT=5325 MAILDEV_UI_PORT=1225
cd tmp/worktrees/llm-mesh-enroll-cli && /home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh make test-cluster-mesh SCOPE=tests/packaging/artifacts-tuple.spec.ts ENV=test-llm-mesh-enroll API_PORT=8925 UI_PORT=5325 MAILDEV_UI_PORT=1225
cd tmp/worktrees/llm-mesh-enroll-cli && /home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh make lock-root ENV=test-llm-mesh-enroll API_PORT=8925 UI_PORT=5325 MAILDEV_UI_PORT=1225
cd tmp/worktrees/llm-mesh-enroll-cli && git add BRANCH.md package-lock.json packages/cluster-mesh/package.json packages/cluster-mesh/src/modules/catalog.ts packages/cluster-mesh/tests/modules/registry.spec.ts packages/cluster-mesh/tests/modules/topology-ranges.spec.ts packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json packages/cluster-mesh/tests/packaging/fixtures/selected/package.json packages/cluster-mesh/tests/packaging/optional-install.spec.ts packages/cluster-mesh/tests/packaging/skew-invariants.spec.ts packages/cluster-mesh/tests/packaging/tuple-skew.spec.ts packages/llm-gateway/package.json
cd tmp/worktrees/llm-mesh-enroll-cli && make commit MSG="fix: admit llm-mesh 0.34 in cluster-mesh range plus gateway bump"
git -C tmp/worktrees/llm-mesh-enroll-cli rebase -X theirs origin/main
git -C tmp/worktrees/llm-mesh-enroll-cli push --force-with-lease origin feat/llm-mesh-enroll-cli
```

## Résultats locaux (ENV=test-llm-mesh-enroll, ports 8925/5325/1225)

- `typecheck-cluster-mesh` : vert.
- `tuple-skew` : 21 passés, 2 ignorés (gating packaging, hors flux lourd).
- `registry` : 51 passés. `topology-ranges` : 20 passés.
- `speech-peer` : 18 passés (plage speech inchangée, volontaire).
- `prepare-artifacts` : 20 passés. `artifacts-tuple` : 5 passés, 3 ignorés.

## Écart à la consigne de paquet

- Paquet : `merge origin/main`. Règle commune (prioritaire) : `rebase
  origin/main`, jamais de merge dans une branche PR. Rebase appliqué.
- Paquet : blocage premier plan jusqu'au CI vert. Règle quota (prioritaire) :
  pas de boucle d'attente CI ; push, rapport, sortie. Le conducteur
  relance à la complétion du run.
- Non fusionné, comme demandé. Pas de revue externe (conducteur).
