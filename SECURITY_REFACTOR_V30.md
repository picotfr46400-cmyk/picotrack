# PicoTrack V30 — licences invisibles côté client

Correction appliquée depuis la V29.

- Le menu Administration > Licences est supprimé du DOM pour tout compte non plateforme/GLOBAL.
- `goLicensing()` refuse l’accès client et redirige vers Utilisateurs/Dashboard sans appel API licences.
- `renderLicensingPanel()` ne lance plus de lecture/sauvegarde licences si le compte n’est pas plateforme.
- Objectif : aucun écran licences visible côté client, même pour une licence supervision.

Tests attendus :
1. Compte client supervision : menu Licences absent.
2. Compte client PAD : menu Licences absent.
3. Compte plateforme/GLOBAL : menu Licences visible et gestion quotas possible.
