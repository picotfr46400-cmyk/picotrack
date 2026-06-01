# PicoTrack — PDF professionnel final

Cette version remplace le PDF texte brut par un rendu PDF opérationnel plus propre :

- en-tête brandé PicoTrack Nexus ;
- bloc d'informations générales ;
- tableau structuré des champs saisis ;
- couleurs cohérentes avec l'interface ;
- pagination automatique ;
- pied de page avec référence ;
- compatibilité pièce jointe Resend.

Le PDF est généré côté navigateur sans dépendance externe, puis attaché automatiquement à l'email envoyé via `/api/send-mail.js`.

Fichier principal modifié :

```text
js/core/pdf.js
```
