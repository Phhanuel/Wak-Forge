// Extrait les noms officiels FR (monstres, familles, zones, objets) des fichiers du jeu installé,
// et écrit scripts/gamedata/noms_fr.json (table anglais -> français utilisée par le générateur).
//
// Usage : node scripts/i18n-from-game.mjs ["C:\Users\toi\AppData\Local\Ankama\Wakfu"]
// Lecture seule : le script ne modifie rien dans le dossier du jeu.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { join } from 'node:path';

const gameDir = process.argv[2]
  || join(process.env.LOCALAPPDATA || join(process.env.HOME || '', 'AppData', 'Local'), 'Ankama', 'Wakfu');
const jar = lang => join(gameDir, 'contents', 'i18n', `i18n_${lang}.jar`);
if (!existsSync(jar('fr'))) {
  console.error(`✗ Fichiers de traduction introuvables dans ${gameDir}\\contents\\i18n`);
  process.exit(1);
}

/** Lit un fichier dans une archive zip/jar (méthodes « stocké » et « deflate »). */
function readZipEntry(buf, wanted) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('archive illisible');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (wanted(name)) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + csize);
      return method === 0 ? data : inflateRawSync(data);
    }
    p += 46 + nlen + xlen + clen;
  }
  throw new Error('texte introuvable dans l\'archive');
}

function loadTexts(lang) {
  const raw = readZipEntry(readFileSync(jar(lang)), n => n === `texts_${lang}.properties`).toString('utf8');
  const out = new Map();
  let prev = null;
  for (let line of raw.split(/\r?\n/)) {
    if (prev !== null) { line = prev + line.trimStart(); prev = null; }
    if (line.endsWith('\\') && !line.endsWith('\\\\')) { prev = line.slice(0, -1); continue; }
    if (!line || line[0] === '#' || line[0] === '!') continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const v = line.slice(i + 1).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\(['=:])/g, '$1').trim();
    out.set(line.slice(0, i).trim(), v);
  }
  return out;
}

const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[’`´]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();

const fr = loadTexts('fr');
const en = loadTexts('en');
console.log(`· ${fr.size} textes FR, ${en.size} textes EN`);

function table(categories, keep = () => true) {
  const votes = new Map();
  for (const [k, v] of en) {
    const p = k.split('.');
    if (p.length !== 3 || p[0] !== 'content' || !categories.includes(p[1])) continue;
    const f = fr.get(k);
    if (!v || !f || !keep(v)) continue;
    const key = norm(v);
    if (!votes.has(key)) votes.set(key, new Map());
    const c = votes.get(key);
    c.set(f, (c.get(f) || 0) + 1);
  }
  const out = {};
  for (const [k, c] of [...votes].sort((a, b) => a[0].localeCompare(b[0]))) {
    out[k] = [...c].sort((a, b) => b[1] - a[1])[0][0];
  }
  return out;
}

// Objets : seulement ceux que le wiki cite sans correspondance dans les données du jeu.
const bestPath = new URL('../web/data/data_bestiaire.json', import.meta.url);
const needed = new Set();
if (existsSync(bestPath)) {
  for (const m of JSON.parse(readFileSync(bestPath, 'utf8')).monstres) {
    for (const d of [...(m.drops || []), ...(m.trappeur?.items || [])]) {
      if (d.nom_en) needed.add(norm(String(d.nom_en).replace(/\/(Common|Unusual|Rare|Mythical|Legendary|Relic|Souvenir|Epic|Old Item)$/, '')));
    }
  }
}

const result = {
  source: 'Fichiers de traduction du client WAKFU (i18n_fr / i18n_en)',
  maj: new Date().toISOString().slice(0, 10),
  monstres: table(['7']),
  familles: table(['38']),
  zones: table(['54', '66', '99']),
  objets: table(['15'], v => needed.has(norm(v))),
};
writeFileSync(new URL('./gamedata/noms_fr.json', import.meta.url), JSON.stringify(result, null, 1) + '\n');
console.log(`✓ noms_fr.json : ${Object.keys(result.monstres).length} monstres, ${Object.keys(result.familles).length} familles, `
  + `${Object.keys(result.zones).length} zones, ${Object.keys(result.objets).length} objets.`);
