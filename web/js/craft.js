// Onglets « Craft » (liste de courses) et « Bestiaire » + fiche objet.
import { norm, escapeHtml } from './util.js';
import { buildIndex, computeList, costIndex, searchItems, sourcesOf, mainRecipe, monsterItemIds, encodeShare, decodeShare, RARITY_CLASS } from './craftcore.js';

const $ = (s, r = document) => r.querySelector(s);
const fmtN = n => Number(n).toLocaleString('fr-FR');
const fmtK = n => `${fmtN(Math.round(n))} kamas`;
// Icônes de métier actuelles du jeu (web/icons/metiers), émoji en secours.
const JOB_FILE = {
  Paysan: 'paysan', Forestier: 'forestier', Herboriste: 'herboriste', Mineur: 'mineur', Pêcheur: 'pecheur',
  Trappeur: 'trappeur', Boulanger: 'boulanger', Cuisinier: 'cuisinier', Armurier: 'armurier', Bijoutier: 'bijoutier',
  Tailleur: 'tailleur', Maroquinier: 'maroquinier', Ébéniste: 'ebeniste', "Maitre d'Armes": 'maitre-armes',
};
const JOB_EMOJI = {
  Paysan: '🌾', Forestier: '🌲', Herboriste: '🌿', Mineur: '⛏️', Pêcheur: '🎣', Trappeur: '🪤',
  Boulanger: '🥖', Cuisinier: '🍲', Armurier: '🛡️', Bijoutier: '💍', Tailleur: '🧵', Maroquinier: '👢',
  Ébéniste: '🪵', "Maitre d'Armes": '⚔️',
};
function jobIcon(metier, fallback = '🔨') {
  const f = JOB_FILE[metier];
  if (!f) return JOB_EMOJI[metier] || fallback;
  const emo = JOB_EMOJI[metier] || fallback;
  return `<img class="job-ico" src="icons/metiers/${f}.png" alt="" title="${escapeHtml(metier)}" onerror="this.replaceWith(document.createTextNode('${emo}'))">`;
}

let IDX = null;
let loading = null;
let ctx = null; // { getCraft, saveCraft, toast, showView }

/* ------------------------------------------------------------ chargement */

export function loadGamedata() {
  if (IDX) return Promise.resolve(IDX);
  if (loading) return loading;
  const get = f => fetch(`data/${f}.json`, { cache: 'no-cache' }).then(r => {
    if (!r.ok) throw new Error(`${f}.json : ${r.status}`);
    return r.json();
  });
  loading = Promise.all(['data_item', 'data_ressource', 'data_bestiaire'].map(get))
    .then(([a, b, c]) => { IDX = buildIndex(a, b, c); return IDX; })
    .catch(e => { loading = null; throw e; });
  return loading;
}

async function ensureData(viewId) {
  const view = $(`#${viewId}`);
  const load = view.querySelector('.loading');
  const body = view.querySelector('.view-body');
  if (IDX) { load.hidden = true; body.hidden = false; return true; }
  load.hidden = false;
  body.hidden = true;
  load.textContent = 'Chargement des données du jeu…';
  try {
    await loadGamedata();
    load.hidden = true;
    body.hidden = false;
    return true;
  } catch (e) {
    load.innerHTML = `Impossible de charger les données du jeu (${escapeHtml(e.message)}).<br>
      <button class="btn small" type="button">Réessayer</button>`;
    load.querySelector('button').onclick = () => ensureData(viewId).then(ok => ok && (viewId === 'view-craft' ? renderCraft() : renderMonsters()));
    return false;
  }
}

/* ------------------------------------------------------------ petits rendus */

const rarityName = r => IDX?.raretes?.[r] || '';
// Icônes officielles (CDN Ankama) et portraits (wakfu.wiki.gg), chargés à la demande.
const ITEM_IMG = (gfx, size = 64) => `https://static.ankama.com/wakfu/portal/game/item/${size}/${gfx}.png`;
const MONSTER_IMG = (file, px = 80) => `https://wakfu.wiki.gg/images/thumb/${encodeURIComponent(file)}/${px}px-${encodeURIComponent(file)}`;
const imgFallback = `onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ico-ph'}))"`;
export function itemIcon(o, { size = 64, cls = '' } = {}) {
  const r = RARITY_CLASS[o?.rarete] || 'commun';
  if (!o?.gfx) return `<span class="ico ico-ph ${r} ${cls}"></span>`;
  return `<span class="ico ${r} ${cls}" title="${escapeHtml(rarityName(o.rarete))}"><img src="${ITEM_IMG(o.gfx, size)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" ${imgFallback}></span>`;
}
export function monsterPortrait(m, { px = 80, cls = '' } = {}) {
  if (!m?.image) return `<span class="portrait ph ${cls}" aria-hidden="true">${escapeHtml((m?.nom || '?')[0])}</span>`;
  return `<span class="portrait ${cls}"><img src="${MONSTER_IMG(m.image, px)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('ph');this.remove()"></span>`;
}
function itemLabel(o, { link = true } = {}) {
  if (!o) return '<span class="muted">?</span>';
  const inner = `${itemIcon(o)}<span class="lbl">${escapeHtml(o.nom)}</span>`;
  return link ? `<button class="item-link" type="button" data-item="${o.id}">${inner}</button>` : `<span class="item-name">${inner}</span>`;
}
let monsterNames = null;
function monsterByName(name) {
  if (!IDX) return null;
  if (!monsterNames) { monsterNames = new Map(); for (const m of IDX.monsters) if (!monsterNames.has(m.nom)) monsterNames.set(m.nom, m); }
  return monsterNames.get(name) || null;
}
// Niveaux de métier saisis par le joueur (Réglages) : renvoie son niveau s'il est trop bas, sinon null.
const myJobs = () => ctx?.jobs?.() || {};
function tooLow(metier, niveau) {
  const l = myJobs()[metier];
  return l != null && l < niveau ? l : null;
}

/* Regroupement des ressources à réunir (au choix, mémorisé sur l'appareil) :
 * par niveau (liste simple), par provenance (métier de récolte ou famille du monstre) ou par monstre. */
const GROUP_KEY = 'wakforge.craftGroup';
let groupMode = 'niveau';
try { groupMode = localStorage.getItem(GROUP_KEY) || 'niveau'; } catch { /* rien */ }
function monsterGroup(name) {
  const m = monsterByName(name);
  return { key: `m:${name}`, html: `<button class="link" type="button" data-monster="${escapeHtml(name)}" title="Voir le monstre">${m?.image ? monsterPortrait(m, { px: 40, cls: 'mini' }) : '⚔'} ${escapeHtml(name)}</button>` };
}
function groupOf(o, bought) {
  const harvest = (o.recolte || []).filter(h => h.metier !== 'Trappeur').sort((a, b) => a.niveau - b.niveau);
  const trap = (o.recolte || []).filter(h => h.metier === 'Trappeur').sort((a, b) => a.niveau - b.niveau);
  const drops = [...(o.drops || [])].sort((a, b) => (b.taux ?? 0) - (a.taux ?? 0));
  if (groupMode === 'monstre') {
    if (drops.length) return monsterGroup(drops[0].monstre);
    if (trap.length) return monsterGroup(trap[0].source);
  }
  if (harvest.length) return { key: `j:${harvest[0].metier}`, html: `${jobIcon(harvest[0].metier, '•')} ${escapeHtml(harvest[0].metier)}` };
  if (trap.length) return { key: 'j:Trappeur', html: `${jobIcon('Trappeur')} Trappeur` };
  if (drops.length) {
    const fam = monsterByName(drops[0].monstre)?.famille;
    return fam ? { key: `f:${fam}`, html: `⚔ ${escapeHtml(fam)}` } : monsterGroup(drops[0].monstre);
  }
  if (bought && mainRecipe(o)) return { key: 'z:craft', html: '🔨 Fabricables, mis dans les courses', last: 1 };
  return { key: 'z:market', html: 'Marché / autre (provenance inconnue)', last: 2 };
}
/** rows triés -> [{ g, rows }] (un seul groupe sans en-tête en mode « niveau »). */
function groupRows(rows, acheter) {
  if (groupMode === 'niveau') return [{ g: null, rows }];
  const map = new Map();
  for (const b of rows) {
    const g = groupOf(b.o, !!acheter[b.id]);
    if (!map.has(g.key)) map.set(g.key, { g, rows: [] });
    map.get(g.key).rows.push(b);
  }
  const left = x => x.rows.filter(b => b.missing > 0).length;
  return [...map.values()].sort((a, b) => (a.g.last || 0) - (b.g.last || 0) || (left(b) > 0) - (left(a) > 0)
    || b.rows.length - a.rows.length || a.g.key.localeCompare(b.g.key));
}
const groupCount = rows => { const n = rows.filter(b => b.missing > 0).length; return n ? `${n} à réunir` : 'tout est réuni ✓'; };

