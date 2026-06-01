# PicoTrack — Paramétrage des emails automatiques

## Ce qui a été corrigé

- Le mail automatique inclut maintenant tous les champs du formulaire via `{all_fields}`.
- Les valeurs complexes ne s'affichent plus en `[object Object]`.
- Les booléens sont transformés en `Oui` / `Non`.
- Les champs rendez-vous sont formatés proprement.
- Le logo PicoTrack est ajouté automatiquement dans le template serveur.
- Les champs `cc`, `bcc`, `replyTo` invalides ou vides sont ignorés avant l'envoi.

## Paramétrer un mail automatique

Dans PicoTrack :

1. Aller dans **Form Builder**.
2. Ouvrir ou créer un formulaire.
3. Ouvrir **Paramétrage du formulaire**.
4. Activer **Envoyer un mail**.
5. Renseigner :
   - destinataire fixe,
   - ou destinataire depuis un champ email du formulaire,
   - sujet,
   - message.

Variables disponibles :

```text
{formName}
{date_saisie}
{utilisateur}
{all_fields}
{champ:nom_du_champ}
```

Le template conseillé :

```text
Bonjour,

Une nouvelle saisie a été réalisée.

Formulaire : {formName}
Date : {date_saisie}
Utilisateur : {utilisateur}

Détails de la saisie :
{all_fields}

Cordialement,
PicoTrack
```

## Logo par défaut

Par défaut, l'API ajoute automatiquement :

```text
/logo-picotrack.png
```

à partir du domaine déployé.

Pour forcer un logo précis dans Vercel, ajouter une variable d'environnement :

```text
PICOTRACK_LOGO_URL=https://picotrack.fr/logo-picotrack.png
```

Optionnel :

```text
PICOTRACK_BRAND_NAME=PicoTrack Nexus
RESEND_FROM=PicoTrack <notifications@noreply.picotrack.fr>
```
