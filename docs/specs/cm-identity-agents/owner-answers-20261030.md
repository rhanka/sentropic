# Owner answers, 2026-10-30 (verbatim), memory host dossier and app W4.a

Source dossier: .tmp/memory-host-composition/dossier/dossier.fr.md (spec r3 e5e112b9…). App gap illustration: .tmp/app-cm-users/gap.fr.md.

- Q1 (first wording): « C est pas assez clair. Peut etre un schema requis. » Reworded with a diagram: « À chaque appel (Recommandé) » — rights rechecked at every memory call.
- Q2: « Le service local doit passer par une auth agent de cluster mesh »
- Q3: « Ca doit etre porté en local par cluster mesh »
- Q4: « Registre du service local dans cluster mesh »
- Q5: « C est par agent h2a (role) au premier niveau pas specifiquement par cli. Cluster mesh doit garder les sessions et gere les asso d agent par dessus.u »
- Q6: « SQLite local (Recommandé) »
- Q8: « Effacer sans 2fa mais avec une escalade (demande a l utilisateur). Tracabilité requise »
- Q9: « Via role h2a. Mais les roles h2a devrait faire partie integrante de cluster mesh, comme agents (associés a une ou plusieurs cli et une memoire de role + memoire de repo avec capacite de gestion par owner géré par cluster mesh et lencadre h2a) »
- Q10: « Espaces par repo. Codex et claude ne sont pas des agents, ce sont des cli. Par defaut tous les workspace ont acces a toutes les clis. Les agents (conductor etc) autorisés sont ceux déclarés commité dans les projets. Note : il y a plusieurs niveaux d agents : role et memoriel (meme role multi session multi cli multi effort), sessions/cli. Les deux niveaux doivent avoir des id - h2a controle le premier niveau d autorisation (role +memoriel) et sentropic doit associer les deux et gerer les autoriaation au niveau des deux dans le contexte agentique (h2a gere qu un archi peut acceder a telles cli et tels modeles et tels droit mcp etc, et niveau cli doit aussi gerre en mode passtrhouh ou dans le cas sans role h2a le cas par ca ou general d acces a certains droit connevtwurs tc)) »
- Q11: « Invalider tout de suite (Recommandé) »
- Q7: not asked separately; covered by Q8 (escalation = ask the user, with traceability).
- App W4.a (PR #837), first answer: « C pas clair comme gap il me faut unenillustration. Ma question etant quelle foncrion manque a clister mesh pour faire la gestion utilistaeur de app. Cluster mesh devrait prendre vraiment 100% a terme »; after the illustration: « Je vois pas comment app peut fonctionner sans que cluster mesh gere utilisateurs workspaces et roles agents h2a (et les agents h2a doivent utiliser le cadre agentique sentropic meme si en cli) »

Related owner request relayed by the h2a conductor (30/10, verbatim): « je veux que les artefacts sentropic soient portés sur h2a mais aussi en fonctino cluster mesh (avec possibilité de basculer local / sentropic.sent-tech.ca mais de facon générique entre deux appli cluster mesh), et que les décision dossier soient des artefact particuliers affichable en local ou remote via cluster mesh, avec une fonction complémentaire: capacité pour l'utilisateur a basculer entre les decision dossier, mettre des annotation, et pouvoir faire un feedback vers la cli en question. ce peut être en plusieurs jalon (association multi cluster mesh dans un temps deux mais ca doit venir rapidement) »

## Federation dossier answers (2026-10-30, AskUserQuestion, verbatim)
- Q1a: « Poste ↔ serveur (Recommandé) »
- Q1b: « Toute personne ayant acces aux workspaces selon les partages en place »
- Q2: « Responsables + accords (Recommandé) »
- Q3: « Catégories + aperçu (Recommandé) »
- Q4: « Automatique selon règles (Recommandé) »
- Q5: « Oui, ils circulent (Recommandé) »
- Q6: « Reglable par instance. Defaut 24h mais reglable 7j »
- Q13: « Nouvelle mémoire liée (Recommandé) »
- Q7: « Pourquoi il serait pas actif aux deux endroit. C est un partage de siege. Le cluster mesh est l endroit (virtualisarion de device) »
- Q11: « Pas clair »
- Q8: « Pkoi ne pas copier les jetons »
- Q9: « Canada, 30 jours (Recommandé) »
- Not yet asked: Q10, Q12.