function srcHtml(s) {
  if (s.kind === 'recolte') {
    const low = tooLow(s.metier, s.niveau);
    return `<span class="src recolte${low != null ? ' low' : ''}" title="${escapeHtml(s.metier)} niveau ${s.niveau}${low != null ? ` (tu es niveau ${low})` : ''}">${jobIcon(s.metier, '•')} ${escapeHtml(s.metier)} ${s.niveau}`
      + `${s.source ? ` · ${escapeHtml(s.source)}` : ''}${s.taux ? ` (${s.taux} %)` : ''}${low != null ? ' 🔒' : ''}</span>`;
  }
  if (s.kind === 'drop') {
    const m = monsterByName(s.monstre);
    return `<button class="src drop" type="button" data-monster="${escapeHtml(s.monstre)}" title="Voir le monstre">${m?.image ? monsterPortrait(m, { px: 40, cls: 'mini' }) : '⚔'} ${escapeHtml(s.monstre)}${s.taux != null ? ` ${s.taux} %` : ''}</button>`;
  }
  if (s.kind === 'trappeur') {
    const m = monsterByName(s.monstre);
    return `<button class="src recolte" type="button" data-monster="${escapeHtml(s.monstre)}" title="Voir le monstre">${jobIcon('Trappeur')} ${m?.image ? monsterPortrait(m, { px: 40, cls: 'mini' }) : ''} Trappeur ${s.niveau} · ${escapeHtml(s.monstre)}</button>`;
  }
  if (s.kind === 'more') return `<span class="src more">+${s.count} ${escapeHtml(s.label || 'monstres')}</span>`;
  if (s.kind === 'recette') return `<span class="src recette">${jobIcon(s.metier, '🔨')} fabricable (${escapeHtml(s.metier)} ${s.niveau})</span>`;
  return '';
}

/* ------------------------------------------------------------ recherche (artisanat) */

let sugg = [];
let suggIdx = -1;

