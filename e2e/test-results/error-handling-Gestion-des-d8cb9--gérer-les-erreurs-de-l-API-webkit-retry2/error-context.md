# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]:
      - navigation [ref=e6]:
        - link "Accueil" [ref=e7]:
          - /url: /
        - link "Dossiers" [ref=e8]:
          - /url: /dossiers
        - link "Entreprises" [ref=e9]:
          - /url: /entreprises
        - link "Cas d'usage" [ref=e10]:
          - /url: "#"
        - link "Évaluation" [ref=e11]:
          - /url: /matrice
        - link "Dashboard" [ref=e12]:
          - /url: "#"
        - link "Paramètres" [ref=e13]:
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
  - alert [ref=e23]:
    - generic [ref=e24]:
      - generic [ref=e26]: ✕
      - paragraph [ref=e28]: Erreur lors du chargement des entreprises
      - button "Fermer" [ref=e30] [cursor=pointer]:
        - generic [ref=e31] [cursor=pointer]: Fermer
        - img [ref=e32] [cursor=pointer]
```