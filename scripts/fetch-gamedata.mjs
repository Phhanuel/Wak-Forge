// Régénère web/data/data_item.json, data_ressource.json et data_bestiaire.json
// à partir des données officielles du jeu (CDN Ankama) et du wiki wakfu.wiki.gg.
//
// Usage : node scripts/fetch-gamedata.mjs        (Node 18 ou plus récent)
// Lancé automatiquement chaque semaine par .github/workflows/gamedata.yml.
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { buildGamedata } = require('./gamedata/build.cjs');
const out = name => new URL(`../web/data/${name}.json`, import.meta.url);

// Une entrée par ligne : fichiers lisibles et différences claires sur GitHub.
function serialize(obj, listKey) {
  const { [listKey]: list, ...head } = obj;
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  lines.push(`  ${JSON.stringify(listKey)}: [\n${list.map(x => '    ' + JSON.stringify(x)).join(',\n')}\n  ]`);
  return `{\n${lines.join(',\n')}\n}\n`;
}

const nomsPath = new URL('./gamedata/noms_fr.json', import.meta.url);
const nomsFr = existsSync(nomsPath) ? JSON.parse(readFileSync(nomsPath, 'utf8')) : null;
if (!nomsFr) console.log('· pas de scripts/gamedata/noms_fr.json : monstres et zones en anglais (voir i18n-from-game.mjs)');
const result = await buildGamedata({ log: m => console.log('·', m), nomsFr });

// Garde-fou : ne pas écraser de bonnes données par un résultat manifestement incomplet.
const prev = existsSync(out('data_item')) ? JSON.parse(readFileSync(out('data_item'), 'utf8')) : null;
if (prev && result.data_item.nb < prev.nb * 0.8) {
  console.error(`✗ Seulement ${result.data_item.nb} objets (contre ${prev.nb} avant) : fichiers non modifiés.`);
  process.exit(1);
}

writeFileSync(out('data_item'), serialize(result.data_item, 'items'));
writeFileSync(out('data_ressource'), serialize(result.data_ressource, 'ressources'));
writeFileSync(out('data_bestiaire'), serialize(result.data_bestiaire, 'monstres'));
// textes anglais : une entrée par ligne pour les effets
{
  const { stats, ...head } = result.data_en;
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  lines.push(`  "stats": {\n${Object.entries(stats).map(([id, v]) => `    ${JSON.stringify(id)}: ${JSON.stringify(v)}`).join(',\n')}\n  }`);
  writeFileSync(out('data_en'), `{\n${lines.join(',\n')}\n}\n`);
}
console.log(`✓ Données ${result.data_item.version_jeu} écrites (${result.stats.nbUnmatched} noms du wiki non reliés).`);
