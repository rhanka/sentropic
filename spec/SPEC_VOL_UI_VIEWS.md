# SPEC_VOL — UI Views (raw user demands)

> Ephemeral: to be absorbed into `SPEC_EVOL_WORKSPACE_TYPES.md` §12-§13, then deleted.

## Demand 1 — Container view unification

> "pour la page d'accueil du workspace 'neutre'... il faut un peu de spec (éviter de démultiplier les vues type folder, ie un dossier qui gere un ensemble d'objet. tout workspace a une vue type folder avec l'ensemble des objet"

- Un workspace est un conteneur de folders. Un folder est un conteneur d'initiatives.
- Le workspace neutre suit le même pattern "conteneur" que les folders.
- Il ne faut PAS créer des vues séparées pour chaque niveau (neutral dashboard vs folder view vs workspace view).
- Une seule vue "container" générique qui s'applique à tous les niveaux : workspace liste ses folders, folder liste ses initiatives, neutral liste ses workspaces.
- Implique du refactoring sur les vues existantes (Folder, UseCase list) pour converger vers ce pattern unifié.

## Demand 2 — Workflow launch templatizing

> "Pour la gestion de cas d'usage IA on a une page pour lancer le workflow complet. il faudrait aussi un templating pour la page de lancement d'un workflow"

- La page `/home` actuelle est le point d'entrée pour lancer un workflow de génération (cas d'usage IA).
- Cette page doit aussi être un view template (`object_type: "workflow_launch"`) pour que chaque type de workspace ait son propre formulaire de lancement.
- Le workspace template prédéfinit le mapping de toutes les vues, y compris home/launch.

## Demand 3 — Refactoring des vues existantes

> "ça veut dire qu'il y a du refacto sur certaines vues à spécifier pour le 1. et pour le 2 aussi. dans le 2 ça veut dire que le workspace template prédéfini le mapping des vues dont home. à gérer également."

- Point 1 (container): refacto des vues Folder/UseCase list vers le pattern container unifié.
- Point 2 (workflow launch): refacto de la page /home vers un view template paramétré par workspace type.
- Le workspace template map toutes les vues associées (container, detail, launch, dashboard, organization).

## Demand 4 — Tracking dans BRANCH.md

> "tu devrait avoir marqué un 0.x pour les spec UI, ce serait bien de tracer ça dans BRANCH.md"

- Ajouter une tâche 0.x dédiée aux specs UI dans le lot 0 de BRANCH.md.
