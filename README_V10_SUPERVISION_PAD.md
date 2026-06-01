# PicoTrack V10 — logique Supervision vs PAD

Cette version sépare clairement les deux cas :

## Supervision PC
- Un utilisateur Supervision est une vraie personne.
- Il est créé via Supabase Auth.
- PicoTrack envoie une invitation par e-mail.
- L'utilisateur clique sur le lien et choisit son mot de passe dans PicoTrack.
- Aucun identifiant ni mot de passe n'est saisi par l'admin PicoTrack.

## PAD Terrain
- Un PAD n'est pas attribué à une personne.
- Il n'utilise pas Supabase Auth.
- L'admin choisit un identifiant PAD et un mot de passe PAD.
- Le compte PAD est stocké dans la table `licenses`.

## À faire côté Supabase
1. Exécuter `supabase/sql/PICOTRACK_SCHEMA_PATCH.sql`.
2. Redéployer `supabase/functions/invite-user/index.ts`.
3. Redéployer `supabase/functions/delete-user/index.ts`.
4. Vérifier les secrets Edge Functions :
   - URL
   - ANON_KEY
   - SERVICE_ROLE_KEY
5. Dans Authentication > URL Configuration :
   - Site URL = https://picotrack.vercel.app
   - Redirect URLs = https://picotrack.vercel.app/*

## Test conseillé
1. Créer une Supervision PC avec un vrai e-mail jamais utilisé.
2. Ouvrir le mail.
3. Le lien doit ouvrir PicoTrack et afficher "Créer votre mot de passe".
4. Créer le mot de passe.
5. Se connecter.
6. Créer un PAD Terrain avec identifiant + mot de passe.
7. Vérifier que le quota PAD baisse, sans e-mail Supabase.
