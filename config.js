/**
 * ROCHEBONNE — Configuration du widget "séjours alternatifs"
 * --------------------------------------------------------------
 * SEUL FICHIER À ÉDITER POUR FAIRE VIVRE LE SYSTÈME.
 * Pas de build, pas de compilation : on recharge la page et ça prend effet.
 *
 * Trois sections principales :
 *   1) properties     → la liste des hébergements + capacité + combinabilité
 *   2) stayRules      → les règles d'arrivée et de durée par période
 *   3) lodgify        → les sélecteurs CSS du site Lodgify (à ajuster après audit)
 *
 * Astuce : pour tester sans déployer, charge ce fichier dans la console du site
 * et appelle window.__rbDebug.diagnose({ checkIn: new Date('2026-07-14'), ... })
 */
(function () {
  window.ROCHEBONNE_CONFIG = {

    // =====================================================
    // 1. HÉBERGEMENTS
    // =====================================================
    // capacity = nombre de couchages
    // combinableWith = ids des hébergements physiquement combinables
    //   (mitoyens, même clé, etc.) — sert au moteur de combinaisons
    //
    // Données extraites de domainederochebonne.com + confirmées par Will (mai 2026).
    //
    // Règle confirmée : TOUS les hébergements du domaine sont à quelques mètres
    // les uns des autres → tous combinables entre eux. Le champ `combinableWith`
    // est donc remplacé par un onSite=true ; le moteur considère que toutes les
    // propriétés onSite sont combinables.
    //
    // ⚠️ EXCEPTION — La "Maison avec Piscine Privée" (id maison-piscine) :
    //   - située à 1 km du domaine, pas sur place
    //   - hébergement PARTENAIRE (commission, pas en propriété)
    //   - à NE PROPOSER QU'EN DERNIER RECOURS, jamais en avant
    //   - flag `partner: true` + `offSite: true` traité spécialement par le widget
    properties: [
      {
        id: 'chateau',
        name: 'Le Château',
        capacity: 20,
        bedrooms: 8,
        url: '/fr/chateau-8-chambres-avec-piscine-privee',
        features: ['piscine privée'],
        onSite: true,
      },
      {
        id: 'la-charrue',
        name: 'La Charrue',
        capacity: 10,
        bedrooms: 4,
        url: '/fr/la-charrue-maison-4-chambres',
        onSite: true,
      },
      {
        id: 'le-pressoir',
        name: 'Le Pressoir',
        capacity: 8,
        bedrooms: 3,
        url: '/fr/le-pressoir-3-bedroom-house',
        onSite: true,
      },
      {
        id: 'la-cave',
        name: 'La Cave',
        capacity: 6,
        bedrooms: 3,
        url: '/fr/la-cave-maison-de-3-chambres',
        onSite: true,
      },
      {
        id: 'le-chai',
        name: 'Le Chai',
        capacity: 4,
        bedrooms: 2,
        url: '/fr/maison-2-chambres-le-chai',
        onSite: true,
      },
      {
        id: 'le-four-a-pain',
        name: 'Le Four à Pain',
        capacity: 4,
        bedrooms: 2,
        url: '/fr/le-four-a-pain-gite-2-chambres',
        onSite: true,
      },
      {
        id: 'la-mangeoire',
        name: 'La Mangeoire',
        capacity: 4,
        bedrooms: 2,
        url: '/fr/la-mangeoire-2-bedroom-gite',
        onSite: true,
      },
      {
        id: 'la-chaumiere',
        name: 'La Chaumière',
        capacity: 3,
        bedrooms: 1,
        url: '/fr/la-chaumiere-gite-1-chambre',
        onSite: true,
      },
      {
        id: 'le-studio',
        name: 'Le Studio',
        capacity: 2,
        bedrooms: 1,
        url: '/fr/le-studio-hebergement-2-personnes',
        onSite: true,
      },
      // ── EXCEPTION : hébergement partenaire ─────────────────────────────────
      {
        id: 'maison-piscine',
        name: 'Maison avec Piscine Privée',
        capacity: 12,
        bedrooms: 4,
        url: '/fr/maison-de-4-chambres-avec-piscine-privee',
        features: ['piscine privée'],
        onSite: false,
        partner: true,                                  // hébergement partenaire (commission)
        note: 'À 1 km du domaine',                     // affiché dans la carte
      },
      // Note : Vertrouwen (Dutch barge) volontairement exclu — en Belgique.
    ],

    // =====================================================
    // 2. RÈGLES DE SÉJOUR PAR PÉRIODE
    // =====================================================
    // from / to : 'MM-DD' inclus. Si from > to, la règle traverse l'année (ex: 12-22 → 01-02).
    // allowedArrivalDays : 0=dim, 1=lun, ..., 6=sam
    // minNights : durée minimum exigée
    // strict : si true, la règle ne peut pas être assouplie (haute saison)
    // Les règles ci-dessous sont un FALLBACK utilisé tant que le proxy n'est pas
    // branché. Quand availabilityApi est configuré, le widget interroge Lodgify
    // (source de vérité, synchro PriceLabs) et ignore ces règles statiques.
    //
    // Logique "dernière minute" : si le séjour demandé est à moins de
    // `lastMinuteWindowDays` jours, les règles sont automatiquement relâchées
    // (min nights réduit, jours d'arrivée élargis à tous). Reflète ce que tu
    // fais en pratique sur Lodgify quand une fenêtre reste vide.
    stayRules: [
      {
        label: 'Haute saison',
        from: '07-01', to: '08-31',
        minNights: 7,
        allowedArrivalDays: [5, 6, 0],          // vendredi, samedi, dimanche
        strict: true,
        lastMinuteWindowDays: 21,               // < 21 j avant l'arrivée → assoupli
        lastMinute: { minNights: 4, allowedArrivalDays: [0,1,2,3,4,5,6] },
      },
      {
        label: 'Fêtes de fin d\'année',
        from: '12-22', to: '01-02',
        minNights: 5,
        allowedArrivalDays: [0, 1, 2, 3, 4, 5, 6],
        strict: true,
        lastMinuteWindowDays: 14,
        lastMinute: { minNights: 3, allowedArrivalDays: [0,1,2,3,4,5,6] },
      },
      {
        label: 'Ponts de mai',
        from: '04-25', to: '05-15',
        minNights: 4,                            // weekends fériés
        allowedArrivalDays: [0, 1, 2, 3, 4, 5, 6],
        strict: false,
        lastMinuteWindowDays: 10,
        lastMinute: { minNights: 2, allowedArrivalDays: [0,1,2,3,4,5,6] },
      },
      {
        label: 'Vacances de printemps',
        from: '04-01', to: '04-24',
        minNights: 3,
        allowedArrivalDays: [0, 1, 2, 3, 4, 5, 6],
        strict: false,
        lastMinuteWindowDays: 7,
        lastMinute: { minNights: 2, allowedArrivalDays: [0,1,2,3,4,5,6] },
      },
      {
        label: 'Vacances de Toussaint',
        from: '10-20', to: '11-05',
        minNights: 3,
        allowedArrivalDays: [0, 1, 2, 3, 4, 5, 6],
        strict: false,
        lastMinuteWindowDays: 7,
        lastMinute: { minNights: 2, allowedArrivalDays: [0,1,2,3,4,5,6] },
      },
      {
        label: 'Hors saison',
        from: '01-03', to: '12-21',              // fallback large
        minNights: 2,
        allowedArrivalDays: [0, 1, 2, 3, 4, 5, 6],
        strict: false,
        lastMinuteWindowDays: 7,
        lastMinute: { minNights: 2, allowedArrivalDays: [0,1,2,3,4,5,6] },
      },
    ],

    // =====================================================
    // 2.bis  COMBINAISONS PRÉ-VENDUES EN PRODUITS LODGIFY
    // =====================================================
    // Certaines combinaisons existent déjà comme "produits" dans Lodgify
    // (avec leur propre page, prix, calendrier). Quand le widget propose
    // cette combinaison exacte, il linke vers cette page → réservation
    // directe au lieu d'un échange WhatsApp.
    //
    // La clé `propertyIds` doit matcher exactement les ids du tableau properties
    // (l'ordre n'importe pas).
    knownCombinations: [
      {
        propertyIds: ['le-pressoir', 'la-cave'],
        name: 'Grand Gîte (Le Pressoir + La Cave)',
        capacity: 14,
        url: '/fr/grand-gite-14-pers---le-pressoir-la-cave',
        directBookable: true,
      },
      {
        propertyIds: [
          'chateau', 'maison-piscine', 'la-charrue', 'le-pressoir', 'la-cave',
          'le-chai', 'le-four-a-pain', 'la-mangeoire', 'la-chaumiere', 'le-studio',
        ],
        name: 'Domaine de Rochebonne entier',
        capacity: 68,
        url: '/fr/le-domaine-de-rochebonne-entier',
        directBookable: true,
      },
    ],

    // =====================================================
    // 3. CONTACT
    // =====================================================
    contact: {
      whatsapp: '+33766384644',
      email:    'info@domainederochebonne.com',
      phone:    '+33766384644',
    },

    // =====================================================
    // 4. SÉLECTEURS LODGIFY (à ajuster après audit DOM)
    // =====================================================
    // Le widget tente plusieurs sélecteurs séparés par virgule.
    // Pour auditer : ouvre une page de résultats vide sur le site,
    // Inspect → trouve le conteneur, copie son sélecteur ici.
    lodgify: {
      // Sélecteurs essayés dans l'ordre. Si tous échouent, le widget bascule
      // sur une détection structurelle (parent commun des liens vers les
      // fiches gîtes du domaine) → self-healing même si Lodgify renomme.
      resultsContainer: [
        '.css-1w2afhi',                         // conteneur identifié (mai 2026)
        '.css-1r8vw2f',                         // variante observée
        '[data-testid="search-results"]',
        '.lodgify-search-results',
      ].join(', '),

      emptyStateTexts: [
        'nous avons de la disponibilité',       // ⚠️ message manuel ajouté par Will dans Lodgify
        'no properties available',
        'aucun bien disponible',
        'aucune disponibilité',
        'no results',
        'no availability',
        'pas de disponibilité',
        'no matching properties',
      ],

      // Si true, masque le message manuel Lodgify quand notre panneau s'affiche
      // (sinon les deux apparaissent en double).
      hideExistingEmptyMessage: true,

      searchForm: 'form[action*="search"], .lodgify-search-form, [data-testid="search-form"]',

      // URL Lodgify de recherche (pour générer les liens "voir la dispo")
      searchBaseUrl: '/fr/nos-gites-de-vacances/',

      // Noms des paramètres URL utilisés par Lodgify (à confirmer après audit)
      // Lodgify Website Builder utilise `adults` plutôt que `guests`.
      urlParams: {
        checkIn:  ['startDate', 'arrival', 'checkIn', 'start'],
        checkOut: ['endDate',   'departure', 'checkOut', 'end'],
        guests:   ['adults', 'guests', 'people'],
      },
    },

    // =====================================================
    // 5. PROXY API (optionnel, v2)
    // =====================================================
    // Si tu déploies proxy.example.js, mets ici l'URL publique
    // (ex: 'https://api.domainederochebonne.com/availability').
    // Tant que c'est null, le widget tourne en mode "rules-only".
    availabilityApi: null,

    // =====================================================
    // 6. TRACKING (optionnel)
    // =====================================================
    tracking: {
      gaEventPrefix: 'rb_alt_',       // GA4 / gtag
      gtmEventPrefix: 'rb_alt_',      // dataLayer
    },
  };
})();
