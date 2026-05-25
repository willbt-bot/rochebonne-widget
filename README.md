# Widget "séjours alternatifs" — Domaine de Rochebonne

Surcouche front-end pour Lodgify qui détecte les "faux zéro disponibilité" et propose des alternatives intelligentes : dates voisines, durées ajustées, combinaisons de gîtes mitoyens pour les groupes.

## Ce que ça résout

| Scénario | Comportement Lodgify natif | Avec le widget |
|---|---|---|
| Mauvais jour d'arrivée (samedi-samedi en juillet) | "Aucune disponibilité" | Propose les 3-4 samedis les plus proches |
| Durée < min stay (3 nuits demandées en haute saison) | "Aucune disponibilité" | Propose la durée minimum sur les mêmes dates |
| Groupe trop grand pour un seul gîte (10-22 pers.) | "Aucune disponibilité" | Propose 2-3 combinaisons de gîtes mitoyens |
| Dates légèrement décalées | "Aucune disponibilité" | Propose ±1 à ±3 jours |

## Fichiers

```
rochebonne-widget/
├── config.js          ← À éditer : hébergements, règles, contact
├── widget.js          ← Moteur (ne pas modifier sauf besoin)
├── widget.css         ← Styles
├── proxy.example.js   ← Optionnel — proxy API Lodgify pour la v2
└── README.md
```

## Intégration Lodgify (5 minutes)

### Étape 1 — Héberger les fichiers

Trois options par ordre de simplicité :

**A. CDN GitHub (le plus simple)**
1. Push `config.js`, `widget.js`, `widget.css` sur un repo GitHub public
2. Utilise `https://cdn.jsdelivr.net/gh/USERNAME/REPO@main/widget.js` (jsDelivr met en cache)

**B. Sur ton hébergement Next.js / Vercel**
Mets les fichiers dans `/public/rochebonne/` → accessible à `https://ton-site.com/rochebonne/widget.js`

**C. Coller le code directement dans Lodgify**
Possible mais moins propre pour les mises à jour.

### Étape 2 — Coller dans Lodgify

Dans le back-office Lodgify : **Settings → Website → Edit HTML**.

**Dans le `<head>`** :
```html
<link rel="stylesheet" href="https://TON-CDN/widget.css">
```

**À la fin du `<body>` (Footer JS)** :
```html
<script src="https://TON-CDN/config.js"></script>
<script src="https://TON-CDN/widget.js" defer></script>
```

⚠️ L'ordre compte : `config.js` doit charger avant `widget.js`.

### Étape 3 — Vérifier

1. Ouvre le site, va sur la page de recherche
2. Fais une recherche qui va échouer (ex : 10 personnes du 14 au 17 juillet)
3. Ouvre la console (F12) → tu dois voir le panneau apparaître au-dessus de la zone "aucun résultat"
4. Si rien ne s'affiche : `window.__rbDebug.tick()` dans la console pour forcer

## Comment modifier les règles

Tout est dans `config.js`. Trois sections principales :

### 1. Hébergements
```js
properties: [
  { id: 'gite-chai', name: 'Le Chai', capacity: 6, combinableWith: ['chateau', 'gite-grange'] },
  // ...
]
```
`combinableWith` = ids des hébergements **physiquement combinables** (mitoyens, accessibles ensemble). C'est ce qui permet de proposer "Le Chai + La Grange" comme combinaison cohérente.

### 2. Règles de séjour
```js
stayRules: [
  { label: 'Haute saison', from: '07-01', to: '08-31', minNights: 7, allowedArrivalDays: [6], strict: true },
  // ...
]
```
- `allowedArrivalDays` : 0=dim, 1=lun, ..., 6=sam
- `strict: true` = règle non négociable (haute saison, fêtes)

