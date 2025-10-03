# Guide de Scoring IA - Système Fibonacci

## Valeurs Fibonacci autorisées
L'IA doit scorer chaque axe en utilisant UNIQUEMENT ces valeurs :
`[0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100]`

## Mapping vers les étoiles
Les scores Fibonacci sont mappés aux 5 niveaux d'étoiles comme suit :

| Score Fibonacci | Niveau Étoiles | Description |
|----------------|----------------|-------------|
| 0              | 1 étoile       | Très faible |
| 1              | 1 étoile       | Très faible |
| 3              | 2 étoiles      | Faible      |
| 5              | 2 étoiles      | Faible      |
| 8              | 2 étoiles      | Faible      |
| 13             | 3 étoiles      | Modéré      |
| 21             | 3 étoiles      | Modéré      |
| 34             | 4 étoiles      | Élevé       |
| 55             | 4 étoiles      | Élevé       |
| 89             | 5 étoiles      | Très élevé  |
| 100            | 5 étoiles      | Très élevé  |

## Exemple de scoring pour un cas d'usage

```json
{
  "valueScores": {
    "sponsorship": 21,        // 3 étoiles - Modéré
    "customer_satisfaction": 55, // 4 étoiles - Élevé
    "productivity": 8,        // 2 étoiles - Faible
    "agent_experience": 34,   // 4 étoiles - Élevé
    "compliance": 13          // 3 étoiles - Modéré
  },
  "complexityScores": {
    "ai_maturity": 5,         // 2 étoiles - Faible
    "implementation_effort": 89, // 5 étoiles - Très élevé
    "data_compliance": 21,    // 3 étoiles - Modéré
    "data_availability": 8,   // 2 étoiles - Faible
    "change_management": 34   // 4 étoiles - Élevé
  }
}
```

## Calcul du score total
1. Multiplier chaque score Fibonacci par le poids de l'axe
2. Sommer tous les scores pondérés
3. Le résultat final sera mappé aux étoiles pour l'affichage

## Instructions pour l'IA
- Utiliser UNIQUEMENT les valeurs Fibonacci listées
- Évaluer objectivement chaque axe selon les descriptions fournies
- Ne pas inventer de scores intermédiaires
- Justifier le choix de chaque score dans les commentaires
