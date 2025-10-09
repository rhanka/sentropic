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
    - generic [ref=e18]:
      - heading "Page non trouvée" [level=1] [ref=e19]
      - paragraph [ref=e20]: La page demandée n'existe pas.
      - link "Retour à l'accueil" [ref=e21]:
        - /url: /
```