function renderCraftSuggest() {
  const input = $('#craftSearch');
  const box = $('#craftSuggest');
  sugg = searchItems(IDX, input.value, { limit: 10 });
  box.innerHTML = sugg.map((o, i) => {
    const r = mainRecipe(o);
    const meta = [o.type, `Niv. ${o.niveau}`, rarityName(o.rarete)].filter(Boolean).join(' · ');
    const chip = r ? `<span class="chip">${jobIcon(r.metier, '🔨')} ${escapeHtml(r.metier)} ${r.niveau}</span>` : '<span class="chip unknown">non fabricable</span>';
    return `<li role="option" data-i="${i}" aria-selected="${i === suggIdx}">
      <div class="s-main"><div class="s-name">${itemLabel(o, { link: false })}</div><div class="s-meta">${escapeHtml(meta)}</div></div>${chip}</li>`;
  }).join('');
  const open = sugg.length > 0 && document.activeElement === input;
  box.hidden = !open;
  box.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

function addTarget(o, qte = 1) {
  if (!o) return;
  if (!mainRecipe(o)) {
    openItem(o.id);
    ctx.toast(`${escapeHtml(o.nom)} ne se fabrique pas : voir sa provenance.`, 'warn');
    return;
  }
  const c = ctx.getCraft();
  const t = c.cibles.find(x => x.id === o.id);
  if (t) t.qte += qte; else c.cibles.push({ id: o.id, qte });
  ctx.saveCraft();
  renderCraft();
  ctx.toast(`<b>${escapeHtml(o.nom)}</b> ajouté à la liste.`, 'ok');
}

/* ------------------------------------------------------------ artisanat */

export async function renderCraft() {
  if (!(await ensureData('view-craft'))) return;
  renderCraftLists();
  const c = ctx.getCraft();
  c.cibles = c.cibles.filter(t => IDX.byId.has(t.id));
  const res = computeList(IDX, c.cibles, { stock: c.stock, buy: c.acheter });

  // objectifs
  $('#craftEmpty').hidden = c.cibles.length > 0;
  $('#craftResults').hidden = c.cibles.length === 0;
  $('#craftTargets').innerHTML = c.cibles.map(t => {
    const o = IDX.byId.get(t.id);
    const r = mainRecipe(o);
    return `<div class="target" data-id="${o.id}">
      <div class="t-main">${itemLabel(o)}<div class="s-meta">${escapeHtml(o.type)} · Niv. ${o.niveau} · ${jobIcon(r.metier, '')} ${escapeHtml(r.metier)} ${r.niveau}</div></div>
      <div class="stepper"><button type="button" data-step="-1" aria-label="Moins">−</button>
        <input type="number" min="1" max="9999" value="${t.qte}" data-qte aria-label="Quantité">
        <button type="button" data-step="1" aria-label="Plus">+</button></div>
      <button class="icon-btn del" type="button" data-remove title="Retirer" aria-label="Retirer"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </div>`;
  }).join('');
  if (!c.cibles.length) { renderOverlay(); return; }

  // résumé
  const missingCount = res.base.filter(b => b.missing > 0).length;
  const prix = ctx.prices();
  const cost = costIndex(IDX, prix);
  const toBuy = res.base.filter(b => b.missing > 0);
  const unpriced = toBuy.filter(b => !prix[b.id]).length;
  const left = toBuy.reduce((t, b) => t + (prix[b.id] || 0) * b.missing, 0);
  const jobs = Object.entries(res.jobs).sort((a, b) => b[1] - a[1]);
  const lowCrafts = res.crafts.filter(x => x.runs > 0 && tooLow(x.recipe.metier, x.recipe.niveau) != null).length;
  $('#craftSummary').innerHTML = `
    <div class="stat"><b>${res.base.length}</b><span>ressources</span></div>
    <div class="stat"><b>${missingCount}</b><span>encore à réunir</span></div>
    <div class="stat"><b>${res.crafts.filter(x => x.runs > 0).length}</b><span>fabrications</span></div>
    <div class="stat" title="Ce qui reste à réunir, au prix saisi dans la colonne Prix"><b>${left ? fmtN(Math.round(left)) : '—'}</b><span>kamas restants${unpriced && toBuy.length ? ` · ${unpriced} sans prix` : ''}</span></div>
    <div class="jobs">${jobs.map(([j, l]) => {
      const mine = myJobs()[j];
      const cls = mine == null ? '' : mine < l ? ' low' : ' ok';
      return `<button class="chip job${cls}" type="button" data-job="${escapeHtml(j)}" title="${mine == null ? 'Clique pour indiquer ton niveau' : `Ton niveau : ${mine}. Clique pour le changer`}">${jobIcon(j, '')} ${escapeHtml(j)} ${l}${mine != null && mine < l ? ` <span class="mine">· toi ${mine}</span>` : mine != null ? ' ✓' : ''}</button>`;
    }).join('')}${lowCrafts ? `<span class="jobs-warn">🔒 ${lowCrafts} fabrication${lowCrafts > 1 ? 's' : ''} au-dessus de ton niveau</span>`
      : !Object.keys(myJobs()).length ? '<span class="jobs-hint">Clique sur un métier pour indiquer ton niveau.</span>' : ''}</div>`;

  // ressources
  const hideDone = $('#craftHideDone').checked;
  const rows = res.base
    .map(b => ({ ...b, o: IDX.byId.get(b.id) }))
    .sort((a, b) => (b.missing > 0) - (a.missing > 0) || a.o.niveau - b.o.niveau || a.o._key.localeCompare(b.o._key));
  $('#craftGroup').value = groupMode;
  const groups = groupRows(rows, c.acheter);
  $('#craftBase').innerHTML = groups.map(({ g, rows: gr }) => {
    const shown = gr.filter(b => !hideDone || b.missing > 0);
    if (!shown.length) return '';
    return (g ? `<tr class="grp"><th colspan="6"><span class="grp-name">${g.html}</span><span class="grp-count">${groupCount(gr)}</span></th></tr>` : '')
      + shown.map(b => {
    const bought = !!c.acheter[b.id];
    const srcs = sourcesOf(b.o).filter(s => !(s.kind === 'recette' && !bought));
    const p = prix[b.id] || 0;
    const mk = bought ? cost(b.id).craft : null;
    const vs = mk != null && p ? (mk < p ? ` · <span class="cheaper">fabriquer : ${fmtK(mk)}/u, moins cher</span>` : ` · fabriquer : ${fmtK(mk)}/u`)
      : mk != null ? ` · fabriquer : ${fmtK(mk)}/u` : '';
    return `<tr class="${b.missing > 0 ? '' : 'done'}" data-id="${b.id}">
      <td class="name">${itemLabel(b.o)}<div class="sub">Niv. ${b.o.niveau} · ${escapeHtml(rarityName(b.o.rarete))}${bought ? ' · <button class="link" type="button" data-craft-again>fabriquer à nouveau</button>' : ''}${vs}</div></td>
      <td class="num"><b>${fmtN(b.need)}</b></td>
      <td class="num"><input class="have" type="number" min="0" value="${c.stock[b.id] || 0}" data-have aria-label="J'en ai"></td>
      <td class="num ${b.missing > 0 ? 'miss' : 'ok'}">${b.missing > 0 ? fmtN(b.missing) : '✓'}</td>
      <td class="num price"><input class="have" type="number" min="0" step="1" value="${p || ''}" placeholder="—" data-price aria-label="Prix unitaire en kamas" title="Prix unitaire (HDV) en kamas">${p && b.missing > 0 ? `<div class="sub">${fmtK(p * b.missing)}</div>` : ''}</td>
      <td class="where"><div class="srcs">${srcs.map(srcHtml).join('') || '<span class="muted small">provenance inconnue (marché)</span>'}</div></td>
    </tr>`;
      }).join('');
  }).join('') || '<tr><td colspan="6" class="empty-small">Tout est réuni 🎉</td></tr>';

  renderOverlay();

  // étapes
  $('#craftSteps').innerHTML = res.crafts.map(x => {
    const o = IDX.byId.get(x.id);
    const isTarget = c.cibles.some(t => t.id === x.id);
    const yieldQ = x.recipe.quantite || 1;
    const k = cost(x.id);
    let cmp = '';
    if (k.craft != null && k.buy != null) {
      cmp = k.buy < k.craft
        ? `<span class="cost cheaper">acheter : ${fmtK(k.buy)}/u, moins cher que fabriquer (${fmtK(k.craft)}/u)</span>`
        : `<span class="cost">fabriquer : ${fmtK(k.craft)}/u, moins cher qu'acheter (${fmtK(k.buy)}/u)</span>`;
    } else if (k.craft != null) cmp = `<span class="cost">fabriquer : ${fmtK(k.craft)}/u</span>`;
    const low = x.runs > 0 ? tooLow(x.recipe.metier, x.recipe.niveau) : null;
    return `<li class="${x.runs === 0 ? 'done' : ''}${low != null ? ' locked' : ''}" data-id="${x.id}">
      <span class="job"${low != null ? ` title="Tu es ${escapeHtml(x.recipe.metier)} niveau ${low} : il te faut le niveau ${x.recipe.niveau} (ou acheter l'objet)"` : ''}>${jobIcon(x.recipe.metier, '🔨')} ${escapeHtml(x.recipe.metier)} ${x.recipe.niveau}${low != null ? ` <span class="lvl-low">🔒 toi ${low}</span>` : ''}</span>
      <span class="what">${x.runs > 0 ? `<b>${fmtN(x.runs)}×</b>` : '<b>✓</b>'} ${itemLabel(o)}${yieldQ > 1 ? ` <span class="muted small">(${yieldQ} par fabrication)</span>` : ''}
        ${x.have ? `<span class="muted small">· ${fmtN(x.have)} déjà en stock</span>` : ''}${cmp}</span>
      <span class="step-actions">
        <input class="have" type="number" min="0" value="${c.stock[x.id] || 0}" data-have title="Déjà en stock" aria-label="Déjà en stock">
        <input class="have" type="number" min="0" step="1" value="${prix[x.id] || ''}" placeholder="Prix" data-price title="Prix unitaire à l'HDV (kamas), pour comparer avec la fabrication" aria-label="Prix unitaire en kamas">
        ${isTarget ? '' : '<button class="btn small ghost" type="button" data-buy title="Ne pas fabriquer : l\'ajouter aux courses">Acheter</button>'}
      </span>
    </li>`;
  }).join('');
}

/** Onglets des listes de craft (une liste par projet : « Panoplie 200 », « Reroll »…). */
function renderCraftLists() {
  const L = ctx.lists;
  const all = L.all();
  $('#craftLists').innerHTML = all.map(l => `<span class="list-tab${l.active ? ' active' : ''}">
      <button type="button" role="tab" data-list="${escapeHtml(l.id)}" aria-selected="${l.active}" title="${l.active ? 'Double-clic pour renommer' : 'Ouvrir cette liste'}">${escapeHtml(l.nom)}<span class="list-count">${l.count}</span></button>
      ${l.active ? `<button class="list-act" type="button" data-list-rename title="Renommer" aria-label="Renommer la liste">✎</button>
      ${all.length > 1 ? '<button class="list-act" type="button" data-list-delete title="Supprimer cette liste" aria-label="Supprimer la liste">×</button>' : ''}` : ''}
    </span>`).join('')
    + (all.length < L.max ? '<button class="btn small ghost list-new" type="button" data-list-new title="Créer une autre liste de craft">+ Nouvelle liste</button>' : '');
}

function bindCraftLists() {
  const L = ctx.lists;
  const activeId = () => L.all().find(l => l.active)?.id;
  const rename = () => {
    const nom = prompt('Nom de la liste :', L.activeName());
    if (nom != null && L.rename(activeId(), nom)) renderCraft();
  };
  const box = $('#craftLists');
  box.addEventListener('click', e => {
    const tab = e.target.closest('[data-list]');
    if (tab) { if (L.switch(tab.dataset.list)) renderCraft(); return; }
    if (e.target.closest('[data-list-rename]')) { rename(); return; }
    if (e.target.closest('[data-list-new]')) {
      const nom = prompt('Nom de la nouvelle liste :', `Liste ${L.all().length + 1}`);
      if (nom != null && L.create(nom)) { renderCraft(); $('#craftSearch').focus(); }
      return;
    }
    if (e.target.closest('[data-list-delete]')) {
      const nom = L.activeName();
      const undo = L.remove(activeId());
      if (!undo) return;
      renderCraft();
      ctx.toastUndo(`Liste <b>${escapeHtml(nom)}</b> supprimée.`, () => { undo(); renderCraft(); });
    }
  });
  box.addEventListener('dblclick', e => { if (e.target.closest('[data-list][aria-selected="true"]')) rename(); });
}

function bindCraft() {
  bindCraftLists();
  const input = $('#craftSearch');
  input.addEventListener('input', () => {
    // un lien de partage collé dans la recherche importe la liste
    if (/#liste=/.test(input.value) && ctx.importShared?.(input.value)) { input.value = ''; renderCraftSuggest(); return; }
    suggIdx = input.value.trim() ? 0 : -1;
    renderCraftSuggest();
  });
  input.addEventListener('focus', () => IDX && renderCraftSuggest());
  input.addEventListener('blur', () => setTimeout(() => { $('#craftSuggest').hidden = true; }, 150));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); suggIdx = Math.min(sugg.length - 1, suggIdx + 1); renderCraftSuggest(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); suggIdx = Math.max(0, suggIdx - 1); renderCraftSuggest(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const o = sugg[Math.max(0, suggIdx)];
      if (o) { addTarget(o, Math.max(1, +$('#craftQty').value || 1)); input.value = ''; $('#craftQty').value = 1; suggIdx = -1; renderCraftSuggest(); }
    } else if (e.key === 'Escape') { input.value = ''; renderCraftSuggest(); }
  });
  $('#craftSuggest').addEventListener('mousedown', e => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    addTarget(sugg[+li.dataset.i], Math.max(1, +$('#craftQty').value || 1));
    input.value = ''; $('#craftQty').value = 1; renderCraftSuggest();
  });

  $('#craftTargets').addEventListener('click', e => {
    const row = e.target.closest('.target');
    if (!row) return;
    const c = ctx.getCraft();
    const t = c.cibles.find(x => x.id === +row.dataset.id);
    if (!t) return;
    if (e.target.closest('[data-step]')) {
      t.qte = Math.max(1, t.qte + +e.target.closest('[data-step]').dataset.step);
      ctx.saveCraft(); renderCraft();
    } else if (e.target.closest('[data-remove]')) {
      c.cibles = c.cibles.filter(x => x !== t);
      ctx.saveCraft(); renderCraft();
    }
  });
  $('#craftTargets').addEventListener('change', e => {
    if (!e.target.matches('[data-qte]')) return;
    const c = ctx.getCraft();
    const t = c.cibles.find(x => x.id === +e.target.closest('.target').dataset.id);
    if (t) { t.qte = Math.max(1, Math.min(9999, Math.floor(+e.target.value) || 1)); ctx.saveCraft(); renderCraft(); }
  });

  const onHave = e => {
    if (!e.target.matches('[data-have]')) return;
    const id = +e.target.closest('[data-id]').dataset.id;
    const c = ctx.getCraft();
    const v = Math.max(0, Math.floor(+e.target.value) || 0);
    if (v) c.stock[id] = v; else delete c.stock[id];
    ctx.saveCraft(); renderCraft();
  };
  const onPrice = e => {
    if (!e.target.matches('[data-price]')) return;
    const id = +e.target.closest('[data-id]').dataset.id;
    const prix = ctx.prices();
    const v = Math.min(1e10, Math.max(0, Math.round(+e.target.value) || 0));
    if (v) prix[id] = v; else delete prix[id];
    ctx.saveCraft(); renderCraft();
  };
  for (const box of [$('#craftBase'), $('#craftSteps')]) {
    box.addEventListener('change', onHave);
    box.addEventListener('change', onPrice);
  }
  $('#craftSteps').addEventListener('click', e => {
    if (!e.target.closest('[data-buy]')) return;
    const id = +e.target.closest('[data-id]').dataset.id;
    ctx.getCraft().acheter[id] = true;
    ctx.saveCraft(); renderCraft();
    ctx.toast(`${escapeHtml(IDX.byId.get(id).nom)} passe dans les courses (à acheter ou réunir tel quel).`);
  });
  $('#craftBase').addEventListener('click', e => {
    if (!e.target.closest('[data-craft-again]')) return;
    const id = +e.target.closest('[data-id]').dataset.id;
    delete ctx.getCraft().acheter[id];
    ctx.saveCraft(); renderCraft();
  });
  $('#craftHideDone').addEventListener('change', renderCraft);
  $('#craftGroup').addEventListener('change', e => {
    groupMode = e.target.value;
    try { localStorage.setItem(GROUP_KEY, groupMode); } catch { /* rien */ }
    renderCraft();
  });
  $('#craftSummary').addEventListener('click', e => {
    const chip = e.target.closest('[data-job]');
    if (!chip) return;
    const j = chip.dataset.job;
    const v = prompt(`Ton niveau en ${j} (vide pour ne pas l'indiquer) :`, myJobs()[j] || '');
    if (v == null) return;
    ctx.setJob(j, v);
    renderCraft();
  });
  $('#craftShare').addEventListener('click', async () => {
    const c = ctx.getCraft();
    if (!c.cibles.length) return;
    const url = `${ctx.shareBase()}#liste=${encodeShare(ctx.lists.activeName(), c.cibles)}`;
    try {
      await navigator.clipboard.writeText(url);
      ctx.toast('Lien de la liste copié : envoie-le, il s\'ouvre sur le site et s\'importe en un clic.', 'ok');
    } catch { prompt('Lien de partage de la liste :', url); }
  });
  $('#craftOverlay').addEventListener('click', () => openOverlay());
  $('#craftClear').addEventListener('click', () => {
    const c = ctx.getCraft();
    if (!c.cibles.length) return;
    const saved = JSON.parse(JSON.stringify(c));
    c.cibles = []; c.stock = {}; c.acheter = {};
    ctx.saveCraft(); renderCraft();
    ctx.toastUndo('Liste vidée.', () => { Object.assign(c, saved); ctx.saveCraft(); renderCraft(); });
  });
  $('#craftCopy').addEventListener('click', async () => {
    const c = ctx.getCraft();
    const res = computeList(IDX, c.cibles, { stock: c.stock, buy: c.acheter });
    const lines = [...(ctx.lists.all().length > 1 ? [`Liste : ${ctx.lists.activeName()}`, ''] : []), 'Objectifs :', ...c.cibles.map(t => `- ${t.qte} × ${IDX.byId.get(t.id).nom}`), '', 'À réunir :'];
    const prix = ctx.prices();
    let total = 0;
    for (const b of res.base.filter(x => x.missing > 0)) {
      const p = prix[b.id];
      total += (p || 0) * b.missing;
      lines.push(`- ${b.missing} × ${IDX.byId.get(b.id).nom}${p ? ` (${fmtK(p * b.missing)})` : ''}`);
    }
    if (total) lines.push(`Total : ${fmtK(total)}`);
    lines.push('', 'Fabrications :');
    for (const x of res.crafts.filter(y => y.runs > 0)) lines.push(`- ${x.runs} × ${IDX.byId.get(x.id).nom} (${x.recipe.metier} ${x.recipe.niveau})`);
    try { await navigator.clipboard.writeText(lines.join('\n')); ctx.toast('Liste copiée.', 'ok'); }
    catch { ctx.toast('Copie impossible dans ce navigateur.', 'error'); }
  });
}

