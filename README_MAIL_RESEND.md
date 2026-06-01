# PicoTrack — Envoi automatique de mails via Resend

## Variables Vercel requises

Dans Vercel > Project > Settings > Environment Variables :

```txt
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxx
```

Optionnel :

```txt
RESEND_FROM=PicoTrack <notifications@noreply.picotrack.fr>
```

Si `RESEND_FROM` n'est pas renseignée, l'API utilise :

```txt
PicoTrack <notifications@noreply.picotrack.fr>
```

## Fonctionnement

Le navigateur n'a jamais accès à la clé Resend.

```txt
PicoTrack Front
  -> /api/send-mail
  -> Resend
  -> destinataire
```

## Workflow service

Dans un workflow, ajouter une action :

```txt
Envoyer un email
```

Puis renseigner :

- destinataire(s)
- copie(s) optionnelles
- sujet
- corps du mail

Variables disponibles dans les mails de workflow :

```txt
{reference}
{ref}
{service}
{statut}
{assignation}
{created_by}
{date}
{champ:nom_du_champ}
```

## Formulaires

Le moteur de formulaire est prêt pour déclencher un mail si le formulaire possède :

```js
triggers: {
  sendMail: {
    enabled: true,
    event: 'create',
    to: 'client@mail.fr',
    subject: 'Confirmation PicoTrack',
    body: 'Bonjour, votre demande est enregistrée.'
  }
}
```

La configuration graphique de ces triggers pourra être ajoutée dans le builder ensuite.
