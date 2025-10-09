# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - generic [ref=e5]:
        - navigation [ref=e6]:
          - link "Accueil" [ref=e7] [cursor=pointer]:
            - /url: /
          - link "Dossiers" [ref=e8] [cursor=pointer]:
            - /url: /dossiers
          - link "Entreprises" [ref=e9] [cursor=pointer]:
            - /url: /entreprises
          - link "Cas d'usage" [ref=e10]:
            - /url: "#"
          - link "Évaluation" [ref=e11] [cursor=pointer]:
            - /url: /matrice
          - link "Dashboard" [active] [ref=e12]:
            - /url: "#"
          - link "Paramètres" [ref=e13] [cursor=pointer]:
            - /url: /parametres
        - generic [ref=e14]:
          - combobox [ref=e15]:
            - option "FR" [selected]
            - option "EN"
          - button "Connexion" [ref=e16] [cursor=pointer]
    - main [ref=e17]:
      - generic [ref=e19]:
        - heading "Entreprises" [level=1] [ref=e20]
        - button "Ajouter" [ref=e21] [cursor=pointer]
  - generic [ref=e22]: Top AI Ideas
```