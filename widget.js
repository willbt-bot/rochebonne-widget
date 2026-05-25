/**
 * ROCHEBONNE — Widget "séjours alternatifs"
 * --------------------------------------------------------------
 * Moteur de détection et de suggestion. Ne pas modifier sauf besoin
 * spécifique : toute la configuration métier est dans config.js.
 *
 * Stratégie en deux temps :
 *   - PROACTIF  : intercepte la soumission du formulaire Lodgify,
 *                 diagnostique localement, et si on prédit un faux
 *                 zéro on affiche le panneau d'alternatives.
 *   - RÉACTIF   : MutationObserver sur le conteneur de résultats,
 *                 si zéro résultat est détecté → panneau.
 *
 * Debug : window.__rbDebug.{ buildSuggestions, diagnose, ruleFor, cfg }
 */
(function () {
  'use strict';

  const cfg = window.ROCHEBONNE_CONFIG;
  if (!cfg) {
    console.warn('[Rochebonne] window.ROCHEBONNE_CONFIG manquant — widget désactivé.');
    return;
  }

  // ==================================================================
  // UTILS DATES
  // ==================================================================
  const MS_DAY = 86400000;
  const toDate = (v) => {
    if (v instanceof Date) return v;
    const d = new Date(v);
    d.setHours(12, 0, 0, 0);
    return isNaN(d) ? null : d;
  };
  const isoDay = (d) => d.toISOString().slice(0, 10);
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const nightsBetween = (a, b) => Math.round((b - a) / MS_DAY);
  const mmdd = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fmtDate = (d) => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  // ==================================================================
  // MOTEUR DE RÈGLES
  // ==================================================================
  function ruleFor(date) {
    const m = mmdd(date);
    for (const r of cfg.stayRules) {
      const inRange = r.from <= r.to
        ? (m >= r.from && m <= r.to)
        : (m >= r.from || m <= r.to);          // règle traversant l'année
      if (inRange) return r;
    }
    return cfg.stayRules[cfg.stayRules.length - 1]; // fallback
  }

  /**
   * Si l'arrivée est proche, on assouplit la règle (mirroir de ce que fait Will
   * sur Lodgify en pratique : durée min réduite, jours d'arrivée élargis).
   */
  function effectiveRule(rule, checkIn) {
    if (!rule.lastMinute) return rule;
    const daysToArrival = Math.round((checkIn - new Date()) / MS_DAY);
    const window = rule.lastMinuteWindowDays ?? 0;
    if (daysToArrival <= window) {
      return {
        ...rule,
        ...rule.lastMinute,
        label: rule.label + ' (dernière minute)',
        _relaxed: true,
      };
    }
    return rule;
  }

  function diagnose(query) {
    const { checkIn, checkOut, guests } = query;
    const baseRule = ruleFor(checkIn);
    const rule = effectiveRule(baseRule, checkIn);
    const reasons = [];

    if (!rule.allowedArrivalDays.includes(checkIn.getDay())) {
      reasons.push('WRONG_ARRIVAL_DAY');
    }
    if (nightsBetween(checkIn, checkOut) < rule.minNights) {
      reasons.push('MIN_STAY_NOT_MET');
    }
    const maxSingleCapacity = Math.max(...cfg.properties.map((p) => p.capacity));
    if (guests > maxSingleCapacity) {
      reasons.push('NEEDS_COMBINATION');
    }
    return { reasons, rule, baseRule, maxSingleCapacity };
  }

  // ==================================================================
  // GÉNÉRATION DE SUGGESTIONS
  // ==================================================================
  function suggestArrivalShifts(query, rule) {
    const out = [];
    const targetNights = Math.max(nightsBetween(query.checkIn, query.checkOut), rule.minNights);
    const range = rule.strict ? 14 : 7;       // haute saison : on cherche plus loin
    for (let delta = -range; delta <= range; delta++) {
      const candidateIn = addDays(query.checkIn, delta);
      if (rule.allowedArrivalDays.includes(candidateIn.getDay())) {
        out.push({
          type: 'shifted-dates',
          checkIn: candidateIn,
          checkOut: addDays(candidateIn, targetNights),
          deltaDays: delta,
        });
      }
    }
    // tri par |delta| croissant + dédup
    return out
      .sort((a, b) => Math.abs(a.deltaDays) - Math.abs(b.deltaDays))
      .slice(0, 4);
  }

  function suggestExtendedDuration(query, rule) {
    return [{
      type: 'extended-duration',
      checkIn: query.checkIn,
      checkOut: addDays(query.checkIn, rule.minNights),
      nights: rule.minNights,
      ruleLabel: rule.label,
    }];
  }

  /**
   * Suggère des combinaisons d'hébergements pour le groupe.
   *
   * Règles métier confirmées par Will :
   *  - tous les hébergements onSite=true sont combinables entre eux
   *  - maison-piscine (partner: true) = dernier recours uniquement
   *  - varier les combinaisons : ne pas toujours montrer "Château + 1 gîte"
   *
   * Algorithme :
   *  1. Génère toutes les paires + triplets (+ quadruplets si gros groupe)
   *  2. Filtre par capacité (cap >= besoin, sans surcapacité absurde)
   *  3. Classe en 3 tiers :
   *       Tier 1 = combinaisons SANS Château ni partenaire (priorité)
   *       Tier 2 = combinaisons AVEC Château (souvent rare en haute saison)
   *       Tier 3 = combinaisons AVEC partenaire (dernier recours, max 1)
   *  4. Dans chaque tier, tri par fitDelta (capacité au plus juste)
   *  5. Diversifie : prend 1-2 du tier 1, puis 1 du tier 2, puis 0-1 du tier 3
   */
  function suggestCombinations(query) {
    const need = query.guests;
    const onSite = cfg.properties.filter((p) => p.onSite);
    const partners = cfg.properties.filter((p) => p.partner);

    // pool des combinaisons "normales" : onSite uniquement
    const eligibleNormal = onSite;
    // pool dernier recours : onSite + partner pour combler si capacité manque
    const eligibleWithPartner = [...onSite, ...partners];

    function generate(pool, maxSize) {
      const out = [];
      const n = pool.length;
      // paires
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const set = [pool[i], pool[j]];
          const cap = set.reduce((s, p) => s + p.capacity, 0);
          if (cap >= need && cap <= need + 6) out.push(set);
        }
      }
      // triplets
      if (maxSize >= 3) {
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            for (let k = j + 1; k < n; k++) {
              const set = [pool[i], pool[j], pool[k]];
              const cap = set.reduce((s, p) => s + p.capacity, 0);
              if (cap >= need && cap <= need + 8) out.push(set);
            }
          }
        }
      }
      // quadruplets (gros groupes 25+)
      if (maxSize >= 4 && need >= 25) {
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            for (let k = j + 1; k < n; k++) {
              for (let l = k + 1; l < n; l++) {
                const set = [pool[i], pool[j], pool[k], pool[l]];
                const cap = set.reduce((s, p) => s + p.capacity, 0);
                if (cap >= need && cap <= need + 10) out.push(set);
              }
            }
          }
        }
      }
      return out;
    }

    const wrap = (sets, tier) =>
      sets.map((set) => ({
        type: 'combination',
        properties: set,
        capacity: set.reduce((s, p) => s + p.capacity, 0),
        fitDelta: set.reduce((s, p) => s + p.capacity, 0) - need,
        hasPartner: set.some((p) => p.partner),
        hasChateau: set.some((p) => p.id === 'chateau'),
        tier,
      }));

    const allNormal = wrap(generate(eligibleNormal, need < 25 ? 3 : 4), 0)
      .filter((c) => !c.hasPartner);

    // Tier 1 : sans Château, sans partenaire (varie les solutions)
    const tier1 = allNormal.filter((c) => !c.hasChateau).sort((a, b) => a.fitDelta - b.fitDelta);
    // Tier 2 : avec Château, sans partenaire
    const tier2 = allNormal.filter((c) =>  c.hasChateau).sort((a, b) => a.fitDelta - b.fitDelta);
    // Tier 3 : combinaisons impliquant maison-piscine (dernier recours)
    const tier3 = wrap(generate(eligibleWithPartner, 3), 2)
      .filter((c) => c.hasPartner)
      .sort((a, b) => a.fitDelta - b.fitDelta);

    // Sélection diversifiée
    const picked = [];
    if (tier1.length) picked.push(tier1[0]);
    if (tier1.length > 1) picked.push(tier1[1]);     // 2e option sans Château
    if (tier2.length)   picked.push(tier2[0]);       // 1 option avec Château
    if (picked.length < 3 && tier3.length) picked.push(tier3[0]);  // dernier recours

    return picked.slice(0, 3);
  }

  function buildSuggestions(query) {
    const diag = diagnose(query);
    const { reasons, rule } = diag;
    const suggestions = [];

    if (reasons.includes('WRONG_ARRIVAL_DAY')) {
      suggestions.push(...suggestArrivalShifts(query, rule));
    }
    if (reasons.includes('MIN_STAY_NOT_MET')) {
      suggestions.push(...suggestExtendedDuration(query, rule));
    }
    if (reasons.includes('NEEDS_COMBINATION')) {
      suggestions.push(...suggestCombinations(query));
    }
    // Cible business : groupes 8-15 personnes. Même si un gîte unique pourrait
    // théoriquement les accueillir, on propose AUSSI des combinaisons : en haute
    // saison le château est rarement libre, et les combinaisons sont souvent
    // l'option réelle.
    if (query.guests >= 8 && query.guests <= 15 && !reasons.includes('NEEDS_COMBINATION')) {
      suggestions.push(...suggestCombinations(query));
    }
    // si aucune raison spécifique détectée (= "vraie" indisponibilité),
    // on propose quand même un décalage de dates par défaut.
    if (suggestions.length === 0) {
      suggestions.push(...suggestArrivalShifts(query, rule));
    }

    return { ...diag, suggestions };
  }

  // ==================================================================
  // DÉTECTION LODGIFY (DOM + URL)
  // ==================================================================
  function findResultsContainer() {
    for (const sel of cfg.lodgify.resultsContainer.split(',').map((s) => s.trim())) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function isEmptyState(container) {
    if (!container) return false;
    const txt = (container.innerText || '').toLowerCase();
    const matchedText = cfg.lodgify.emptyStateTexts.some((t) => txt.includes(t.toLowerCase()));
    if (matchedText) return true;
    // heuristique de secours : conteneur quasi vide
    const cards = container.querySelectorAll('[class*="property"], [class*="result-card"], .property-card, [data-testid*="property"]');
    return cards.length === 0 && (container.children?.length ?? 0) < 3;
  }

  function extractQueryFromUrl() {
    const p = new URLSearchParams(location.search);
    const candidates = cfg.lodgify.urlParams || {
      checkIn:  ['checkIn', 'arrival', 'startDate', 'start'],
      checkOut: ['checkOut', 'departure', 'endDate', 'end'],
      guests:   ['adults', 'guests', 'people'],
    };
    const pick = (keys) => {
      for (const k of keys) { const v = p.get(k); if (v) return v; }
      return null;
    };
    const ci = pick(candidates.checkIn);
    const co = pick(candidates.checkOut);
    const adults   = parseInt(pick(candidates.guests) || '0', 10);
    const children = parseInt(p.get('children') || '0', 10);
    const infants  = parseInt(p.get('infants')  || '0', 10);
    const guests = adults + children + infants;        // Lodgify split
    if (!ci || !co || !guests) return null;
    const dCi = toDate(ci), dCo = toDate(co);
    if (!dCi || !dCo) return null;
    return { checkIn: dCi, checkOut: dCo, guests };
  }

  function extractQueryFromForm() {
    const form = document.querySelector(cfg.lodgify.searchForm);
    if (!form) return null;
    const get = (sels) => {
      for (const s of sels) {
        const el = form.querySelector(s);
        if (el?.value) return el.value;
      }
      return null;
    };
    const ci = get(['input[name*="checkIn" i]', 'input[name*="arrival" i]', 'input[name*="startDate" i]', '[data-input="checkIn"]']);
    const co = get(['input[name*="checkOut" i]', 'input[name*="departure" i]', 'input[name*="endDate" i]', '[data-input="checkOut"]']);
    const g  = get(['input[name*="guest" i]', 'input[name*="people" i]', 'select[name*="guest" i]', '[data-input="guests"]']);
    if (!ci || !co || !g) return null;
    const dCi = toDate(ci), dCo = toDate(co);
    if (!dCi || !dCo) return null;
    return { checkIn: dCi, checkOut: dCo, guests: parseInt(g, 10) };
  }

  function extractQuery() {
    return extractQueryFromUrl() || extractQueryFromForm();
  }

  // ==================================================================
  // GÉNÉRATION D'URLS LODGIFY
  // ==================================================================
  function buildBookingUrl(checkIn, checkOut, guests, propertyUrl) {
    try {
      const base = new URL(propertyUrl || cfg.lodgify.searchBaseUrl, location.origin);
      // Utilise les noms de params Lodgify (premier de chaque liste comme valeur de sortie)
      const params = cfg.lodgify.urlParams || {};
      const inKey  = (params.checkIn  || ['checkIn'])[0];
      const outKey = (params.checkOut || ['checkOut'])[0];
      const guestKey = (params.guests || ['adults'])[0];
      base.searchParams.set(inKey,  isoDay(checkIn));
      base.searchParams.set(outKey, isoDay(checkOut));
      base.searchParams.set(guestKey, guests);
      base.searchParams.set('children', '0');
      base.searchParams.set('infants',  '0');
      base.searchParams.set('pets',     '0');
      return base.toString();
    } catch (e) {
      return cfg.lodgify.searchBaseUrl;
    }
  }

  /**
   * Trouve si une combinaison correspond à un produit Lodgify pré-existant.
   * Si oui → on linke vers cette page (réservation directe).
   */
  function matchKnownCombination(propertyIds) {
    if (!cfg.knownCombinations) return null;
    const setA = new Set(propertyIds);
    return cfg.knownCombinations.find((c) => {
      if (c.propertyIds.length !== setA.size) return false;
      return c.propertyIds.every((id) => setA.has(id));
    });
  }

  function buildComboUrl(suggestion, query) {
    const ids = suggestion.properties.map((p) => p.id);
    const known = matchKnownCombination(ids);
    if (known?.directBookable) {
      return {
        type: 'direct',
        href: buildBookingUrl(query.checkIn, query.checkOut, query.guests, known.url),
        label: 'Réserver directement →',
        knownName: known.name,
      };
    }
    // fallback : WhatsApp pré-rempli
    const wa = (cfg.contact.whatsapp || '').replace(/\D/g, '');
    if (wa) {
      const names = suggestion.properties.map((p) => p.name).join(' + ');
      const msg = encodeURIComponent(
        `Bonjour, nous sommes ${query.guests} personnes et souhaiterions réserver ${names} ` +
        `du ${fmtDate(query.checkIn)} au ${fmtDate(query.checkOut)}. Est-ce possible ?`
      );
      return {
        type: 'whatsapp',
        href: `https://wa.me/${wa}?text=${msg}`,
        label: 'Vérifier la disponibilité sur WhatsApp →',
      };
    }
    return {
      type: 'email',
      href: 'mailto:' + cfg.contact.email,
      label: 'Nous contacter →',
    };
  }

  // ==================================================================
  // RENDU
  // ==================================================================
  function pickHeadline(reasons, query, rule) {
    if (reasons.includes('NEEDS_COMBINATION')) {
      return {
        title: `Nous avons des solutions pour votre groupe de ${query.guests}`,
        subtitle: `Plusieurs de nos hébergements sont mitoyens et peuvent être réservés ensemble pour accueillir tout votre groupe dans un cadre unique.`,
      };
    }
    if (reasons.includes('WRONG_ARRIVAL_DAY') && reasons.includes('MIN_STAY_NOT_MET')) {
      return {
        title: 'Vos dates ne correspondent pas aux conditions de séjour',
        subtitle: `En ${rule.label.toLowerCase()}, les séjours sont organisés différemment. Voici les options proches disponibles.`,
      };
    }
    if (reasons.includes('WRONG_ARRIVAL_DAY')) {
      return {
        title: 'Petit décalage à prévoir pour ces dates',
        subtitle: `En ${rule.label.toLowerCase()}, l'arrivée se fait sur des jours précis. Voici des dates très proches qui marchent.`,
      };
    }
    if (reasons.includes('MIN_STAY_NOT_MET')) {
      return {
        title: `${rule.minNights} nuits minimum sur cette période`,
        subtitle: `En ${rule.label.toLowerCase()}, nos séjours sont d'au moins ${rule.minNights} nuits. Voici une option qui démarre à vos dates.`,
      };
    }
    return {
      title: 'Pas de disponibilité exacte, mais des alternatives proches',
      subtitle: 'Voici quelques options à proximité de vos critères.',
    };
  }

  function renderCard(s, query) {
    if (s.type === 'shifted-dates' || s.type === 'extended-duration') {
      const n = nightsBetween(s.checkIn, s.checkOut);
      const link = buildBookingUrl(s.checkIn, s.checkOut, query.guests);
      let tag;
      if (s.type === 'extended-duration') {
        tag = `Séjour de ${n} nuits`;
      } else if (s.deltaDays === 0) {
        tag = 'Mêmes dates ajustées';
      } else if (s.deltaDays > 0) {
        tag = `+${s.deltaDays} jour${s.deltaDays > 1 ? 's' : ''}`;
      } else {
        tag = `${s.deltaDays} jour${s.deltaDays < -1 ? 's' : ''}`;
      }
      return `
        <a class="rb-alt__card" href="${link}" data-track="card-dates">
          <span class="rb-alt__card-tag">${tag}</span>
          <div class="rb-alt__card-dates">
            <strong>${fmtDate(s.checkIn)}</strong>
            <span class="rb-alt__card-sep">→</span>
            <strong>${fmtDate(s.checkOut)}</strong>
          </div>
          <div class="rb-alt__card-meta">${n} nuit${n > 1 ? 's' : ''} · ${query.guests} personne${query.guests > 1 ? 's' : ''}</div>
          <span class="rb-alt__card-cta">Voir la disponibilité →</span>
        </a>`;
    }
    if (s.type === 'combination') {
      const cta = buildComboUrl(s, query);
      const detailLines = s.properties
        .map((p) => {
          const noteHTML = p.note ? `<span class="rb-alt__combo-note">${p.note}</span>` : '';
          return `<li>
            <span class="rb-alt__combo-name">${p.name}${noteHTML}</span>
            <span class="rb-alt__combo-cap">${p.capacity} pers.</span>
          </li>`;
        })
        .join('');
      const tagText = cta.type === 'direct'
        ? `${cta.knownName} · ${s.capacity} pers.`
        : `Ensemble · ${s.capacity} pers.`;
      let meta;
      if (cta.type === 'direct') {
        meta = 'Produit existant, réservation immédiate';
      } else if (s.hasPartner) {
        meta = 'Comprend un hébergement partenaire à proximité';
      } else {
        meta = 'Tous nos hébergements sont à quelques mètres l\'un de l\'autre';
      }
      const targetAttr = cta.type === 'whatsapp' ? ' target="_blank" rel="noopener"' : '';
      const partnerClass = s.hasPartner ? ' rb-alt__card--partner' : '';
      return `
        <a class="rb-alt__card rb-alt__card--combo${partnerClass}" href="${cta.href}"${targetAttr} data-track="card-combo-${cta.type}" data-combo="${s.properties.map((p) => p.id).join(',')}">
          <span class="rb-alt__card-tag">${tagText}</span>
          <ul class="rb-alt__combo-list">${detailLines}</ul>
          <div class="rb-alt__card-meta">${meta}</div>
          <span class="rb-alt__card-cta">${cta.label}</span>
        </a>`;
    }
    return '';
  }

  function render(state, query) {
    const container = findResultsContainer();
    if (!container) return;

    const existing = document.getElementById('rb-alt-panel');
    if (existing) existing.remove();

    const { reasons, rule, suggestions } = state;
    const headline = pickHeadline(reasons, query, rule);
    const cards = suggestions.map((s) => renderCard(s, query)).join('');
    const wa = (cfg.contact.whatsapp || '').replace(/\D/g, '');

    const panel = document.createElement('div');
    panel.id = 'rb-alt-panel';
    panel.innerHTML = `
      <div class="rb-alt" role="region" aria-label="Suggestions de séjours alternatifs">
        <div class="rb-alt__head">
          <h2 class="rb-alt__title">${headline.title}</h2>
          <p class="rb-alt__subtitle">${headline.subtitle}</p>
        </div>
        ${cards ? `<div class="rb-alt__grid">${cards}</div>` : ''}
        <div class="rb-alt__cta">
          <p class="rb-alt__cta-text">Une question, un projet précis ? Notre équipe répond rapidement.</p>
          <div class="rb-alt__cta-buttons">
            ${wa ? `<a class="rb-alt__btn rb-alt__btn--primary" href="https://wa.me/${wa}" target="_blank" rel="noopener" data-track="whatsapp">💬 WhatsApp</a>` : ''}
            <a class="rb-alt__btn" href="mailto:${cfg.contact.email}" data-track="email">✉ Nous écrire</a>
          </div>
        </div>
      </div>
    `;

    container.parentNode.insertBefore(panel, container);

    // tracking
    panel.querySelectorAll('[data-track]').forEach((el) => {
      el.addEventListener('click', () => track(el.dataset.track, suggestions, query));
    });

    track('shown', suggestions, query);
  }

  function track(event, suggestions, query) {
    const eventName = (cfg.tracking?.gaEventPrefix || 'rb_alt_') + event;
    try {
      if (window.gtag) {
        window.gtag('event', eventName, {
          suggestion_count: suggestions?.length || 0,
          guests: query?.guests,
        });
      }
      if (window.dataLayer) {
        window.dataLayer.push({
          event: eventName,
          rb_suggestion_count: suggestions?.length || 0,
          rb_guests: query?.guests,
        });
      }
    } catch (e) { /* silent */ }
  }

  // ==================================================================
  // BOUCLE PRINCIPALE
  // ==================================================================
  let lastSignature = null;
  function tick() {
    const container = findResultsContainer();
    if (!container) return;
    if (!isEmptyState(container)) {
      // si on a un panneau ouvert et que Lodgify a re-render des résultats → on retire
      document.getElementById('rb-alt-panel')?.remove();
      lastSignature = null;
      return;
    }
    const q = extractQuery();
    if (!q) return;
    const sig = JSON.stringify({ ci: isoDay(q.checkIn), co: isoDay(q.checkOut), g: q.guests });
    if (sig === lastSignature) return;
    lastSignature = sig;
    window.__rbLastQuery = q;
    const state = buildSuggestions(q);
    render(state, q);
  }

  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const debouncedTick = debounce(tick, 250);

  function start() {
    const obs = new MutationObserver(debouncedTick);
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    debouncedTick();

    // mode proactif : on intercepte le submit du formulaire pour réagir avant
    // que Lodgify ait répondu. On ne block PAS la soumission native — on laisse
    // Lodgify faire son taf, et on prépare un panneau si on prédit zéro.
    document.addEventListener('submit', (e) => {
      const form = e.target.closest?.(cfg.lodgify.searchForm);
      if (!form) return;
      // léger délai pour laisser Lodgify mettre à jour l'URL / le DOM
      setTimeout(debouncedTick, 800);
      setTimeout(debouncedTick, 2000);
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // ==================================================================
  // API DE DEBUG
  // ==================================================================
  window.__rbDebug = {
    cfg,
    diagnose,
    ruleFor,
    buildSuggestions,
    extractQuery,
    findResultsContainer,
    isEmptyState,
    tick: debouncedTick,
    // pour forcer un test :
    // window.__rbDebug.simulate({ checkIn: '2026-07-14', checkOut: '2026-07-17', guests: 12 })
    simulate(rawQuery) {
      const q = {
        checkIn: toDate(rawQuery.checkIn),
        checkOut: toDate(rawQuery.checkOut),
        guests: parseInt(rawQuery.guests, 10),
      };
      window.__rbLastQuery = q;
      const state = buildSuggestions(q);
      const container = findResultsContainer();
      if (!container) {
        console.warn('[Rochebonne] ❌ Conteneur de résultats Lodgify introuvable. Sélecteurs essayés :', cfg.lodgify.resultsContainer);
        console.warn('[Rochebonne] → injection en mode FALLBACK juste après le formulaire de recherche');
        const form = document.querySelector(cfg.lodgify.searchForm);
        if (form?.parentElement) {
          const fakeContainer = document.createElement('div');
          fakeContainer.id = '__rb_fallback_anchor';
          form.parentElement.insertBefore(fakeContainer, form.nextSibling);
        }
      }
      render(state, q);
      console.log('[Rochebonne] simulate() ok →', state.reasons, state.suggestions.length, 'suggestions');
      if (!document.getElementById('rb-alt-panel')) {
        console.warn('[Rochebonne] ❌ panel non rendu. Inspecte le DOM et envoie-moi le bon sélecteur du conteneur de résultats.');
      }
      return state;
    },
    // Audit DOM en plusieurs stratégies — pour découvrir le bon sélecteur
    // sur n'importe quelle page Lodgify (classes hash CSS-in-JS incluses).
    inspectDom() {
      console.log('=== [Rochebonne] inspect DOM v2 ===');
      console.log('URL :', location.href);
      console.log('Sélecteurs configurés :', cfg.lodgify.resultsContainer);
      console.log('Conteneur trouvé :', findResultsContainer());

      // STRATÉGIE 1 — parent commun des liens vers les fiches gîtes
      const slugs = cfg.properties.map((p) => p.url).filter(Boolean);
      const propertyLinks = [...document.querySelectorAll('a[href]')].filter((a) => {
        const href = a.getAttribute('href') || '';
        return slugs.some((s) => href.includes(s.split('?')[0]));
      });
      console.log(`\n[Strat 1] Liens vers gîtes trouvés : ${propertyLinks.length}`);
      if (propertyLinks.length >= 2) {
        let common = propertyLinks[0].parentElement;
        while (common && !propertyLinks.every((l) => common.contains(l))) {
          common = common.parentElement;
        }
        if (common) {
          console.log('  → Parent commun :', common.tagName, '|class:', common.className, '|id:', common.id);
          console.log('  → Sélecteur suggéré :', common.id ? `#${common.id}` : (common.className ? `.${common.className.split(' ')[0]}` : common.tagName.toLowerCase()));
        }
      } else if (propertyLinks.length === 1) {
        console.log('  → 1 seul lien trouvé. Parent direct :', propertyLinks[0].parentElement?.tagName, propertyLinks[0].parentElement?.className);
      }

      // STRATÉGIE 2 — détection par structure (cartes avec prix + image)
      const cards = [...document.querySelectorAll('article, li, div, a')].filter((el) => {
        const t = el.innerText || '';
        if (t.length > 800 || t.length < 20) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 150 || r.width > 900 || r.height < 100 || r.height > 800) return false;
        const hasPrice = /\d+[\s,.]?\d*\s*€/.test(t);
        const hasImg = !!el.querySelector('img');
        return hasPrice && hasImg;
      });
      console.log(`\n[Strat 2] Cartes plausibles (prix + image) : ${cards.length}`);
      if (cards.length >= 2) {
        let cardParent = cards[0].parentElement;
        while (cardParent && !cards.slice(0, 3).every((c) => cardParent.contains(c))) {
          cardParent = cardParent.parentElement;
        }
        if (cardParent) {
          console.log('  → Parent commun :', cardParent.tagName, '|class:', cardParent.className, '|id:', cardParent.id);
        }
      }

      // STRATÉGIE 3 — texte "no results"
      const noResults = [...document.querySelectorAll('*')].filter((el) => {
        const t = (el.innerText || '').toLowerCase();
        if (!t || t.length > 300 || el.children.length > 8) return false;
        return ['aucun bien', 'aucune dispon', 'no propert', 'no result', 'pas de dispon', 'no matching'].some((p) => t.includes(p));
      });
      console.log(`\n[Strat 3] Textes "no results" trouvés : ${noResults.length}`);
      noResults.slice(0, 5).forEach((el, i) =>
        console.log(`  ${i}.`, el.tagName, '|class:', el.className, '|text:', el.innerText.slice(0, 100))
      );

      // STRATÉGIE 4 — chaîne de parents du 1er lien gîte (debug visuel)
      if (propertyLinks[0]) {
        console.log('\n[Strat 4] Hiérarchie parent depuis le 1er lien gîte :');
        let cur = propertyLinks[0];
        for (let i = 0; i < 10 && cur; i++) {
          console.log(`  niveau ${i} :`, cur.tagName, '|class:', (cur.className || '').toString().slice(0, 100), '|id:', cur.id);
          cur = cur.parentElement;
        }
      }

      console.log('\n→ Envoie-moi le sélecteur du parent commun trouvé en Strat 1 ou Strat 2.');
      return { propertyLinks: propertyLinks.length, cards: cards.length, noResults: noResults.length };
    },
  };
})();
