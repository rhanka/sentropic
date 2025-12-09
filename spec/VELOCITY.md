## Vélocité (base commits Git)

Périmètre : dépôt `/home/antoinefa/src/top-ai-ideas-fullstack`, fenêtre glissante 8 semaines.

### Commandes reproductibles
```bash
# Total des commits sur 8 semaines
git log --since='8 weeks ago' --pretty=oneline | wc -l

# Répartition journalière (iso date)
git log --since='8 weeks ago' --pretty='%ad' --date=iso-strict \
  | cut -c1-10 | sort | uniq -c
```

### Résultats observés (au 2025-12-09)
- Total 8 semaines : **262 commits** ⇒ moyenne ~33 commits/sem.
- Pic ponctuel (14/10) : 43 commits/jour (probablement batch).
- Répartition hétérogène ; prudence sur la taille moyenne d’un commit (non mesurée ici).

### Lecture prudente de capacité
- Base empirique : ~33 commits/sem. Pour planification réaliste, prendre une **capacité planif ~24-26 commits/sem** (marge imprévus/QA).
- Rythme cible incrémental : 1 incrément e2e (back+front) livrable toutes les 1-2 semaines.

### Rejouabilité
- Relancer les commandes ci-dessus après chaque sprint pour ajuster la capacité.
- Option future : mesurer “changeset size” (lignes ajout/suppression) et durée moyenne des PR pour affiner. 

