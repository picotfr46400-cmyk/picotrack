# PicoTrack PAD — application Android

Application installable pour les techniciens terrain. Elle ouvre le PAD du client dans Chrome (Trusted Web Activity), pas une copie locale du site.

Le build par défaut vise **un seul hôte** : `https://efc.picotrack.fr/?mode=pad`.  
Une base Supabase = un hôte = un APK. Rien dans ce projet n’ajoute un second client.

## Pourquoi une Trusted Web Activity

Le PAD est le site déjà en production (`index.html`, `pad-mode` dans `assets/app.secured.js`). Sur téléphone il se détecte tout seul (`Android` dans le user-agent, ou `?mode=pad`).

| Besoin | Dans le site | Dans l’APK |
| --- | --- | --- |
| Photos | `<input type="file" accept="image/*" capture="environment">` | Chrome ouvre l’appareil photo |
| QR | `getUserMedia` + `BarcodeDetector` | Chrome (l’API n’est pas dans le WebView Android) |
| GPS | `navigator.geolocation` via `pad-device.js` | délégation de localisation Android |
| Session | `localStorage` clé `pt_pad` (jeton 7 jours) | stockage Chrome de cette origine, conservé après fermeture |

Un wrapper WebView (Capacitor) chargerait le même URL mais perdrait le scan QR : `BarcodeDetector` est disponible dans Chrome, pas dans le WebView système. La TWA réutilise Chrome, donc le comportement terrain reste celui du navigateur.

Tant que `/.well-known/assetlinks.json` n’est pas **déployé** sur l’hôte, Chrome affiche encore la barre d’adresse. L’application fonctionne quand même. Le plein écran sans barre arrive après le déploiement de ce fichier et une vérification Digital Asset Links (quelques minutes, parfois un réinstall).

## Petit changement web

- `.well-known/assetlinks.json` — package `fr.picotrack.efc.twa` + empreinte du certificat **debug** versionné. `build.js` copie déjà `.well-known` dans la sortie Vercel.
- `vercel.json` — `/.well-known/` n’est plus renvoyé vers `index.html`.
- `pad-device.js` — le bouton Localisation écrivait en dur `GPS: 45.0473° N, 4.7277° E`. Il appelle maintenant le GPS de l’appareil. Le reste du formulaire ne change pas.
- `index.html` charge ce script. Pas d’autre changement de navigation, d’API ou de tenant.

## Construire l’APK debug

Prérequis : JDK 21, Android SDK `platforms;android-36` et `build-tools;35.0.0`, variable `ANDROID_HOME`.

```bash
export ANDROID_HOME="$HOME/android-sdk"   # adapter
./mobile/build-apk.sh
```

APK :

