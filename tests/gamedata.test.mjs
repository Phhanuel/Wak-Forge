// Générateur des données du jeu : sans réseau, avec un faux CDN et un wiki en panne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { buildGamedata, englishFromTable } = createRequire(import.meta.url)('../scripts/gamedata/build.cjs');

const CDN = {
  'config.json': { version: '1.0' },
  jobsItems: [{ definition: { id: 1, level: 5, rarity: 1, itemTypeId: 281 }, title: { fr: 'Blé', en: 'Wheat' } }],
  itemTypes: [{ definition: { id: 281 }, title: { fr: 'Céréale', en: 'Cereal' } }],
};
function fakeFetch(url) {
  if (url.includes('wiki.gg')) return Promise.resolve({ ok: false, status: 502 });
  const name = url.endsWith('config.json') ? 'config.json' : url.replace(/^.*\//, '').replace('.json', '');
  return Promise.resolve({ ok: true, json: async () => CDN[name] ?? [] });
}

test('wiki en panne : le bestiaire et les drops déjà publiés sont gardés', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    const previous = {
      items: [{ id: 1, drops: [{ monstre: 'Bouftou', taux: 5 }], recolte: [{ metier: 'Trappeur', niveau: 10, source: 'Bouftou' }] }],
      monstres: [{ nom: 'Bouftou', nom_en: 'Gobball', famille: 'Bouftous' }],
      remarque: 'avant', en: { familles: { Bouftous: 'Gobballs' }, zones: {} },
    };
    const out = await buildGamedata({ previous, nomsFr: { monstres: {}, familles: {}, zones: {}, objets: {} } });
    const ble = out.data_ressource.ressources.find(o => o.id === 1);
    assert.equal(ble.nom, 'Blé');
    assert.deepEqual(ble.drops, previous.items[0].drops);
    assert.deepEqual(ble.recolte, previous.items[0].recolte);
    assert.deepEqual(out.data_bestiaire.monstres.map(m => m.nom), ['Bouftou']);
    assert.equal(out.stats.wikiOk, false);
    assert.equal(out.data_en.types['Céréale'], 'Cereal');
    assert.equal(out.data_en.familles.Bouftous, 'Gobballs');
  } finally { globalThis.fetch = realFetch; }
});

test('wiki en panne sans données précédentes : erreur', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    await assert.rejects(buildGamedata({}), /502/);
  } finally { globalThis.fetch = realFetch; }
});

test('familles et zones anglaises tirées de la table des noms français', () => {
  const res = {
    data_bestiaire: { monstres: [{ nom: 'Bouftou', famille: 'Bouftous', zones: ["Mine d'Amakna - Tréfonds", 'Inconnue'] }, { nom: 'Mimic', famille: 'Mimics' }] },
    data_en: { familles: {}, zones: {} },
  };
  englishFromTable(res, { familles: { gobballs: 'Bouftous', mimics: 'Mimics' }, zones: { 'amakna mine - depths': "Mine d'Amakna - Tréfonds", 'citadel of horror': 'Citadelle' } });
  assert.deepEqual(res.data_en.familles, { Bouftous: 'Gobballs' });
  assert.deepEqual(res.data_en.zones, { "Mine d'Amakna - Tréfonds": 'Amakna Mine - Depths' });
});
