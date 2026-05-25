/**
 * ROCHEBONNE — Proxy API Lodgify (optionnel, v2)
 * --------------------------------------------------------------
 * Petit endpoint serverless (Vercel / Netlify / Cloudflare Worker)
 * qui interroge la Public API Lodgify v2 et renvoie au widget une
 * vue "disponibilité réelle + min stay par date" pour les hébergements.
 *
 * Pourquoi un proxy : la clé API Lodgify ne doit JAMAIS apparaître côté
 * client. Le proxy garde la clé en variable d'environnement et expose
 * uniquement les données dont le widget a besoin.
 *
 * Déploiement Vercel :
 *   1. mettre ce fichier dans /api/availability.js
 *   2. Vercel → Environment Variables → LODGIFY_API_KEY = ta clé
 *   3. dans config.js : availabilityApi = 'https://ton-projet.vercel.app/api/availability'
 *
 * Cache : 5 min par défaut (Lodgify rate-limit ~ 1 req/s). Ajuster
 * via le header Cache-Control.
 */

// Format Vercel / Next.js API route
export default async function handler(req, res) {
  // CORS — autorise uniquement ton domaine
  const allowedOrigins = [
    'https://domainederochebonne.com',
    'https://www.domainederochebonne.com',
    'https://rochebonne-vacances.fr',
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const apiKey = process.env.LODGIFY_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'LODGIFY_API_KEY missing' });
  }

  const { from, to, propertyId } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'from and to required (YYYY-MM-DD)' });
  }

  const base = 'https://api.lodgify.com/v2';
  const headers = { 'X-ApiKey': apiKey, 'Accept': 'application/json' };

  try {
    // 1. Liste des propriétés (si pas en cache local)
    const propsResp = await fetch(`${base}/properties`, { headers });
    const properties = await propsResp.json();

    // 2. Pour chaque propriété (ou pour la propertyId si fournie),
    //    on récupère la dispo + le calendrier des min stay
    const targetIds = propertyId
      ? [parseInt(propertyId, 10)]
      : (properties.items || properties || []).map((p) => p.id);

    const availability = await Promise.all(
      targetIds.map(async (id) => {
        const [availResp, ratesResp] = await Promise.all([
          fetch(`${base}/availability/${id}?start=${from}&end=${to}`, { headers }),
          fetch(`${base}/rates/calendar?propertyId=${id}&start=${from}&end=${to}`, { headers }),
        ]);
        const avail = await availResp.json().catch(() => null);
        const rates = await ratesResp.json().catch(() => null);
        return { propertyId: id, availability: avail, rates };
      })
    );

    return res.status(200).json({
      from,
      to,
      properties: properties.items || properties,
      availability,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Upstream error', detail: String(err) });
  }
}