/* ------------------------------------------------------------ monstres */

let monsterLimit = 40;
let openMonsters = new Set();

export async function renderMonsters() {
  if (!(await ensureData('view-monsters'))) return;
  const q = norm($('#monsterSearch').value);
  const type = $('#monsterType').value;
  let list = IDX.monsters;
  let byItem = null;
  if (q) {
    // monstres dont le nom, la famille ou la zone correspond… ou qui droppent un objet correspondant
    const itemIds = new Set(searchItems(IDX, q, { limit: 400 }).filter(o => o._key.includes(q)).map(o => o.id));
    byItem = itemIds;
    list = list.filter(m => m._key.includes(q) || m._extra.includes(q) || monsterItemIds(m).some(id => itemIds.has(id)));
  }
  if (type) list = list.filter(m => (m.type || 'Monstre') === type);
  $('#monsterCount').textContent = `${fmtN(list.length)} monstre${list.length > 1 ? 's' : ''}`;
  const shown = list.slice(0, monsterLimit);
  $('#monsterList').innerHTML = shown.map(m => {
    const lv = m.niveau_min != null ? (m.niveau_max && m.niveau_max !== m.niveau_min ? `${m.niveau_min}–${m.niveau_max}` : `${m.niveau_min}`) : '?';
    const open = openMonsters.has(m._i) || shown.length === 1;
    const drops = [...(m.drops || [])].sort((a, b) => (b.taux ?? 0) - (a.taux ?? 0));
    const archi = m.type === 'Archimonstre' ? ctx.archiInfo?.(m) : null;
    const match = byItem ? [...drops, ...(m.trappeur?.items || []).map(t => ({ ...t, trap: true }))].filter(d => d.id && byItem.has(d.id)) : [];
    return `<article class="mcard ${open ? 'open' : ''}" data-m="${m._i}">
      <button class="mhead" type="button" aria-expanded="${open}">
        ${monsterPortrait(m)}
        <span class="mname">${escapeHtml(m.nom)}</span>${m.nom_en ? `<span class="men">${escapeHtml(m.nom_en)}</span>` : ''}
        ${m.type && m.type !== 'Monstre' ? `<span class="tag ${m.type === 'Archimonstre' ? 'perso' : 'custom'}">${escapeHtml(m.type)}</span>` : ''}
        ${archi ? `<span class="chip ${archi.running ? 'running' : archi.duration ? '' : 'spawn'}">${archi.running ? 'en cours' : escapeHtml(archi.duration || archi.spawn || 'durée ?')}</span>` : ''}
        <span class="mlv">Niv. ${lv}</span>
        <span class="mmeta">${escapeHtml([m.famille, (m.zones || []).slice(0, 2).join(', ')].filter(Boolean).join(' · '))}</span>
        ${match.length ? `<span class="mmatch">${match.slice(0, 2).map(d => (d.trap ? '🪤 ' : 'droppe ') + escapeHtml(IDX.byId.get(d.id).nom) + (d.taux != null ? ` (${d.taux} %)` : '')).join(', ')}</span>` : ''}
        <span class="chev" aria-hidden="true">▾</span>
      </button>
      ${open ? `<div class="mbody">
        ${archi ? `<div class="archi-bar">
          <span>⏱ ${archi.duration ? `Réapparition : <b>${escapeHtml(archi.duration)}</b>${archi.overridden ? ' <span class="tag perso">durée perso</span>' : ''}` : escapeHtml(archi.spawn ? `Pas de timer (${archi.spawn})` : 'Durée inconnue')}</span>
          <span class="archi-actions">
            <button class="btn small primary" type="button" data-archi-launch="${escapeHtml(archi.id)}">${archi.running ? 'Relancer le timer' : 'Lancer le timer'}</button>
            <button class="btn small" type="button" data-archi-edit="${escapeHtml(archi.id)}">Modifier la durée</button>
          </span>
        </div>` : ''}
        ${m.zones?.length ? `<p class="small"><span class="muted">Zones :</span> ${escapeHtml(m.zones.join(', '))}</p>` : ''}
        ${drops.length ? `<h4>Drops</h4><ul class="drops">${drops.map(d => {
          const o = d.id && IDX.byId.get(d.id);
          return `<li>${o ? itemLabel(o) : `<span class="muted" title="${escapeHtml(d.nom_en)}">${escapeHtml(d.nom || `${d.nom_en} (en)`)}</span>`}<span class="rate">${d.taux != null ? `${d.taux} %` : ''}</span></li>`;
        }).join('')}</ul>` : '<p class="muted small">Aucun drop connu.</p>'}
        ${m.trappeur ? `<h4>${jobIcon('Trappeur')} Trappeur ${m.trappeur.niveau}</h4><ul class="drops">${m.trappeur.items.map(d => {
          const o = d.id && IDX.byId.get(d.id);
          return `<li>${o ? itemLabel(o) : escapeHtml(d.nom || d.nom_en || '?')}<span class="rate">${escapeHtml(d.action || '')}</span></li>`;
        }).join('')}</ul>` : ''}
      </div>` : ''}
    </article>`;
  }).join('') || '<p class="empty-small">Aucun monstre ne correspond.</p>';
  $('#monsterMore').hidden = list.length <= monsterLimit;
}

