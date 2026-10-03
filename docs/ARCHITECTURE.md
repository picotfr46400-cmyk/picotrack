# Architecture PicoTrack

## Données et isolation des clients

Chaque client PicoTrack a son propre projet Supabase dédié, servi sur son propre sous-domaine (par exemple `efc.picotrack.fr` pour EFC), avec ses propres clés (URL, clé anon, service role) posées côté hôte. EFC conserve son projet actuel.

Aucune base n’est jamais partagée entre clients. Un nouveau client, c’est un nouveau projet Supabase et de nouvelles clés côté hôte, jamais un nouvel `environment_code` dans une base existante. Toute pull request qui mutualise une base entre clients est refusée en revue.

Les filtres `environment_code` et les listes blanches côté serveur dans `api/` ne sont qu’une défense en profondeur à l’intérieur de la base d’un client. Ce n’est pas un modèle multi-clients.

Argument de vente : les données de chaque client sont cloisonnées et ne se mélangent jamais avec celles d’un autre client.
