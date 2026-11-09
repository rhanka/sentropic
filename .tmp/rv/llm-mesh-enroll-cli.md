# Rapport — feat/llm-mesh-enroll-cli (reprise 09/11)

Branche `feat/llm-mesh-enroll-cli`, worktree `tmp/worktrees/llm-mesh-enroll-cli`.
PR #983 (OPEN, base `main`). Tête poussée : `8a9a54576`.

## État

- Les 46 échecs CI du run 42662913703 ont une cause racine unique, corrigée.
- Rebase sur `origin/main` (`67205fe00`) terminé : 12 commits rejoués, zéro conflit
  hors `BRANCH.md` (version de branche conservée).
- Nouveau run CI déclenché par le push ; suivi à la charge du conducteur
  (règle quota : pas de boucle d'attente).

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
