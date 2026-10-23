# Imprimantes : types de connexion

| Type | Où ça marche | Comment |
| --- | --- | --- |
| Système (défaut) | partout | fenêtre d'impression du navigateur, page au format de l'étiquette (ou fichier .zpl téléchargé) |
| Bluetooth | application PicoTrack PAD ≥ 1.0.3 (Android) | ZPL brut en RFCOMM SPP vers une imprimante **appairée** (adresse MAC) |
| TCP/IP | application PicoTrack PAD ≥ 1.0.3 (Android) | ZPL brut sur socket (port 9100 par défaut), adresses IPv4 privées uniquement |
| FTP | partout (envoi par le serveur) | `labels_print_ftp` dépose `picotrack-<horodatage>.zpl` dans le dossier distant |

Sur ordinateur, ou dans Chrome Android hors application, Bluetooth et TCP/IP ne sont pas joignables : l'écran le dit et la fenêtre d'impression système s'ouvre à la place.

## Pont Android

La page ouvre `intent://print#Intent;scheme=picotrack-print;package=<package TWA>;S.pt_conn=…;S.pt_addr=…;i.pt_port=…;S.pt_zpl=…;end`.
Le package est lu dans `document.referrer` (`android-app://<package>`) au lancement par la TWA et gardé dans `localStorage.pt_twa_pkg`.
Si l'application installée est trop ancienne, Chrome suit `browser_fallback_url` (`#pt-print-noapp`) et la page demande la mise à jour.

`PrintActivity` (mobile/android) n'accepte que du ZPL (`^XA … ^XZ`, 512 Ko max), une MAC appairée ou une IPv4 privée (10/8, 172.16/12, 192.168/16), et demande une confirmation au premier envoi vers chaque imprimante (mémorisée sur la tablette). Le pont ne fonctionne pas dans le repli WebView (sans Chrome).

## FTP côté serveur (`api/_printer-ftp.js`)

- Action `labels_print_ftp` : utilisateur connecté, actif, de l'environnement (même règle que la lecture des étiquettes). L'hôte, le port et les identifiants viennent de la ligne `printer_profiles` de l'environnement, jamais de la requête.
- Contenu : ZPL uniquement, 256 Ko max.
- SSRF : résolution DNS puis connexion à l'adresse résolue. Toujours refusés : boucle locale, 0.0.0.0/8, lien local (169.254/16, fe80::/10, dont les métadonnées cloud), CGNAT 100.64/10, multicast, plages réservées, `localhost`, `*.internal`. Réseaux privés (10/8, 172.16/12, 192.168/16, fc00::/7) refusés par défaut : un serveur hébergé ne voit pas le réseau du client. Autorisation explicite par environnement : `<CLIENT>_PRINTER_FTP_ALLOW_PRIVATE=1` (ou `PRINTER_FTP_ALLOW_PRIVATE=1` pour un hébergement dédié), à n'activer que si le serveur est dans le réseau du client.
- Ports : 21 ou 1024-65535. Mode passif (EPSV puis PASV) : l'IP annoncée par le serveur FTP est ignorée, le canal de données va à la même adresse que le contrôle (anti-rebond FTP).
- FTP en clair (pas de FTPS) : le mot de passe circule en clair entre le serveur et l'imprimante, comme avec tout client FTP d'imprimante.
- Mot de passe : chiffré AES-256-GCM (`v1:`), clé HKDF dérivée de `<CLIENT>_PRINTER_SECRET_KEY` / `PRINTER_SECRET_KEY` si présente, sinon de la clé service Supabase de l'hôte ; environnement en données associées. Jamais renvoyé : l'API ne renvoie que `ftp_password_set`. Si la clé change, l'envoi demande de ressaisir le mot de passe.

## Migration

`supabase/migrations/20261023120000_printer_connections.sql`, à appliquer à la main sur chaque base avant de déployer (sinon l'écran Imprimantes renvoie « migration non appliquée »).