```text
mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Le script refuse tout ce qui n’est pas une origine `https` nue. Défaut : EFC.

Autre client (un APK distinct, un autre `applicationId`) :

```bash
PAD_HOST=https://client.picotrack.fr ./mobile/build-apk.sh
```

Puis ajouter, **sur l’hôte de ce client uniquement**, une entrée `assetlinks.json` pour le package affiché dans le log (`…twa`) et l’empreinte du certificat. Ne pas réutiliser le fichier EFC pour pointer vers une autre base.

Certificat debug (public, sideload interne) :

- fichier : `mobile/android/app/debug.keystore`
- alias : `android`
- mots de passe store et clé : `android`
- SHA-256 : `AE:55:4F:10:82:EB:92:13:47:FC:52:9C:F6:86:47:E2:0E:48:D0:B2:21:81:B2:E9:AC:76:92:85:04:F8:1D:89`

Ce trousseau est dans le dépôt pour que l’APK debug et `assetlinks.json` restent alignés. Ce n’est pas une clé de production.

## CI

Workflow : `.github/workflows/pad-android-apk.yml`.

À chaque pull request qui touche le PAD Android, le workflow construit l’APK debug (hôte EFC, sauf lancement manuel) et le publie en artefact `picotrack-pad-debug`.

Lancement manuel : Actions → PAD Android APK → Run workflow, champ origine.

### APK release

Produite seulement si les quatre secrets sont définis dans le dépôt GitHub. Aucune clé release n’est créée ici.

| Secret | Contenu |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | keystore release encodé en base64 (`base64 -w0 release.keystore`) |
| `ANDROID_KEYSTORE_PASSWORD` | mot de passe du keystore |
| `ANDROID_KEY_ALIAS` | alias de la clé |
| `ANDROID_KEY_PASSWORD` | mot de passe de la clé |

Le log CI affiche le SHA-256 du certificat release. Il faut l’ajouter à `sha256_cert_fingerprints` (en plus de l’empreinte debug si les deux APK doivent ouvrir le site en plein écran) **avant** de distribuer la release. L’artefact s’appelle `picotrack-pad-release`.

## Installer sur un téléphone (sideload)

1. Récupérer `app-debug.apk` (build local ou artefact GitHub).
2. Le copier sur le téléphone (câble, mail interne, Drive).
3. Android : Paramètres → Sécurité (ou Applications) → autoriser les sources inconnues pour l’application qui ouvre le fichier (Fichiers ou Chrome).
4. Ouvrir l’APK et confirmer Installer. Le nom affiché est **PicoTrack EFC**, package `fr.picotrack.efc.twa`.
5. Chrome doit être installé et à jour. Edge ou Samsung Internet conviennent aussi s’ils gèrent les Custom Tabs. Le mode secours est un onglet Chrome, pas un WebView.
6. Ouvrir l’application. Au premier scan ou à la première photo, accepter la caméra pour `efc.picotrack.fr`. Au premier GPS, accepter la position pour l’application.

Désinstaller avant d’installer un APK d’un autre client : les packages diffèrent, les deux peuvent coexister, chacun sur son hôte.

## Permissions

| Permission Android | Usage |
| --- | --- |
| Internet, état du réseau | ouvrir le PAD |
| Localisation fine et approximative | bouton Localisation, déléguée au site quand la TWA est vérifiée |
| Caméra | photos formulaire et scan QR, demandée par Chrome pour l’origine |

Caméra et GPS sont optionnels au niveau matériel : un appareil sans GPS s’installe quand même, le bouton échoue avec un message.

## À tester sur un vrai téléphone, contre efc.picotrack.fr

1. L’écran de connexion PAD s’affiche (pas le bureau admin). Aucune autre origine dans la barre si elle est encore visible.
2. Connexion avec un identifiant PAD EFC. Fermer l’appli (et la relancer après un redémarrage) : la session `pt_pad` est encore là. Le jeton serveur expire au bout de 7 jours, il faudra alors se reconnecter.
3. Photo : un champ Photo ouvre l’appareil photo arrière et la pièce jointe reste dans la saisie.
4. Scanner : l’onglet Scanner démarre la caméra et lit un QR PicoTrack. Si `BarcodeDetector` manque, le repli « photo du QR » s’affiche — sur Chrome récent il ne doit pas apparaître.
5. Localisation : le bouton Capturer demande la position et enregistre `GPS: <lat>, <lng> (±m)`, pas `45.0473° N, 4.7277° E`. Refuser la permission ne doit rien enregistrer.
6. Après déploiement de `assetlinks.json`, réinstaller ou vider les données Chrome de l’appli : la barre d’adresse disparaît. Vérification possible avec [l’outil Digital Asset Links](https://developers.google.com/digital-asset-links/tools/generator) sur `efc.picotrack.fr` et le package `fr.picotrack.efc.twa`.

## Limites

- Publication Play Store, fiche store, politique de confidentialité et signature Play App Signing : hors périmètre.
- Pas de mise à jour automatique hors Play : redistribuer l’APK pour changer le wrapper. Le site, lui, se met à jour sans nouvel APK.
- Plein écran fiable seulement après déploiement des asset links. Avant ça, une barre d’adresse reste visible.
- Le scan QR dépend de Chrome (ou équivalent), pas d’un décodeur embarqué.
- Le certificat debug est public. Ne pas le considérer comme une frontière de sécurité. La clé release reste hors du dépôt.
- Vider le stockage de l’application (écran « Gérer l’espace ») déconnecte le terminal.
