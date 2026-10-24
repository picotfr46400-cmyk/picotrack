# DESIGN.md — PicoTrack (brouillon v1, branche v2 @ 037d3fb ; audit ergonomie analyste @ f297706 intégré)

## 0. Doctrine
1. **Calme d'abord** : fonds clairs, une seule couleur d'action par écran, pas de dégradés décoratifs.
2. **Repères pâles par zone** : chaque zone fonctionnelle a une teinte de fond très pâle (`--zone-*-bg`) et un liseré (`--zone-*-edge`), jamais une couleur saturée en aplat.
3. **Zéro valeur en dur** : tout composant consomme des tokens sémantiques (`--color-*`, `--space-*`, `--radius-*`…). Un hex dans un composant = bug.
4. **Lisible et accessible** : WCAG AA (4.5:1 texte, 3:1 composants/focus), 14px mini sur PC, cibles 44px sur PAD.
5. **Cohérence** : un composant = une classe, mêmes états partout (repos, survol, focus, actif, désactivé, erreur).
6. **Originalité** : identité PicoTrack propre (bleu glacier + sarcelle, navy profond) ; on ne copie pas les maquettes concurrentes.
7. **Barres de défilement fines et arrondies**, discrètes, partout identiques.
8. **Repli progressif** : on montre l'essentiel, le reste se déplie à la demande (voir §0bis).

