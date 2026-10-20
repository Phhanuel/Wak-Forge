// Fenêtre de scan de l'appli PC (scan.html) : affiche l'objet scanné, laisse choisir la rareté
// et la quantité. Le contenu est préparé par la page principale (craft.js, handleScan) ;
// l'objet choisi lui est renvoyé par l'appli PC, qui referme la fenêtre et rend le focus au jeu.
import { escapeHtml } from './util.js';

const $ = (s, r = document) => r.querySelector(s);
const fmtN = n => Number(n).toLocaleString('fr-FR');
const root = $('#scanPop');
const call = (name, ...a) => window[name]?.(...a)?.catch?.(() => {});
const closeWin = () => { pop = null; call('nativeScanClose'); };

let pop = null; // { state, versions, sel, qte, … }

function render() {
  if (!pop) { root.innerHTML = ''; return; }
  const head = `<header class="sp-head"><b>Scan d'objet</b><button class="ovl-btn" type="button" data-sp-close title="Fermer (Échap)" aria-label="Fermer">✕</button></header>`;
  if (pop.state === 'loading') {
    root.innerHTML = `<div class="sp">${head}<div class="sp-msg"><span class="sp-spin"></span>Lecture de l'objet sous la souris…</div></div>`;
    return;
  }
  if (pop.state === 'msg') {
    root.innerHTML = `<div class="sp">${head}<div class="sp-msg ${escapeHtml(pop.kind || '')}">${pop.html}</div>
      <footer class="sp-foot">${pop.itemId ? '<button class="btn small" type="button" data-sp-item>Voir la provenance</button>' : ''}
        <button class="btn small primary" type="button" data-sp-close>Fermer</button></footer></div>`;
    root.querySelector('.sp-foot .primary')?.focus();
    return;
  }
  if (pop.state === 'done') {
    root.innerHTML = `<div class="sp">${head}<div class="sp-msg ok"><span class="sp-check">✓</span>${pop.html}</div></div>`;
    return;
  }
  const o = pop.versions[pop.sel];
  root.innerHTML = `<div class="sp">${head}
    <div class="sp-item">${o.icon}
      <div class="sp-main"><div class="sp-name">${escapeHtml(o.nom)}</div><div class="s-meta">${o.meta}</div></div></div>
    <div class="sp-label">Rareté</div>
    <div class="sp-rar" role="radiogroup" aria-label="Rareté">${pop.versions.map((v, i) => `<button type="button" role="radio" aria-checked="${i === pop.sel}" data-sp-rar="${i}"><span class="rar-dot ${escapeHtml(v.cls)}"></span>${escapeHtml(v.label)}</button>`).join('')}</div>
    <div class="sp-label">Quantité</div>
    <div class="sp-qty"><div class="stepper"><button type="button" data-sp-step="-1" aria-label="Moins">−</button>
      <input type="number" min="1" max="9999" value="${pop.qte}" data-sp-qte aria-label="Quantité">
      <button type="button" data-sp-step="1" aria-label="Plus">+</button></div>
      ${o.inList ? `<span class="muted">déjà ${fmtN(o.inList)} dans la liste</span>` : ''}</div>
    <footer class="sp-foot"><button class="btn small ghost" type="button" data-sp-close>Annuler</button>
      <button class="btn small primary" type="button" data-sp-ok>Ajouter à la liste</button></footer>
  </div>`;
  const input = root.querySelector('[data-sp-qte]');
  input.focus();
  input.select();
}

function readQte() {
  const v = Math.floor(+root.querySelector('[data-sp-qte]')?.value);
  return Math.min(9999, Math.max(1, v || 1));
}

function confirm() {
  if (pop?.state !== 'choose') return;
  const o = pop.versions[pop.sel];
  const qte = readQte();
  call('nativeScanAdd', o.id, qte);
  pop = { state: 'done', html: `<b>${fmtN(qte)} × ${escapeHtml(o.nom)}</b> ajouté à la liste.` };
  render();
  setTimeout(() => { if (pop?.state === 'done') closeWin(); }, 600);
}

/** Appelé par l'appli PC : nouvel état à afficher. */
window.wfPop = state => {
  pop = { qte: 1, sel: 0, ...state };
  render();
};

root.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || !pop) return;
  if (b.matches('[data-sp-close]')) { closeWin(); return; }
  if (b.matches('[data-sp-ok]')) { confirm(); return; }
  if (b.matches('[data-sp-item]')) { const id = pop.itemId; pop = null; render(); call('nativeScanItem', id); return; }
  if (b.matches('[data-sp-rar]')) { pop.qte = readQte(); pop.sel = +b.dataset.spRar; render(); return; }
  if (b.matches('[data-sp-step]')) {
    const input = root.querySelector('[data-sp-qte]');
    input.value = Math.min(9999, Math.max(1, readQte() + +b.dataset.spStep * (e.shiftKey ? 10 : 1)));
    pop.qte = +input.value;
  }
});
root.addEventListener('input', e => { if (e.target.matches('[data-sp-qte]') && pop) pop.qte = readQte(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); closeWin(); return; }
  if (!pop) return;
  if (pop.state === 'msg' && e.key === 'Enter' && !e.target.closest('[data-sp-item]')) { e.preventDefault(); closeWin(); return; }
  if (pop.state !== 'choose') return;
  if (e.key === 'Enter') { e.preventDefault(); confirm(); return; }
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && pop.versions.length > 1) {
    e.preventDefault();
    pop.qte = readQte();
    pop.sel = (pop.sel + (e.key === 'ArrowRight' ? 1 : -1) + pop.versions.length) % pop.versions.length;
    render();
  }
});
