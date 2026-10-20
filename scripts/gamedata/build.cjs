// Générateur des données d'artisanat et du bestiaire.
//
// Sources :
//   - données officielles du jeu publiées par Ankama sur son CDN (objets, recettes, récoltes) ;
//   - wiki communautaire wakfu.wiki.gg (monstres, drops, zones, récolte du trappeur), licence CC BY-SA.
//
// Fonctionne dans Node 18+ (scripts/fetch-gamedata.mjs) comme dans un navigateur :
// il n'utilise que fetch(). Le résultat est trois objets JSON prêts à écrire dans web/data/.

/* global globalThis */
(function (root) {
  const CDN = 'https://wakfu.cdn.ankama.com/gamedata';
  const WIKI_API = 'https://wakfu.wiki.gg/api.php';

  const RARETES = { 0: 'Commun', 1: 'Commun', 2: 'Rare', 3: 'Mythique', 4: 'Légendaire', 5: 'Relique', 6: 'Souvenir', 7: 'Épique' };
  // Types d'objets considérés comme des ressources (matériaux d'artisanat).
  const TYPES_RESSOURCE = new Set([
    281, 282, 306, 308, 309, 313, 809,          // récoltes
    327, 393, 463, 514, 567, 568, 851,          // raffinages
    531, 822, 852, 419,                          // ressources de monstres, diverses, d'élevage, semences
    569, 570, 571, 574, 575, 576, 577, 578,     // composants
  ]);
  const ACTIONS_TRAPPEUR = { Extract: 'Extraire', Harvest: 'Récolter', 'Harvest (restes)': 'Récolter (restes)', Restes: 'Restes' };
  const WIKI_TYPE = { Monster: 'Monstre', Boss: 'Boss', 'Ultimate Boss': 'Boss ultime', Archmonster: 'Archimonstre', Dominant: 'Dominant' };

  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’`´]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();
  const plain = s => String(s ?? '').replace(/\{[^{}]*\}/g, '').replace(/\s+/g, ' ').trim();

  async function getJson(url, tries = 4) {
    for (let i = 0; ; i++) {
      try {
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
        return await r.json();
      } catch (e) {
        if (i >= tries - 1) throw e;
        await new Promise(res => setTimeout(res, 800 * (i + 1)));
      }
    }
  }

  async function cargoAll(table, fields, log) {
    const out = [];
    for (let off = 0; ; off += 500) {
      const u = `${WIKI_API}?action=cargoquery&format=json&origin=*&tables=${table}`
        + `&fields=${encodeURIComponent(fields)}&limit=500&offset=${off}`;
      const j = await getJson(u);
      if (j.error) throw new Error(`wiki ${table}: ${j.error.info}`);
      const rows = (j.cargoquery || []).map(x => x.title);
      out.push(...rows);
      if (rows.length < 500) break;
    }
    log?.(`wiki ${table} : ${out.length} lignes`);
    return out;
  }

  /* ---------------------------------------------------------- textes des effets */

  // Valeur n°k (1, 2, 3…) d'un effet : base + gain par niveau × niveau.
  function effValue(params, k, level) {
    const i = (k - 1) * 2;
    if (params.length <= i) return undefined;
    return Math.floor((params[i] || 0) + (params[i + 1] || 0) * level + 1e-9);
  }

  function evalCond(cond, val) {
    let m;
    if ((m = cond.match(/^~(\d)$/)) || (m = cond.match(/^\+(\d)$/))) return val(+m[1]) !== undefined;
    if ((m = cond.match(/^-(\d)$/))) return val(+m[1]) === undefined;
    if ((m = cond.match(/^>(\d)$/))) return (val(+m[1]) ?? 0) > 1;
    if ((m = cond.match(/^(\d+)=(\d)$/))) return val(+m[2]) === +m[1];
    if ((m = cond.match(/^(\d+)<(\d)$/))) return (val(+m[2]) ?? 0) > +m[1];
    if ((m = cond.match(/^(\d+)>(\d)$/))) return (val(+m[2]) ?? 0) < +m[1];
    return false;
  }

  // Interprète le mini-langage des descriptions : {[cond]?alors:sinon}, [#n], [el0]…
  function renderTemplate(tpl, val) {
    let s = String(tpl || '').replace(/\[#charac [A-Z_]+\]\s*/g, '');
    const parse = (str, i) => { // renvoie [texte, index après la fin]
      let out = '';
      while (i < str.length) {
        const c = str[i];
        if (c === '{') {
          const end = str.indexOf(']', i);
          const cond = str.slice(i + 2, end);
          let j = end + 2; // après "]?"
          const [a, ja] = parseBranch(str, j);
          let b = '';
          j = ja;
          if (str[j] === ':') { const r = parseBranch(str, j + 1); b = r[0]; j = r[1]; }
          out += evalCond(cond, val) ? a : b;
          i = j + 1; // saute "}"
        } else if (c === '}' || c === ':') {
          return [out, i];
        } else { out += c; i++; }
      }
      return [out, i];
    };
    const parseBranch = (str, i) => parse(str, i);
    try { s = parse(s, 0)[0]; } catch { /* modèle inattendu */ }
    s = s.replace(/\[#(\d)\]/g, (_, k) => String(val(+k) ?? ''))
      .replace(/\[el\d\]|\[ecnb[ir]\]|\[\w+\d*\]/g, '')
      .replace(/\s+/g, ' ').trim();
    return s;
  }

  function effectText(def, level, actions, states) {
    const a = actions.get(def.actionId);
    if (!a) return null;
    const p = def.params || [];
    const val = k => effValue(p, k, level);
    if (def.actionId === 304) { // applique un état
      const st = states.get(p[0]);
      return st ? `${st}${val(2) ? ` (niv. ${val(2)})` : ''}` : null;
    }
    if (def.actionId === 400 || def.actionId === 39 || def.actionId === 40 || def.actionId >= 999 && def.actionId <= 1020) return null;
    const txt = renderTemplate(a.description?.fr || a.definition.effect, val);
    return txt || null;
  }

  /* ---------------------------------------------------------- noms français */

  // Applique la table anglais -> français (scripts/gamedata/noms_fr.json, tirée des fichiers du jeu)
  // aux monstres, familles, zones et objets venant du wiki. Sans table, rien ne change.
  function applyFrenchNames(res, noms) {
    if (!noms) return { monstres: 0, total: 0 };
    const look = (table, s) => {
      if (!s || !table) return null;
      const t = table[norm(s)] || table[norm(String(s).replace(/\s*\([^)]*\)\s*$/, ''))];
      return t || null;
    };
    const monstre = s => look(noms.monstres, s);
    const famille = s => look(noms.familles, s) || look(noms.familles, `${s}s`) || look(noms.familles, `${s}es`);
    const zone = s => look(noms.zones, s);
    const objet = s => look(noms.objets, String(s).replace(/\/(Common|Unusual|Rare|Mythical|Legendary|Relic|Souvenir|Epic|Old Item)$/, ''));
    let ok = 0;
    const SUFFIXES = { 'environmental quest': 'quête environnementale' };
    const monstreAvecSuffixe = en => {
      const mm = String(en).match(/^(.*?)\s*\(([^)]*)\)\s*$/);
      if (mm && SUFFIXES[norm(mm[2])]) {
        const base = monstre(mm[1]);
        return base ? `${base} (${SUFFIXES[norm(mm[2])]})` : null;
      }
      return monstre(en);
    };
    for (const m of res.data_bestiaire.monstres) {
      const en = m.nom_en || m.nom;
      const f = monstreAvecSuffixe(en);
      if (f) { ok++; m.nom_en = en; m.nom = f; }
      if (m.famille) m.famille = famille(m.famille) || m.famille;
      if (m.zones) m.zones = m.zones.map(z => zone(z) || z);
      for (const d of [...(m.drops || []), ...(m.trappeur?.items || [])]) {
        if (d.nom_en && !d.nom) { const o = objet(d.nom_en); if (o) d.nom = o; }
      }
      // ordre des clés lisible : nom, nom_en, …
      const { nom, nom_en: ne, ...rest } = m;
      Object.keys(m).forEach(k => delete m[k]);
      Object.assign(m, { nom, ...(ne && ne !== nom ? { nom_en: ne } : {}), ...rest });
    }
    for (const o of [...res.data_item.items, ...res.data_ressource.ressources]) {
      for (const d of o.drops || []) d.monstre = monstreAvecSuffixe(d.monstre) || d.monstre;
      for (const h of o.recolte || []) if (h.metier === 'Trappeur') h.source = monstreAvecSuffixe(h.source) || h.source;
    }
    const remarque = `Noms officiels français tirés des fichiers du jeu ; ${res.data_bestiaire.monstres.length - ok} monstres (événements ou retirés du jeu) restent en anglais. Les objets sont référencés par leur id (voir data_item / data_ressource).`;
    res.data_bestiaire.remarque = remarque;
    return { monstres: ok, total: res.data_bestiaire.monstres.length };
  }

  /* ---------------------------------------------------------- génération */

  async function buildGamedata({ log = () => {}, nomsFr = null } = {}) {
    const version = (await getJson(`${CDN}/config.json`)).version;
    log(`version du jeu : ${version}`);
    const files = ['items', 'jobsItems', 'itemTypes', 'recipeCategories', 'recipes', 'recipeIngredients',
      'recipeResults', 'collectibleResources', 'harvestLoots', 'resources', 'actions', 'states'];
    const g = {};
    await Promise.all(files.map(async f => { g[f] = await getJson(`${CDN}/${version}/${f}.json`); }));
    log(`CDN : ${g.items.length} objets, ${g.recipes.length} recettes`);

    const actions = new Map(g.actions.map(a => [a.definition.id, a]));
    const states = new Map(g.states.map(s => [s.definition.id, plain(s.title?.fr)]));
    const types = new Map(g.itemTypes.map(t => [t.definition.id, plain(t.title?.fr)]));
    const jobs = new Map(g.recipeCategories.map(c => [c.definition.id, plain(c.title?.fr)]));
    const nodes = new Map(g.resources.map(r => [r.definition.id, plain(r.title?.fr)]));

    // --- base des objets (jobsItems couvre toutes les ressources, items toutes les équipements)
    const all = new Map();
    for (const it of g.jobsItems) {
      const d = it.definition;
      all.set(d.id, {
        id: d.id, nom: plain(it.title?.fr), nom_en: plain(it.title?.en), niveau: d.level,
        rarete: d.rarity, typeId: d.itemTypeId, gfx: d.graphicParameters?.gfxId || undefined,
      });
    }
    for (const it of g.items) {
      const d = it.definition.item;
      const o = all.get(d.id) || { id: d.id };
      Object.assign(o, {
        nom: plain(it.title?.fr) || o.nom, nom_en: plain(it.title?.en) || o.nom_en, niveau: d.level,
        rarete: d.baseParameters.rarity, typeId: d.baseParameters.itemTypeId,
        gfx: d.graphicParameters?.gfxId || o.gfx,
      });
      if (d.baseParameters.itemSetId) o.panoplieId = d.baseParameters.itemSetId;
      const stats = [];
      for (const e of it.definition.equipEffects || []) {
        const t = effectText(e.effect.definition, d.level, actions, states);
        if (t) stats.push(t);
      }
      if (stats.length) o.stats = stats;
      all.set(d.id, o);
    }

    // --- recettes
    const ingByRecipe = new Map();
    for (const x of g.recipeIngredients) {
      if (!ingByRecipe.has(x.recipeId)) ingByRecipe.set(x.recipeId, []);
      ingByRecipe.get(x.recipeId).push(x);
    }
    const recById = new Map(g.recipes.map(r => [r.id, r]));
    let nbRecettes = 0;
    for (const res of g.recipeResults) {
      const r = recById.get(res.recipeId);
      const o = all.get(res.productedItemId);
      if (!r || !o) continue;
      const ing = (ingByRecipe.get(r.id) || [])
        .sort((a, b) => a.ingredientOrder - b.ingredientOrder)
        .map(x => [x.itemId, x.quantity]);
      const rec = { metier: jobs.get(r.categoryId) || `Métier ${r.categoryId}`, niveau: r.level, ingredients: ing };
      if (res.productedItemQuantity > 1) rec.quantite = res.productedItemQuantity;
      if (r.isUpgrade) rec.amelioration = true;
      (o.recettes ||= []).push(rec);
      nbRecettes++;
    }

    // --- récoltes (paysan, forestier, herboriste, mineur, pêcheur)
    const lootByList = new Map();
    for (const l of g.harvestLoots) {
      if (!lootByList.has(l.listId)) lootByList.set(l.listId, []);
      lootByList.get(l.listId).push(l);
    }
    const addHarvest = (itemId, h) => {
      const o = all.get(itemId);
      if (!o) return;
      o.recolte ||= [];
      if (!o.recolte.some(x => x.metier === h.metier && x.niveau === h.niveau && x.source === h.source)) o.recolte.push(h);
    };
    for (const c of g.collectibleResources) {
      const h = { metier: jobs.get(c.skillId) || `Métier ${c.skillId}`, niveau: c.skillLevelRequired, source: nodes.get(c.resourceId) || '' };
      if (c.collectItemId) addHarvest(c.collectItemId, h);
      for (const l of lootByList.get(c.collectLootListId) || []) {
        if (!l.itemIsLootList && l.itemId) addHarvest(l.itemId, { ...h, taux: l.dropRate < 1 ? +(l.dropRate * 100).toFixed(2) : undefined });
      }
    }

    // --- index des noms anglais pour relier le wiki
    const upgradeOutputs = new Set();
    for (const o of all.values()) if (o.recettes?.some(r => r.amelioration)) upgradeOutputs.add(o.id);
    const byEn = new Map();
    for (const o of all.values()) {
      const k = norm(o.nom_en);
      if (!k) continue;
      if (!byEn.has(k)) byEn.set(k, []);
      byEn.get(k).push(o);
    }
    const RARITY_EN = { Common: [0, 1], Unusual: [0], Rare: [2], Mythical: [3], Legendary: [4], Relic: [5], Souvenir: [6], Epic: [7] };
    const wikiItems = await cargoAll('Items', 'name,rarity,level', log);
    const wikiInfo = new Map();
    for (const w of wikiItems) if (!wikiInfo.has(norm(w.name))) wikiInfo.set(norm(w.name), w);
    const unmatched = new Set();
    const resolve = raw => {
      // "Feudora/Legendary" : nom + rareté
      let name = String(raw), wantRarity = null;
      const sl = name.match(/^(.*)\/(Common|Unusual|Rare|Mythical|Legendary|Relic|Souvenir|Epic|Old Item)$/);
      if (sl) { name = sl[1]; wantRarity = RARITY_EN[sl[2]] || null; }
      let k = norm(name);
      let c = byEn.get(k);
      if (!c) { k = norm(name.replace(/\s*\([^)]*\)\s*$/, '')); c = byEn.get(k); }
      if (!c) { unmatched.add(raw); return null; }
      if (wantRarity) {
        const r = c.filter(o => wantRarity.includes(o.rarete));
        if (r.length) c = r;
      }
      if (c.length === 1) return c[0].id;
      const w = wikiInfo.get(norm(raw)) || wikiInfo.get(norm(name));
      if (w) {
        const rs = RARITY_EN[w.rarity] || [];
        const exact = c.filter(o => String(o.niveau) === String(w.level) && rs.includes(o.rarete));
        if (exact.length) return exact[0].id;
      }
      const sorted = [...c].sort((a, b) => (upgradeOutputs.has(a.id) - upgradeOutputs.has(b.id)) || (a.rarete - b.rarete) || (a.niveau - b.niveau));
      return sorted[0].id;
    };

    // --- bestiaire (wiki)
    const [wMonsters, wDrops, wSpawns, wHarv] = await Promise.all([
      cargoAll('Monsters', '_pageName=page,name,family,type,minLevel,maxLevel', log),
      // _pageName (et non « monster ») : la version « (Environmental Quest) » d'un monstre a sa propre page et ses propres drops.
      cargoAll('Monster_drops', '_pageName=monster,item,rate', log),
      cargoAll('Monster_spawns', '_pageName=monster,location', log),
      cargoAll('Monster_harvests', '_pageName=monster,trapperLevel,action1,item1,action2,item2,action3,item3,actionRemains,remains', log),
    ]);
    // portraits des monstres (fichiers du wiki) : on vérifie leur existence par lots
    const imgCandidates = m => [...new Set([m.image, `${m.page}.png`, `${String(m.page).replace(/\s*\([^)]*\)\s*$/, '')}.png`].filter(Boolean))];
    const imgFiles = [...new Set(wMonsters.flatMap(imgCandidates))];
    const existing = new Map();
    for (let i = 0; i < imgFiles.length; i += 25) {
      const titles = imgFiles.slice(i, i + 25).map(f => `File:${f}`).join('|');
      try {
        const j = await getJson(`${WIKI_API}?action=query&format=json&origin=*&prop=imageinfo&iiprop=url&titles=${encodeURIComponent(titles)}`, 3);
        const back = {};
        for (const n of j.query?.normalized || []) back[n.to] = n.from;
        for (const p of Object.values(j.query?.pages || {})) {
          if ('missing' in p || !p.imageinfo) continue;
          existing.set((back[p.title] || p.title).replace(/^File:/, ''), decodeURIComponent(p.imageinfo[0].url.replace(/\?.*$/, '').replace(/^.*\/images\//, '')));
        }
      } catch { /* lot ignoré */ }
    }
    log(`portraits : ${existing.size} fichiers trouvés`);

    const monsters = new Map();
    for (const m of wMonsters) {
      // nom de page (et non le champ « name ») : distingue « Arachnee » de « Arachnee (Environmental Quest) »
      const nom = String(m.page || m.name).replace(/\s*\(monster\)$/i, '').trim();
      const min = parseInt(m.minLevel, 10), max = parseInt(m.maxLevel, 10);
      monsters.set(m.page, {
        nom,
        famille: String(m.family || '').replace(/\s*\(family\)$/i, '').trim() || undefined,
        type: WIKI_TYPE[m.type] || undefined,
        niveau_min: Number.isFinite(min) ? min : undefined,
        niveau_max: Number.isFinite(max) ? max : (Number.isFinite(min) ? min : undefined),
        image: existing.get(imgCandidates(m).find(f => existing.has(f))) || undefined,
      });
    }
    const mon = page => {
      if (!monsters.has(page)) monsters.set(page, { nom: String(page).replace(/\s*\(monster\)$/i, '').trim() });
      return monsters.get(page);
    };
    for (const s of wSpawns) {
      if (!s.monster || !s.location) continue;
      const m = mon(s.monster);
      (m.zones ||= []);
      if (!m.zones.includes(s.location)) m.zones.push(s.location);
    }
    let nbDrops = 0;
    for (const d of wDrops) {
      if (!d.monster || !d.item) continue;
      const m = mon(d.monster);
      const id = resolve(d.item);
      const taux = parseFloat(String(d.rate).replace(',', '.'));
      const entry = id ? { id } : { nom_en: d.item };
      if (Number.isFinite(taux)) entry.taux = taux;
      (m.drops ||= []).push(entry);
      if (id) {
        const o = all.get(id);
        (o.drops ||= []).push({ monstre: m.nom, ...(Number.isFinite(taux) ? { taux } : {}) });
      }
      nbDrops++;
    }
    for (const h of wHarv) {
      if (!h.monster) continue;
      const m = mon(h.monster);
      const lvl = parseInt(h.trapperLevel, 10) || 0;
      const items = [];
      for (const [a, it] of [[h.action1, h.item1], [h.action2, h.item2], [h.action3, h.item3], [h.actionRemains ? `${h.actionRemains} (restes)` : 'Restes', h.remains]]) {
        if (!it) continue;
        const id = resolve(it);
        const action = ACTIONS_TRAPPEUR[a] || a || undefined;
        items.push(id ? { id, action } : { nom_en: it, action });
        if (id) {
          const o = all.get(id);
          o.recolte ||= [];
          o.recolte.push({ metier: 'Trappeur', niveau: lvl, source: m.nom });
        }
      }
      if (items.length) m.trappeur = { niveau: lvl, items };
    }

    // --- sortie
    const finalize = o => {
      const out = { id: o.id, nom: o.nom, nom_en: o.nom_en, niveau: o.niveau, rarete: o.rarete, type: types.get(o.typeId) || '' };
      if (o.gfx) out.gfx = o.gfx;
      for (const k of ['panoplieId', 'stats', 'recettes', 'recolte', 'drops']) if (o[k]) out[k] = o[k];
      return out;
    };
    const items = [], ressources = [];
    for (const o of [...all.values()].sort((a, b) => a.id - b.id)) {
      if (!o.nom) continue;
      (TYPES_RESSOURCE.has(o.typeId) ? ressources : items).push(finalize(o));
    }
    const bestiaire = [...monsters.values()]
      .filter(m => m.nom)
      .sort((a, b) => (a.niveau_min ?? 9999) - (b.niveau_min ?? 9999) || a.nom.localeCompare(b.nom));

    const maj = new Date().toISOString().slice(0, 10);
    const sourceCdn = `Données officielles du jeu (CDN Ankama, version ${version})`;
    const sourceWiki = 'Wakfu Wiki – wakfu.wiki.gg (CC BY-SA 4.0)';
    const meta = { version_jeu: version, maj, raretes: RARETES };
    log(`${items.length} objets, ${ressources.length} ressources, ${nbRecettes} recettes, ${bestiaire.length} monstres, ${nbDrops} drops`);
    if (unmatched.size) log(`${unmatched.size} noms du wiki sans objet correspondant (gardés en anglais)`);

    const out = {
      data_item: { ...meta, sources: [sourceCdn, sourceWiki], nb: items.length, items },
      data_ressource: { ...meta, sources: [sourceCdn, sourceWiki], nb: ressources.length, ressources },
      data_bestiaire: {
        ...meta, sources: [sourceWiki, sourceCdn],
        remarque: 'Noms des monstres en anglais (le wiki est anglophone) ; les objets sont référencés par leur id (voir data_item / data_ressource).',
        nb: bestiaire.length, monstres: bestiaire,
      },
      stats: { unmatched: [...unmatched].slice(0, 200), nbUnmatched: unmatched.size },
    };
    if (nomsFr) {
      const t = applyFrenchNames(out, nomsFr);
      log(`noms français : ${t.monstres}/${t.total} monstres`);
    }
    return out;
  }

  const api = { buildGamedata, applyFrenchNames, renderTemplate, effValue, RARETES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WakfuGamedata = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