## 0bis. Repli progressif (doctrine)
Modèle de référence : `assets/ergo-shell.js` (`window.ptUi` : `accordion`, `summary`, `advanced`, `tip`, `wrapNodes`, `ptUi.Accordion` pour React ; styles `.pt-acc*` style.css:1165-1174).
1. **Fermé = une ligne de résumé.** Toute section repliée affiche un résumé `ptUi.summary` (« À la création · 2 destinataires · PDF joint »). Jamais un titre seul.
2. **Un seul ouvert à la fois** dans une liste d'objets de même nature (actions, effets, boutons de service).
3. **« Avancé » fermé par défaut** (`ptUi.advanced`) : tout réglage utilisé par moins de ~20 % des utilisateurs (CC, conditions, pièces jointes, visibilité par rôle, dimensions personnalisées…).
4. **Pas de liste exhaustive dépliée** : au-delà de 8 options, menu avec recherche (« Insérer un champ { } », « + Champ email »), jamais une rangée de pilules.
5. **N'ajouter que ce qui manque** : « + Ajouter une action » ne propose que les actions inactives.
6. **L'état ouvert est mémorisé** (`data-acc-key`) entre deux rendus.
7. **Accessibilité** : `<details>/<summary>` natifs (clavier et lecteurs d'écran gratuits), `summary:focus-visible` avec `--ring-focus`, cible ≥ 44px sur PAD, chevron `aria-hidden`.
8. **Un même concept = un même composant** : le composant « mail » est unique, partagé entre Form Builder et Services.

## 1. Architecture des tokens (3 niveaux)
- **Primitifs** (`--pt-blue-500`, `--pt-slate-100`…) : seule place où vivent les hex. Fichier `tokens.css`.
- **Sémantiques** (`--color-bg`, `--color-text`, `--color-action`, `--color-danger`…) : référencent les primitifs.
- **Composant** (`--btn-bg`, `--input-border`…) : optionnels, référencent les sémantiques.
- Les anciens alias (`--p`, `--pd`, `--pl`, `--s`, `--d`, `--w`, `--v`, `--bd`, `--bg`, `--tx`, `--tm`, `--tl`, `--navy`, `--steel`, `--shadow*`, `--radius`) restent temporairement mappés sur les nouveaux tokens, puis sont retirés.

## 2. Palette
### Primitifs (proposition)
| Token | Valeur | Usage |
|---|---|---|
| --pt-blue-50 / 100 / 500 / 600 / 700 | #EEF7FF / #DBEEFF / #1488FF / #086AD8 / #0756B0 | action |
| --pt-teal-50 / 500 / 700 | #E9FBF8 / #22C7B8 / #0F766E | succès |
| --pt-red-50 / 500 / 700 | #FFF1F1 / #EF4444 / #B91C1C | erreur |
| --pt-amber-50 / 500 / 700 | #FFFBEB / #F59E0B / #B45309 | alerte |
| --pt-violet-50 / 500 | #F5F3FF / #7C3AED | info secondaire |
| --pt-navy-900 / 800 | #08172D / #14294A | sidebar, titres |
| --pt-slate-0/50/100/200/300/500/600/900 | #FFF/#F5F8FC/#EEF2F7/#DCE6F2/#CBD5E1/#64748B/#475569/#0B1730 | neutres |

### Sémantiques
`--color-bg` (slate-50), `--color-surface` (#fff), `--color-surface-muted` (slate-100), `--color-border` (slate-200), `--color-border-strong` (slate-300), `--color-text` (slate-900), `--color-text-muted` (slate-600, ≥ 4.5:1), `--color-text-subtle` (slate-500, **réservé ≥ 14px gras ou texte non essentiel**), `--color-action` (blue-600), `--color-action-hover` (blue-700), `--color-action-soft` (blue-50), `--color-on-action` (#fff), `--color-success|danger|warning` (+ `-soft`, + `-text` en teinte 700 pour le texte), `--color-focus` (blue-500).

Règle : texte blanc uniquement sur teintes ≥ 600. Le cyan historique `#00C2FF` (2:1 sur blanc) ne porte jamais de texte.

## 3. Couleurs par zone
| Zone | --zone-X-bg | --zone-X-edge |
|---|---|---|
| Form Builder · paramétrage du formulaire | blue-50 | blue-100 |
| Form Builder · bibliothèque de blocs | teal-50 | teal-100 |
| Form Builder · paramètres du champ | violet-50 | violet-100 |
| Form Builder · canevas | slate-50 | slate-200 |
| Workflow / supervision | violet-50 | #E4DDFB |
| Étiquettes / impression | amber-50 | #FDECC8 |
| Données / tableaux | surface | slate-200 |
Le fond de zone ne dépasse jamais 4 % de saturation perçue ; le liseré marque la limite (bordure 1px ou barre gauche 3px pour l'en-tête de zone).

## 4. Typographie
- Famille : `--font-sans: 'DM Sans', system-ui, -apple-system, "Segoe UI", sans-serif` (supprimer Plus Jakarta non chargée si inutilisée).
- Échelle (PC) : `--text-xs 12px` (métadonnées, badges uniquement), `--text-sm 14px` (**minimum du texte courant**), `--text-md 15px`, `--text-lg 18px`, `--text-xl 22px`, `--text-2xl 28px`, `--text-3xl 34px`.
- Graisses : 400 / 600 / 800. Interlignage : 1.45 texte, 1.2 titres.
- Interdits : tailles décimales (12.5px, 10.5px…), < 12px.

## 5. Espacements (grille 4/8)
`--space-1 4px`, `--space-2 8px`, `--space-3 12px`, `--space-4 16px`, `--space-5 20px`, `--space-6 24px`, `--space-8 32px`, `--space-10 40px`, `--space-12 48px`. Aucune valeur impaire (15px, 22px, 9px…).

## 6. Rayons
`--radius-sm 8px` (inputs, petits boutons), `--radius-md 12px` (boutons, cartes compactes), `--radius-lg 16px` (cartes, panneaux), `--radius-xl 24px` (modales), `--radius-pill 999px`, `--radius-round 50%`. Supprimer 9/10/14/18/20px.

## 7. Ombres
`--shadow-0 none`, `--shadow-1 0 1px 2px rgba(11,23,48,.06)` (cartes au repos), `--shadow-2 0 8px 24px rgba(11,23,48,.08)` (menus, survol carte), `--shadow-3 0 18px 48px rgba(11,23,48,.12)` (modales). `--ring-focus 0 0 0 3px color-mix(in srgb,var(--color-focus) 35%, transparent)`. Calme : jamais d'ombre colorée.

## 8. Composants et états
Tous les composants interactifs définissent : `:hover` (fond `-soft` ou teinte +100), `:focus-visible` (`box-shadow: var(--ring-focus)`, **jamais `outline:none` sans remplacement**), `:active`, `[disabled]` (opacité .5 + `cursor:not-allowed`), `[aria-invalid=true]` (bordure `--color-danger`, message `--color-danger-text` 14px + icône, pas la couleur seule).
- Bouton : primaire / secondaire / fantôme / danger ; hauteur 36px PC, 44px PAD.
- Input/select : hauteur 36px PC, 44px PAD, bordure `--color-border`, focus `--color-action` + ring.
- Badge / chip : `--text-xs` 600, pill, fond `-soft` + texte `-text`.
- Carte : surface, bordure 1px, `--radius-lg`, `--shadow-1`.
- **Accordéon `.pt-acc`** (ergo-shell) : titre `--text-sm` 700, résumé `--text-sm` `--color-text-muted` (remplace `--ts`, non défini), padding `--space-3 --space-4`, `--radius-md`, focus visible sur `summary`.
- **Composant Mail (unique, Form Builder + Services)** : champ « À » à puces acceptant adresses et champs (menu « + Champ email » filtré sur les champs de type email) ; « Objet » et « Message » partagent un seul bouton « Insérer un champ { } » (menu avec recherche, insertion au curseur du dernier champ actif) ; CC, condition, « Joindre le PDF » et note logo dans « Avancé » ; fermé = résumé d'une ligne.
- **Actions après validation** : liste de cartes repliées (résumé + interrupteur), une seule ouverte, bouton « + Ajouter une action » ne listant que les inactives (motif `enhanceSvcActions`, ergo-shell.js:158).
- **Propriétés de champ** : onglets à libellé (Général / Transformateurs / Validateurs / Conditions), compteur seulement si > 0 ; Général = Libellé, Obligatoire, Aide ; le reste en « Avancé ». Libellés `--text-sm`, titres de section `--text-sm` 700 sans majuscules (fin des 9–10,5px : style.css:505, 521, 523, onglets `Adv`).
- Pas de styles inline en JS : le JS pose des classes/attributs, le CSS décide.

## 9. Barre de défilement (globale, version retenue)
Base : proposition de l'analyste (trait fin ~4px, piste transparente, variables). Améliorations : visible **au repos** en très pâle (sinon introuvable au tactile PAD, sans survol, et au clavier), renforcée au survol **et** au focus clavier (`:focus-within`), Firefox couvert par `scrollbar-width/scrollbar-color`, PAD toujours visible et plus large, `prefers-contrast` respecté. Aucune règle locale (supprimer style.css:389-390, 515-516, pad.css:216-221).
```css
:root{
  --scrollbar-size:8px;                 /* trait visible ≈ 4px (bordure 2px transparente) */
  --scrollbar-thumb:var(--color-border-strong);   /* repos : pâle mais présent (slate-300) */
  --scrollbar-thumb-active:var(--pt-slate-500);    /* survol zone / focus clavier */
  --scrollbar-thumb-grab:var(--color-action);     /* saisie */
}
/* Firefox */
*{scrollbar-width:thin;scrollbar-color:var(--scrollbar-thumb) transparent}
*:hover,*:focus-within{scrollbar-color:var(--scrollbar-thumb-active) transparent}
/* Chromium / WebKit */
::-webkit-scrollbar{width:var(--scrollbar-size);height:var(--scrollbar-size)}
::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}
::-webkit-scrollbar-thumb{background-color:var(--scrollbar-thumb);border-radius:var(--radius-pill);border:2px solid transparent;background-clip:padding-box}
*:hover::-webkit-scrollbar-thumb,*:focus-within::-webkit-scrollbar-thumb{background-color:var(--scrollbar-thumb-active)}
::-webkit-scrollbar-thumb:active{background-color:var(--scrollbar-thumb-grab)}
/* PAD : pas de survol → toujours visible, plus large */
body.pad-mode{--scrollbar-size:10px;--scrollbar-thumb:var(--pt-slate-400)}
@media (hover:none){:root{--scrollbar-thumb:var(--pt-slate-400)}}
@media (prefers-contrast:more){:root{--scrollbar-thumb:var(--color-text-muted)}}
```
Pas de barre invisible au repos (option « transparent » de l'analyste écartée) : une zone qui défile doit se voir.
Note : quand Chromium applique `scrollbar-color` (≥ 121), il ignore `::-webkit-scrollbar` ; les deux rendus sont donc à vérifier (Chrome, Firefox, WebView Android du PAD).

## 10. Règles PAD (tablette, `body.pad-mode`)
- Cibles tactiles ≥ 44×44px (`--touch-min: 44px`), espacement ≥ 8px entre cibles.
- Texte courant 16px ; aucun texte < 12px (corriger pad.css:41, 9px !important) (évite le zoom iOS sur les inputs).
- Pas d'effet porté uniquement par `:hover` ; état actif visible.
- Barre de navigation basse : tokens (`--color-nav-bg` = navy-900, actif = action-soft sur navy), hauteur 72px + safe-area.
- PAD surcharge **des tokens**, pas des composants : `body.pad-mode{--control-h:44px;--text-sm:16px;--scrollbar-size:10px}` → disparition progressive des `!important`.

## 11. Contrôle
- Lint (stylelint `color-no-hex` hors `tokens.css`, `declaration-property-value-allowed-list` pour font-size/radius).
- Contraste vérifié pour chaque paire sémantique texte/fond.

## Annexe — Plan de PR (vers v2, aucune ouverte)
1. **Tokens + barre de défilement + zones Form Builder** : `tokens.css`, fusion des deux `:root` (style.css:6-36 / 978-995) avec alias, définition de `--ts` (→ `--color-text-muted`), barre globale §9, fonds de zone pâles du Form Builder (demande de Clement), focus visible sur `.pt-acc>summary`. Après fusion de #73.
2. **Repli progressif du Form Builder** : actions après validation en cartes repliées + résumé, composant Mail unique (Form Builder puis Services `renderMailEffectHtml`), via `ptUi` d'ergo-shell.
3. **Propriétés de champ + typographie** : onglets libellés, « Avancé », plus de 9–10,5px (style.css:393, 447, 464, 505, 521, 523, 1007 ; pad.css:41), échelle 14px PC.
4. **Focus, contraste, états** : `:focus-visible` à la place des `outline:none`, `--tl` ≥ 4,5:1, états erreur/désactivé.
5. **Grille, rayons, ombres, PAD par tokens** : retrait des `!important` de pad.css, cibles 44px, extraction des styles inline les plus fréquents d'app.secured.js, stylelint.
