'use strict';
// V2-20261023 : la référence d'un dossier service doit être unique dans l'environnement.
// Le navigateur proposait SVC-AAAA-0001 à chaque rechargement (compteur en mémoire) :
// côté serveur, on garde la référence demandée si elle est libre, sinon on prend la suivante.
function splitPattern(pattern, year) {
  const base = String(pattern || 'SVC-{YYYY}-{0000}').replace('{YYYY}', String(year));
  const cut = base.indexOf('{0000}');
  if (cut < 0) return null;
  return { pre: base.slice(0, cut), post: base.slice(cut + 6) };
}
function numberIn(ref, parts) {
  const r = String(ref || '');
  if (!parts || !r.startsWith(parts.pre) || (parts.post && !r.endsWith(parts.post))) return null;
  const mid = r.slice(parts.pre.length, parts.post ? r.length - parts.post.length : undefined);
  return /^\d+$/.test(mid) ? Number(mid) : null;
}
function uniqueReference(wanted, existingRefs, pattern, now = new Date()) {
  const taken = new Set((existingRefs || []).map(r => String(r || '')).filter(Boolean));
  const w = String(wanted || '').trim();
  if (w && !taken.has(w)) return w;
  const parts = splitPattern(pattern, now.getFullYear());
  if (!parts) {
    let i = 2; while (taken.has(`${w}-${i}`)) i++; return `${w || 'SVC'}-${i}`;
  }
  let max = 0;
  for (const r of taken) { const n = numberIn(r, parts); if (n != null && n > max) max = n; }
  return `${parts.pre}${String(max + 1).padStart(4, '0')}${parts.post}`;
}
module.exports = { uniqueReference, splitPattern, numberIn };
