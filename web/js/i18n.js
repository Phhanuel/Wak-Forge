// Langue de l'interface (français par défaut, anglais). Les textes sont écrits en français dans le code :
// t('Texte') renvoie la traduction anglaise de web/js/i18n-en.js quand la page est en anglais.
// La langue vient de ?lang=en|fr, sinon du choix enregistré, sinon de la langue du navigateur.
import { EN } from './i18n-en.js';

export const LANG_KEY = 'wakforge.lang';
const browser = typeof document !== 'undefined';

function detect() {
  if (!browser) return 'fr';
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'fr' || q === 'en') { localStorage.setItem(LANG_KEY, q); return q; }
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'fr' || saved === 'en') return saved;
  } catch { /* stockage indisponible */ }
  const nav = (navigator.languages?.[0] || navigator.language || 'fr').toLowerCase();
  return nav.startsWith('fr') ? 'fr' : 'en';
}

export const lang = detect();
export const isEn = lang === 'en';
export const locale = isEn ? 'en-GB' : 'fr-FR';

/** Change la langue (la page est rechargée pour tout retraduire, données du jeu comprises). */
export function setLang(l) {
  try { localStorage.setItem(LANG_KEY, l); } catch { /* rien */ }
  const u = new URL(location.href);
  u.searchParams.delete('lang');
  location.replace(u.href);
}

const missing = new Set();
const squash = s => String(s).replace(/\s+/g, ' ').trim();

/** Traduit un texte français ; {nom} est remplacé par vars.nom. */
export function t(fr, vars) {
  let s = fr;
  if (isEn) {
    const en = EN[fr];
    if (en != null) s = en;
    else if (!missing.has(fr)) { missing.add(fr); if (browser) console.debug('[i18n] à traduire :', fr); }
  }
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : s;
}
/** Singulier ou pluriel selon n ; {n} vaut n. */
export const tn = (n, one, many, vars = {}) => t(n > 1 ? many : one, { n, ...vars });

// Noms fixes du jeu
const JOBS_EN = {
  Paysan: 'Farmer', Forestier: 'Lumberjack', Herboriste: 'Herbalist', Mineur: 'Miner', Pêcheur: 'Fisherman', Trappeur: 'Trapper',
  Boulanger: 'Baker', Cuisinier: 'Chef', Armurier: 'Armorer', Bijoutier: 'Jeweler', Tailleur: 'Tailor', Maroquinier: 'Leather Dealer',
  Ébéniste: 'Handyman', "Maitre d'Armes": 'Weapons Master',
};
const RARITY_EN = { Commun: 'Common', Rare: 'Rare', Mythique: 'Mythical', Légendaire: 'Legendary', Relique: 'Relic', Souvenir: 'Souvenir', Épique: 'Epic' };
const MONSTER_TYPE_EN = { Monstre: 'Monster', Boss: 'Boss', 'Boss ultime': 'Ultimate Boss', Archimonstre: 'Archmonster', Dominant: 'Dominant' };
const TRAP_ACTION_EN = { Extraire: 'Extract', Récolter: 'Harvest', 'Récolter (restes)': 'Harvest (remains)', Restes: 'Remains' };
export const jobName = m => (isEn && JOBS_EN[m]) || m;
export const rarityLabel = r => (isEn && RARITY_EN[r]) || r;
export const monsterTypeName = m => (isEn && MONSTER_TYPE_EN[m]) || m;
export const trapActionName = a => (isEn && TRAP_ACTION_EN[a]) || a;

/** Traduit la page statique : éléments [data-i18n] (contenu HTML entier, ou la clé donnée), textes et attributs. */
export function translateDom(root = document) {
  if (browser) document.documentElement.lang = lang;
  if (!isEn) return;
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const k = el.dataset.i18n || squash(el.innerHTML); // data-i18n="clé" quand le même texte se traduit autrement
    if (EN[k] != null) el.innerHTML = EN[k]; else t(k);
  }
  const walker = document.createTreeWalker(root.body || root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const k = squash(n.nodeValue);
    if (!k || !/[a-zà-ÿ]/i.test(k) || n.parentElement.closest('[data-i18n], script, style, code, kbd, [data-no-i18n]')) continue;
    const en = t(k);
    if (en !== k) n.nodeValue = n.nodeValue.match(/^\s*/)[0] + en + n.nodeValue.match(/\s*$/)[0];
  }
  for (const attr of ['title', 'placeholder', 'aria-label']) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const k = squash(el.getAttribute(attr));
      if (k) el.setAttribute(attr, t(k));
    }
  }
  if (root === document) {
    document.title = t(document.title);
    const d = document.querySelector('meta[name="description"]');
    if (d) d.content = t(d.content);
  }
}

/** Textes encore non traduits (tests et vérifications). */
export const missingKeys = () => [...missing];
