# SPEC EVOL TODO RAW

Source: user input (raw trace)
Date: 2026-02-27
Branch context: BR03

## Raw Product Input

- L'outil todo ne permet pas a l'IA de suivre son plan.
- Le but du todo est d'offrir a l'IA un outil de gestion de plan pour a la fois garder les renes et a la fois le presenter a l'utilisateur.
- Le comportement observe (screenshot): l'IA peut creer plan/TODO/taches avec todo_create, mais ne peut pas cocher / marquer comme fait une TODO ou une tache existante.
- Il faut un Lot 4 pour couvrir cette finalite (non implementee a ce stade).

### Fonctionnel demande

- Le plan/TODO est attache a la conversation.
- Quand un plan apparait, il doit etre sticky en bas de la conversation.
- Le composant doit etre repliable.
- Le composant doit prendre la pleine largeur.
- Le composant doit avoir une hauteur max avec un scroll interne, dans le style des autres composants.
- Pour l'instant, un seul TODO max par session.
- L'utilisateur peut demander a l'IA de modifier le plan ou l'avancement du plan.
- Pas d'edition collaborative du TODO pour l'instant (a venir).

### Statut et horodatage

- Quand l'IA acheve une task, la task doit etre cochee + barree dans l'UI.
- Le modele doit stocker l'horodatage de completion (si absent, micro-evolution data model en respectant la contrainte d'une seule migration).

### Vision future (hors BR03)

- A terme, listes mixtes multi-utilisateur / multi-IA.
- Prevoir une ergonomie dediee a l'affichage collaboratif (ex: logo des acteurs concernes).
- Ce point est a mettre en to-be dans les spec evol.
