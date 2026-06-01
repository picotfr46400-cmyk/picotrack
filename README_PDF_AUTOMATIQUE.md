# PicoTrack — PDF automatique

Cette version ajoute la génération PDF automatique après validation d’un formulaire.

## Fonctionnement

Dans le Form Builder, section automatisations :

- active **Envoyer un mail** ;
- coche **Joindre automatiquement le PDF de la saisie au mail** ;
- configure destinataire, objet et message.

À la validation du formulaire, PicoTrack :

1. enregistre la saisie ;
2. génère un PDF métier côté navigateur ;
3. envoie le mail via `/api/send-mail` ;
4. joint le PDF au mail via Resend ;
5. garde un historique local des mails/PDF envoyés.

## Variables Vercel

Obligatoire :

```text
RESEND_API_KEY
```

Optionnelles :

```text
RESEND_FROM=PicoTrack <notifications@noreply.picotrack.fr>
PICOTRACK_LOGO_URL=https://picotrack.fr/logo-picotrack.png
PICOTRACK_BRAND_NAME=PicoTrack Nexus
```

## Notes

Le logo est affiché dans le mail HTML. Le PDF joint est volontairement sobre et robuste pour éviter les dépendances externes.
