// Vérifie web/data/data_archimonstre.json (lancé automatiquement sur GitHub à chaque modification).
// Usage : node scripts/check-data.mjs
import { readFileSync } from 'node:fs';
import { parseDuration, slug } from '../web/js/util.js';

const file = new URL('../web/data/data_archimonstre.json', import.meta.url);
let data;
try {
  data = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`✗ JSON invalide : ${e.message}`);
  process.exit(1);
}

const errors = [];
const warns = [];
if (!Array.isArray(data.archimonstres)) errors.push('"archimonstres" doit être une liste.');
const seen = new Map();
(data.archimonstres || []).forEach((m, i) => {
  const where = `#${i + 1} (${m?.nom ?? '?'})`;
  if (!m || typeof m.nom !== 'string' || !m.nom.trim()) { errors.push(`${where} : "nom" manquant.`); return; }
  const id = slug(m.nom);
  if (seen.has(id)) errors.push(`${where} : doublon de #${seen.get(id)}.`);
  seen.set(id, i + 1);
  if (m.timer != null && !parseDuration(m.timer)) errors.push(`${where} : timer "${m.timer}" illisible.`);
  if (m.timer_max != null) {
    const a = parseDuration(m.timer), b = parseDuration(m.timer_max);
    if (!b) errors.push(`${where} : timer_max "${m.timer_max}" illisible.`);
    else if (!a) errors.push(`${where} : timer_max sans timer.`);
    else if (b <= a) errors.push(`${where} : timer_max doit être plus long que timer.`);
  }
  if (m.niveau != null && !((Number.isInteger(m.niveau) && m.niveau > 0) || (typeof m.niveau === 'string' && /^\d+( à \d+)?$/.test(m.niveau))))
    errors.push(`${where} : "niveau" doit être un entier ou une tranche comme "68 à 73".`);
  const modes = ['environnement', 'donjon', 'challenge', 'stele'];
  if (m.apparition != null && !modes.includes(m.apparition)) errors.push(`${where} : "apparition" doit valoir ${modes.join(', ')}.`);
  if (m.apparition === 'environnement' && m.timer == null) errors.push(`${where} : un archimonstre d'environnement doit avoir un timer.`);
  if (m.timer == null && m.apparition == null) warns.push(`${where} : pas encore de timer.`);
});

const n = data.archimonstres?.length ?? 0;
const withTimer = (data.archimonstres || []).filter(m => m?.timer != null).length;
console.log(`${n} archimonstres, ${withTimer} avec timer.`);
if (warns.length) console.log(`(${warns.length} sans timer)`);
if (errors.length) {
  console.error(errors.map(e => `✗ ${e}`).join('\n'));
  process.exit(1);
}
console.log('✓ Fichier valide.');