function bindMonsters() {
  let tmr;
  $('#monsterSearch').addEventListener('input', () => {
    clearTimeout(tmr);
    tmr = setTimeout(() => { monsterLimit = 40; openMonsters = new Set(); renderMonsters(); }, 120);
  });
  $('#monsterType').addEventListener('change', () => { monsterLimit = 40; renderMonsters(); });
  $('#monsterMore').addEventListener('click', () => { monsterLimit += 60; renderMonsters(); });
  $('#monsterList').addEventListener('click', e => {
    if (e.target.closest('[data-item]')) return;
    const launch = e.target.closest('[data-archi-launch]');
    if (launch) { ctx.archiLaunch?.(launch.dataset.archiLaunch); return; }
    const edit = e.target.closest('[data-archi-edit]');
    if (edit) { ctx.archiEdit?.(edit.dataset.archiEdit); return; }
    const head = e.target.closest('.mhead');
    if (!head) return;
    const i = +head.closest('.mcard').dataset.m;
    if (openMonsters.has(i)) openMonsters.delete(i); else openMonsters.add(i);
    renderMonsters();
  });
}

export function showMonster(name) {
  $('#monsterSearch').value = name;
  $('#monsterType').value = '';
  monsterLimit = 40;
  openMonsters = new Set();
  const m = IDX?.monsters.find(x => x.nom === name);
  if (m) openMonsters.add(m._i);
  ctx.showView('monsters');
}

/* ------------------------------------------------------------ fiche objet */

