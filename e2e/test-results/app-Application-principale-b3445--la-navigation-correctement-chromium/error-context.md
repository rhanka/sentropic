# Page snapshot

```yaml
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
        - link "Configuration métier" [ref=e10] [cursor=pointer]:
          - /url: /configuration-metier
        - link "Cas d'usage" [ref=e11] [cursor=pointer]:
          - /url: /cas-usage
        - link "Matrice" [ref=e12] [cursor=pointer]:
          - /url: /matrice
        - link "Dashboard" [ref=e13] [cursor=pointer]:
          - /url: /dashboard
        - link "Design" [ref=e14] [cursor=pointer]:
          - /url: /design
        - link "Données" [ref=e15] [cursor=pointer]:
          - /url: /donnees
        - link "Paramètres" [ref=e16] [cursor=pointer]:
          - /url: /parametres
      - generic [ref=e17]:
        - combobox [ref=e18]:
          - option "FR" [selected]
          - option "EN"
        - button "Connexion" [ref=e19] [cursor=pointer]
  - main [ref=e20]:
    - generic [ref=e21]:
      - heading "Bienvenue sur Top AI Ideas" [level=1] [ref=e22]
      - paragraph [ref=e23]: Décrivez votre contexte métier et découvrez des cas d'usage d'intelligence artificielle priorisés par valeur et complexité.
      - link "Commencer" [ref=e24] [cursor=pointer]:
        - /url: /home
```