### 3. Sélecteurs Lodgify
```js
lodgify: {
  resultsContainer: '...',
  emptyStateTexts: ['aucune disponibilité', ...],
}
```
À ajuster après audit du DOM réel (ouvre Inspect sur une page de résultats vide et copie le sélecteur du conteneur).

## Tester sans déployer

Dans la console du site une fois le widget chargé :

```js
// Simuler une recherche groupe 12 personnes en juillet
window.__rbDebug.simulate({
  checkIn: '2026-07-14',
  checkOut: '2026-07-17',
  guests: 12
});

// Voir le diagnostic
window.__rbDebug.diagnose({
  checkIn: new Date('2026-07-14'),
  checkOut: new Date('2026-07-17'),
  guests: 12
});
// → { reasons: ['WRONG_ARRIVAL_DAY','MIN_STAY_NOT_MET','NEEDS_COMBINATION'], ... }
```

## Cas de test à valider

| # | Recherche | Résultat attendu |
|---|---|---|
| 1 | Du mardi 14 au samedi 18 juillet, 4 pers. | Propose les samedis 11 et 18 juillet (7 nuits) |
| 2 | Du 14 au 17 juillet (3 nuits), 4 pers. | Propose 7 nuits à partir du 14 (ou décalage) |
| 3 | 12 personnes, n'importe quand | Propose 2-3 combinaisons de gîtes |
| 4 | 22 personnes, juillet | Propose triplets de gîtes + WhatsApp pré-rempli |
| 5 | Date au 24 décembre, 3 nuits | Détecte "Fêtes de fin d'année", min 5 nuits |
| 6 | Mobile, 375px | Layout vertical, boutons full-width |
| 7 | Page rechargée plusieurs fois | Pas de doublon de panneau |

## Tracking

Le widget pousse automatiquement des events :
- `rb_alt_shown` quand le panneau s'affiche
- `rb_alt_card-dates` quand un utilisateur clique une date alternative
- `rb_alt_card-combo` quand il clique une combinaison
- `rb_alt_whatsapp` / `rb_alt_email` pour les CTAs

Compatible **Google Analytics 4 (gtag)** et **GTM (dataLayer)**. Tu peux suivre le taux de conversion "panel vu → clic" dans GA4.

## Limites de la v1 (et ce qui les corrige)

| Limite | Impact | Correctif v2 |
|---|---|---|
| Les disponibilités proposées sont basées sur les règles, pas sur la vraie dispo Lodgify | Risque de proposer une date qui s'avère elle aussi prise | `proxy.example.js` — interroge la Public API Lodgify côté serveur |
| Les sélecteurs CSS Lodgify peuvent changer | Le widget pourrait ne plus détecter le "0 résultat" | MutationObserver + fallback heuristique sur le texte ; audit annuel |
| Pas de prix affichés dans les cartes alternatives | UX moins riche que les vrais résultats Lodgify | v2 avec l'endpoint `/v2/quote` |
| Les combinaisons sont basées sur `combinableWith` statique | Mise à jour manuelle si nouveau gîte | Acceptable pour 10 propriétés ; cron sync vers `config.js` possible |

## Désactiver

Retire les 3 lignes ajoutées dans le HTML Lodgify. Pas d'effet de bord (aucun cookie posé, aucune écriture localStorage).

## Évolutions recommandées

1. **Audit DOM réel** sur le site live → ajuster `cfg.lodgify.resultsContainer` (5 min)
2. **Récolter les vraies données** des 10 hébergements → remplir `cfg.properties` (15 min)
3. **A/B tester** le headline du panel sur 2-4 semaines via GA4
4. **Brancher le proxy** une fois 100+ panneaux affichés/semaine pour fiabiliser la dispo
5. **Pousser au-delà du widget** : ajouter une page `/groupes` pré-remplie pour la cible 8-15 (canal direct)

---

**Auteur** : Claude (avec brief de Will)
**Stack** : vanilla JS, zéro dépendance, ~12 Ko gzip
**Compat** : tous navigateurs modernes (ES2017+)