export async function openItem(id) {
  await loadGamedata();
  const o = IDX.byId.get(id);
  if (!o) return;
  const dlg = $('#itemDlg');
  const r = mainRecipe(o);
  const used = [...(IDX.usedIn.get(id) || [])].map(x => IDX.byId.get(x)).filter(Boolean)
    .sort((a, b) => a.niveau - b.niveau);
  const drops = [...(o.drops || [])].sort((a, b) => (b.taux ?? 0) - (a.taux ?? 0));
  const harvest = (o.recolte || []);
  $('#itemBody').innerHTML = `
    <div class="item-head">
      ${itemIcon(o, { size: 115, cls: 'big' })}
      <div>
        <span class="rar-badge ${RARITY_CLASS[o.rarete] || 'commun'}">${escapeHtml(rarityName(o.rarete))}</span>
        <h2>${escapeHtml(o.nom)}</h2>
        <p class="muted small">${escapeHtml(o.type)} · Niveau ${o.niveau}${o.nom_en ? ` · <i>${escapeHtml(o.nom_en)}</i>` : ''}</p>
      </div>
    </div>
    ${o.stats?.length ? `<div class="stats">${o.stats.map(s => `<span>${escapeHtml(s)}</span>`).join('')}</div>` : ''}
    ${(o.recettes || []).map(rec => `<section><h4>${jobIcon(rec.metier, '🔨')} Recette · ${escapeHtml(rec.metier)} ${rec.niveau}${rec.amelioration ? ' · amélioration' : ''}${rec.quantite > 1 ? ` · donne ${rec.quantite}` : ''}</h4>
      <ul class="drops">${rec.ingredients.map(([iid, q]) => `<li>${itemLabel(IDX.byId.get(iid))}<span class="rate">× ${q}</span></li>`).join('')}</ul></section>`).join('')}
    ${harvest.length ? `<section><h4>Récolte</h4><div class="srcs">${harvest.slice(0, 15).map(h => srcHtml(h.metier === 'Trappeur' ? { kind: 'trappeur', niveau: h.niveau, monstre: h.source } : { kind: 'recolte', ...h })).join('')}${harvest.length > 15 ? `<span class="src more">+${harvest.length - 15}</span>` : ''}</div></section>` : ''}
    ${drops.length ? `<section><h4>Drops (${drops.length})</h4><div class="srcs">${drops.slice(0, 15).map(d => srcHtml({ kind: 'drop', ...d })).join('')}${drops.length > 15 ? `<span class="src more">+${drops.length - 15}</span>` : ''}</div></section>` : ''}
    ${!r && !harvest.length && !drops.length ? '<p class="muted small">Provenance inconnue dans les données (boutique, quête, marché…).</p>' : ''}
    ${used.length ? `<section><h4>Utilisé dans (${used.length})</h4><div class="used">${used.slice(0, 30).map(u => itemLabel(u)).join('')}${used.length > 30 ? `<span class="muted small">+${used.length - 30}</span>` : ''}</div></section>` : ''}
    <div class="dlg-actions">
      ${r ? '<button class="btn primary" type="button" data-add>+ Ajouter à la liste</button>' : ''}
      <button class="btn" type="button" data-close>Fermer</button>
    </div>`;
  const add = $('#itemBody [data-add]');
  if (add) add.onclick = () => { addTarget(o, 1); dlg.close(); };
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}

/* ------------------------------------------------------------ init */

export { decodeShare };

export function initCraft(context) {
  ctx = context;
  bindCraft();
  bindMonsters();
  // liens objet / monstre partout dans l'appli
  document.addEventListener('click', e => {
    const it = e.target.closest('[data-item]');
    if (it) { e.preventDefault(); openItem(+it.dataset.item); return; }
    const mo = e.target.closest('[data-monster]');
    if (mo) {
      e.preventDefault();
      $('#itemDlg').open && $('#itemDlg').close();
      showMonster(mo.dataset.monster);
    }
  });
}

export function gamedataInfo() {
  return IDX ? { version: IDX.version, maj: IDX.maj } : null;
}

/* ------------------------------------------------------------ overlay (liste de courses compacte)
 * Trois façons de l'afficher :
 *  - appli PC : la fenêtre passe en petit format, toujours au premier plan (transparence réglable) ;
 *  - Chrome / Edge : une fenêtre « Picture-in-Picture » qui reste au-dessus des autres applis ;
 *  - autres navigateurs : la page elle-même passe en vue compacte.
 */

const OVL_KEY = 'wakforge.overlay.v1';
let ovl = { mode: null, root: null, win: null };
let ovlPrefs = { hideDone: false, opacity: 100 };
try { Object.assign(ovlPrefs, JSON.parse(localStorage.getItem(OVL_KEY) || localStorage.getItem('wakup.overlay.v1') || '{}')); } catch { /* rien */ }
const saveOvlPrefs = () => { try { localStorage.setItem(OVL_KEY, JSON.stringify(ovlPrefs)); } catch { /* rien */ } };

export const overlayOpen = () => !!ovl.mode;

function srcShort(s) {
  if (s.kind === 'recolte') return `${jobIcon(s.metier, '')} ${escapeHtml(s.metier)} ${s.niveau}${s.source ? ` · ${escapeHtml(s.source)}` : ''}`;
  if (s.kind === 'trappeur') return `${jobIcon('Trappeur', '')} ${escapeHtml(s.monstre)}`;
  if (s.kind === 'drop') return `⚔ ${escapeHtml(s.monstre)}${s.taux != null ? ` ${s.taux} %` : ''}`;
  if (s.kind === 'more') return `+${s.count}`;
  if (s.kind === 'recette') return `${jobIcon(s.metier, '🔨')} ${escapeHtml(s.metier)} ${s.niveau}`;
  return '';
}

export async function openOverlay() {
  if (ovl.mode) { ovl.win?.focus?.(); return; }
  if (!(await ensureData('view-craft'))) return;
  const pip = !ctx.native?.on && window.documentPictureInPicture;
  if (pip) {
    try {
      const win = await window.documentPictureInPicture.requestWindow({ width: 360, height: 580 });
      const head = win.document.head;
      head.insertAdjacentHTML('beforeend', '<meta name="referrer" content="no-referrer"><title>Wak\'Forge – courses</title>');
      head.append(Object.assign(win.document.createElement('base'), { href: new URL('.', location.href).href }));
      // copie des styles : règles recopiées telles quelles (même origine), lien sinon (polices Google)
      for (const sheet of document.styleSheets) {
        try {
          const style = win.document.createElement('style');
          style.textContent = [...sheet.cssRules].map(r => r.cssText).join('\n');
          head.append(style);
        } catch {
          if (sheet.href) {
            const link = win.document.createElement('link');
            link.rel = 'stylesheet'; link.href = sheet.href;
            head.append(link);
          }
        }
      }
      win.document.body.className = 'ovl-pip';
      const root = win.document.createElement('div');
      root.id = 'overlay';
      win.document.body.append(root);
      ovl = { mode: 'pip', root, win };
      win.addEventListener('pagehide', () => { ovl = { mode: null, root: null, win: null }; ctx.onOverlay?.(false); });
      bindOverlay(root);
      renderOverlay();
      ctx.onOverlay?.(true);
      return;
    } catch (e) {
      console.warn('Picture-in-Picture indisponible', e);
    }
  }
  const root = $('#overlay');
  root.hidden = false;
  document.body.classList.add('overlay-mode');
  ovl = { mode: 'inline', root, win: null };
  if (!root.dataset.bound) { bindOverlay(root); root.dataset.bound = '1'; }
  ctx.native?.overlay(true, Math.round(ovlPrefs.opacity * 2.55));
  renderOverlay();
  ctx.onOverlay?.(true);
}

