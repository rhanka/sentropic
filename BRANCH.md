- [x] Ajouter l'endpoint d'arret du chat (`POST /api/v1/chat/messages/:id/stop`).
- [x] Permettre l'annulation d'un job cible dans la queue.
- [x] Finaliser un message assistant a partir des events stream apres arret.
- [x] Ajouter un bouton "Stopper" pendant la generation.
- [x] Retablir le scroll hors docker sans casser la barre a gauche en dock.

UAT:
- [x] Demarrer une reponse puis cliquer "Stopper" -> le message se finalise avec le contenu partiel.
- [x] Verifier que la barre de scroll apparait hors docker quand le contenu depasse.
- [x] Ouvrir le chat docke et confirmer que la barre de scroll reste a gauche.
