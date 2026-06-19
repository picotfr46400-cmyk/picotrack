# PicoTrack V42 — Performance Foundation

Objectif : réduire les lenteurs visibles avec peu de données et préparer la montée en volume.

## Corrections

- Chargement initial allégé : formulaires + comptage léger des réponses uniquement.
- Suppression du rechargement complet de `services`, `service_instances`, `databases` et `submissions` au démarrage.
- Ajout de scopes serveur sur `/api/records` :
  - `forms` : formulaires + compteurs de soumissions.
  - `services` : services + instances.
  - `databases` : bases métier.
  - `full` : compatibilité diagnostic.
- Chargement différé des écrans lourds à l'ouverture : Services, Centre d'exécution, Database.
- Cache mémoire court côté front pour éviter de relire les mêmes données à chaque navigation.
- Conservation des corrections V41 côté front comme base.

## SQL

Aucun SQL nécessaire.

## Tests à faire

1. Déployer.
2. Ouvrir PicoTrack et vérifier que la page Form Builder arrive plus vite.
3. Créer un formulaire, actualiser, vérifier qu'il reste présent.
4. Ouvrir Services / Exécution / Database et vérifier que les données se chargent à l'ouverture.
5. Vérifier console F12 : aucune erreur rouge.