export function closeOverlay() {
  if (ovl.mode === 'pip') { ovl.win.close(); return; }
  if (ovl.mode !== 'inline') return;
  ovl.root.hidden = true;
  ovl.root.innerHTML = '';
  document.body.classList.remove('overlay-mode');
  ctx.native?.overlay(false, 255);
  ovl = { mode: null, root: null, win: null };
  ctx.onOverlay?.(false);
  ctx.showView?.('craft');
}

function setStock(id, v) {
  const c = ctx.getCraft();
  v = Math.max(0, Math.floor(v) || 0);
  if (v) c.stock[id] = v; else delete c.stock[id];
  ctx.saveCraft();
  renderCraft();
}

function bindOverlay(root) {
  root.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-ovl-close]')) { closeOverlay(); return; }
    if (b.matches('[data-ovl-hide]')) { ovlPrefs.hideDone = !ovlPrefs.hideDone; saveOvlPrefs(); renderOverlay(); return; }
    const li = b.closest('[data-id]');
    if (!li) return;
    const id = +li.dataset.id;
    const have = ctx.getCraft().stock[id] || 0;
    const need = +li.dataset.need;
    const step = e.shiftKey ? 10 : 1;
    if (b.matches('[data-inc]')) setStock(id, have + step);
    else if (b.matches('[data-dec]')) setStock(id, have - step);
    else if (b.matches('[data-done]')) setStock(id, have >= need ? 0 : need);
  });
  root.addEventListener('input', e => {
    if (!e.target.matches('[data-ovl-opacity]')) return;
    ovlPrefs.opacity = +e.target.value;
    saveOvlPrefs();
    ctx.native?.overlay(true, Math.round(ovlPrefs.opacity * 2.55));
    const out = root.querySelector('[data-ovl-opacity-val]');
    if (out) out.textContent = `${ovlPrefs.opacity} %`;
  });
}

export function renderOverlay() {
  if (!ovl.mode || !IDX) return;
  const root = ovl.root;
  const c = ctx.getCraft();
  const res = computeList(IDX, c.cibles, { stock: c.stock, buy: c.acheter });
  const rows = res.base
    .map(b => ({ ...b, o: IDX.byId.get(b.id) }))
    .sort((a, b) => (b.missing > 0) - (a.missing > 0) || a.o.niveau - b.o.niveau || a.o._key.localeCompare(b.o._key));
  const left = rows.filter(b => b.missing > 0).length;
  const shown = rows.filter(b => !ovlPrefs.hideDone || b.missing > 0);
  const targets = c.cibles.map(t => `${fmtN(t.qte)}× ${escapeHtml(IDX.byId.get(t.id).nom)}`).join(' · ');
  const scrollTop = root.querySelector('.ovl-list')?.scrollTop || 0;
  root.innerHTML = `<div class="ovl">
    <header class="ovl-head">
      <div class="ovl-title"><b>${ctx.lists.all().length > 1 ? escapeHtml(ctx.lists.activeName()) : 'Liste de courses'}</b><span>${rows.length ? (left ? `${left} sur ${rows.length} à réunir` : 'tout est réuni 🎉') : 'vide'}</span></div>
      <button class="ovl-btn ${ovlPrefs.hideDone ? 'on' : ''}" type="button" data-ovl-hide title="${ovlPrefs.hideDone ? 'Afficher' : 'Masquer'} ce que j'ai déjà" aria-pressed="${ovlPrefs.hideDone}">✓</button>
      ${ovl.mode === 'pip' ? '' : '<button class="ovl-btn" type="button" data-ovl-close title="Revenir à l\'appli complète">⤢</button>'}
    </header>
    ${targets ? `<p class="ovl-targets" title="${targets}">${targets}</p>` : ''}
    <ul class="ovl-list">${groupRows(shown, c.acheter).map(({ g, rows: gr }) => (g ? `<li class="ovl-group"><span>${g.html.replace(/<\/?button[^>]*>/g, '')}</span><span class="grp-count">${groupCount(gr)}</span></li>` : '') + gr.map(b => {
      const have = c.stock[b.id] || 0;
      const done = b.missing <= 0;
      const srcs = sourcesOf(b.o).filter(s => !(s.kind === 'recette' && !c.acheter[b.id])).slice(0, 2).map(srcShort).filter(Boolean);
      return `<li class="${done ? 'done' : ''}" data-id="${b.id}" data-need="${b.need}">
        ${itemIcon(b.o, { size: 42 })}
        <div class="ovl-main"><div class="ovl-name" title="${escapeHtml(b.o.nom)}">${escapeHtml(b.o.nom)}</div>
          <div class="ovl-src">${srcs.join(' · ') || 'marché'}</div></div>
        <div class="ovl-qty">
          <button type="button" data-dec title="−1 (Maj : −10)" aria-label="Moins">−</button>
          <span class="ovl-count"><b>${fmtN(Math.min(have, b.need))}</b>/${fmtN(b.need)}</span>
          <button type="button" data-inc title="+1 (Maj : +10)" aria-label="Plus">+</button>
        </div>
        <button class="ovl-done" type="button" data-done title="${done ? 'Remettre à zéro' : 'J\'ai tout'}" aria-label="${done ? 'Remettre à zéro' : 'J\'ai tout'}">${done ? '✓' : '○'}</button>
      </li>`;
    }).join('')).join('') || `<li class="ovl-empty">${rows.length ? 'Tout est réuni 🎉' : (ctx.native?.on ? 'Liste vide : dans WAKFU, survole un objet et appuie sur Ctrl+D pour l\'ajouter.' : 'Ajoute des objets dans l\'onglet Craft.')}</li>`}</ul>
    ${ctx.native?.on ? `<footer class="ovl-foot"><label>Opacité <input type="range" min="40" max="100" step="5" value="${ovlPrefs.opacity}" data-ovl-opacity></label><span data-ovl-opacity-val>${ovlPrefs.opacity} %</span></footer>` : ''}
  </div>`;
  const list = root.querySelector('.ovl-list');
  if (list) list.scrollTop = scrollTop;
}

/* ------------------------------------------------------------ scan d'objet (Ctrl+D dans le jeu, appli PC)
 * L'appli PC capture l'écran autour de la souris et le lit avec l'OCR de Windows ;
 * ici on retrouve l'objet à partir des lignes lues, puis on l'ajoute à la liste.
 */

