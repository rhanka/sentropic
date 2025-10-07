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
      - generic [ref=e19]:
        - heading "Dossiers" [level=1] [ref=e20]
        - button "Nouveau dossier" [active] [ref=e21] [cursor=pointer]
      - generic [ref=e23]:
        - heading "Créer un dossier" [level=2] [ref=e24]
        - generic [ref=e25]:
          - textbox "Nom du dossier" [ref=e26]
          - textbox "Description" [ref=e27]
        - generic [ref=e28]:
          - button "Annuler" [ref=e29] [cursor=pointer]
          - button "Créer" [ref=e30] [cursor=pointer]
```