// clé de comparaison tolérante aux erreurs d'OCR : sans accents, apostrophes ni ponctuation
const scanKey = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/['’`´]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

let scanIdx = null;
function scanIndex() {
  if (scanIdx) return scanIdx;
  const byKey = new Map();
  for (const o of IDX.searchable) {
    const k = scanKey(o.nom);
    if (k.length < 3) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(o);
  }
  scanIdx = { byKey, keys: [...byKey.keys()] };
  return scanIdx;
}

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Trouve le nom d'objet le plus probable parmi les lignes lues. Exporté pour les tests. */
export function matchScan(lines) {
  const { byKey, keys } = scanIndex();
  const raw = (lines || []).map(scanKey).filter(l => l.length >= 3);
  // un nom long peut être coupé sur deux lignes dans l'infobulle
  const cands = raw.map((l, i) => ({ l, i }));
  raw.forEach((l, i) => { if (raw[i + 1]) cands.push({ l: `${l} ${raw[i + 1]}`, i }); });
  let best = null;
  const offer = (key, score, i) => {
    if (!best || score > best.score || (score === best.score && i < best.i)) best = { key, score, i };
  };
  for (const { l, i } of cands) {
    if (byKey.has(l)) { offer(l, 1000 + l.length, i); continue; }
    for (const k of keys) {
      if (k.length >= 5 && l.length > k.length && ` ${l} `.includes(` ${k} `)) offer(k, 500 + k.length, i);
    }
    if (l.length >= 5) {
      const max = Math.max(1, Math.floor(l.length / 8));
      for (const k of keys) {
        if (k.length < 5 || Math.abs(k.length - l.length) > max) continue;
        const d = lev(l, k, max);
        if (d <= max) offer(k, 300 + k.length - 20 * d, i);
      }
    }
  }
  return best ? byKey.get(best.key) : null;
}

/* Fenêtre de scan : l'appli PC ouvre une petite fenêtre séparée (scan.html) à côté de la souris.
 * Ici on retrouve l'objet et on lui envoie quoi afficher ; l'objet choisi revient par wfScanAdd
 * et la liste se met à jour en arrière-plan (ou dans l'overlay), sans ramener l'appli devant. */

/** Rareté écrite dans l'infobulle (« Légendaire »…) : sert à présélectionner la bonne version. */
function guessVersion(versions, lines) {
  const text = ` ${(lines || []).map(scanKey).join(' ')} `;
  const i = versions.findIndex(v => {
    const k = scanKey(rarityName(v.rarete));
    return k && text.includes(` ${k} `);
  });
  return i;
}

/** Composants de la liste active (ressources et fabrications intermédiaires) : id -> { need, have }. */
function listComponents() {
  const c = ctx.getCraft();
  const res = computeList(IDX, c.cibles, { stock: c.stock, buy: c.acheter });
  const comp = new Map();
  for (const b of res.base) comp.set(b.id, { need: b.need, have: c.stock[b.id] || 0 });
  for (const x of res.crafts) if (!c.cibles.some(t => t.id === x.id)) comp.set(x.id, { need: x.need, have: c.stock[x.id] || 0 });
  return comp;
}

function scanChoice(versions, lines, comp, mode = '') {
  const inList = new Map(ctx.getCraft().cibles.map(t => [t.id, t.qte]));
  let sel = guessVersion(versions, lines);
  if (sel < 0) sel = Math.max(0, versions.findIndex(v => comp.has(v.id)));
  const labels = versions.map(v => rarityName(v.rarete) || 'Commun');
  return {
    state: 'choose',
    mode,
    sel,
    versions: versions.map((o, i) => {
      const r = mainRecipe(o);
      const k = comp.get(o.id);
      const dup = labels.filter(l => l === labels[i]).length > 1;
      return {
        id: o.id,
        nom: o.nom,
        label: labels[i] + (dup ? ` · Niv. ${o.niveau}` : ''),
        cls: RARITY_CLASS[o.rarete] || 'commun',
        icon: itemIcon(o, { cls: 'big' }),
        meta: `${escapeHtml(o.type)} · Niv. ${o.niveau}${r ? ` · ${jobIcon(r.metier, '')} ${escapeHtml(r.metier)} ${r.niveau}` : ''}`,
        inList: inList.get(o.id) || 0,
        craftable: !!r,
        comp: k ? { need: k.need, have: k.have, missing: Math.max(0, k.need - k.have) } : null,
      };
    }),
  };
}

// réponses de la fenêtre de scan (appli PC)
window.wfScanAdd = (id, qte) => addTarget(IDX?.byId.get(id), Math.min(9999, Math.max(1, Math.floor(qte) || 1)));
window.wfScanItem = id => openItem(id);
// « J'en ai » : la ressource scannée s'ajoute au stock de la liste active
window.wfScanHave = (id, qte) => {
  const o = IDX?.byId.get(id);
  if (!o) return;
  const c = ctx.getCraft();
  c.stock[id] = Math.min(999999, (c.stock[id] || 0) + Math.max(1, Math.floor(qte) || 1));
  ctx.saveCraft();
  renderCraft();
};

export async function handleScan(r) {
  if (!r) return;
  const win = !!ctx.native?.scanShow && window.nativeScanShow;
  const tell = (msg, kind, plain, itemId) => {
    if (win) { ctx.native.scanShow({ state: 'msg', html: msg, kind, itemId }); return; }
    ctx.toast(msg, kind);
    if (!document.hasFocus()) ctx.native?.notify("Wak'Forge", plain);
  };
  if (r.pending) { if (!win) ctx.toast('Scan de l\'objet…'); return; }
  if (r.error) { tell(escapeHtml(r.error), 'error', r.error); return; }
  try { await loadGamedata(); } catch { tell('Données du jeu indisponibles.', 'error', 'Données du jeu indisponibles.'); return; }
  const found = matchScan(r.lines);
  if (!found) {
    tell('Aucun objet reconnu : place la souris sur l\'objet pour afficher son infobulle, puis refais Ctrl+D.', 'warn', 'Aucun objet reconnu sous la souris.');
    return;
  }
  const craftable = found.filter(o => mainRecipe(o)).sort((a, b) => a.rarete - b.rarete || a.niveau - b.niveau);
  const name = found[0].nom;
  if (r.mode === 'have') {
    // Ctrl+F : la ressource s'ajoute à « j'ai » si elle fait partie de la liste active
    const comp = listComponents();
    const usable = found.filter(o => comp.has(o.id)).sort((a, b) => a.rarete - b.rarete || a.niveau - b.niveau);
    const where = ctx.lists.all().length > 1 ? `ta liste « ${ctx.lists.activeName()} »` : 'ta liste';
    if (!usable.length) {
      const target = found.some(o => ctx.getCraft().cibles.some(t => t.id === o.id));
      tell(target
        ? `<b>${escapeHtml(name)}</b> est un objectif de ${escapeHtml(where)}, pas une ressource à réunir.`
        : `<b>${escapeHtml(name)}</b> ne fait pas partie des ressources de ${escapeHtml(where)}. Pour l'ajouter à fabriquer, utilise Ctrl+D.`,
      'warn', `${name} ne fait pas partie des ressources de ${where}.`, found[0].id);
      return;
    }
    if (win) { ctx.native.scanShow(scanChoice(usable, r.lines, comp, 'have')); return; }
    const k = comp.get(usable[0].id);
    window.wfScanHave(usable[0].id, Math.max(1, k.need - k.have));
    tell(`<b>${escapeHtml(usable[0].nom)}</b> ajouté à « J'ai ».`, 'ok', `${usable[0].nom} ajouté à « J'ai ».`);
    return;
  }
  if (win && craftable.length) { ctx.native.scanShow(scanChoice(craftable, r.lines, new Map())); return; }
  if (!craftable.length) {
    tell(`<b>${escapeHtml(name)}</b> ne se fabrique pas. Si c'est une ressource de ta liste, utilise Ctrl+F pour l'ajouter à « J'ai ».`, 'warn', `${name} ne se fabrique pas.`, found[0].id);
    if (!win) openItem(found[0].id);
    return;
  }
  if (craftable.length === 1) {
    addTarget(craftable[0], 1);
    if (!document.hasFocus()) ctx.native?.notify("Wak'Forge", `Ajouté à la liste : ${name}`);
  } else {
    // plusieurs versions (raretés) du même nom : on laisse choisir
    ctx.showView?.('craft');
    const input = $('#craftSearch');
    input.value = name;
    suggIdx = 0;
    renderCraftSuggest();
    input.focus();
    tell(`Plusieurs versions de <b>${escapeHtml(name)}</b> : choisis la bonne dans la liste.`, 'warn', `Plusieurs versions de « ${name} » : choisis dans Wak'Forge.`);
  }
}
