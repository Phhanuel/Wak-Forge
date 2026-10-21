// Refait les captures du README (docs/*.png) avec une liste d'exemple.
// Lancé par le workflow « Captures du README » (onglet Actions), qui sert le site en local.
// Usage : node scripts/captures.mjs [adresse du site, par défaut http://127.0.0.1:8080/]
// Prérequis : npm i --no-save playwright && npx playwright install chromium
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:8080/';
const OUT = new URL('../docs/', import.meta.url);

// Deux listes d'exemple : la première est ouverte sur la capture.
const craftMeulou = { cibles: [{ id: 23852, qte: 1 }, { id: 12894, qte: 2 }], stock: {}, acheter: {} };
const craftReroll = { cibles: [{ id: 2023, qte: 1 }], stock: {}, acheter: {} };
const state = {
  version: 1, custom: {}, overrides: {}, timers: {},
  craft: craftMeulou,
  listes: [
    { id: 'l1', nom: 'Panoplie 90', craft: craftMeulou },
    { id: 'l2', nom: 'Reroll', craft: craftReroll },
  ],
  listeActive: 'l1',
  prix: {},
  settings: { sound: true, volume: 0.7, soonMin: 5, notify: true },
  updatedAt: Date.now(),
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 2 });
page.on('pageerror', e => console.error('Erreur de la page :', e.message));
// icônes du jeu (CDN Ankama, wakfu.wiki.gg) : signale celles qui ne se chargent pas
let imgFail = 0;
page.on('response', r => { if (r.request().resourceType() === 'image' && r.status() >= 400 && imgFail++ < 3) console.warn(`Icône refusée (${r.status()}) : ${r.url()}`); });
page.on('requestfailed', r => { if (r.resourceType() === 'image' && imgFail++ < 3) console.warn(`Icône non chargée : ${r.url()} (${r.failure()?.errorText})`); });
// attend que les images visibles soient chargées (ou en échec)
const imagesLoaded = () => page.waitForFunction(() => [...document.images].every(i => i.complete), null, { timeout: 15000 }).catch(() => {});
await page.addInitScript(s => {
  if (!sessionStorage.getItem('captures.init')) {
    localStorage.clear();
    localStorage.setItem('archimonstres.state.v1', JSON.stringify(s));
    sessionStorage.setItem('captures.init', '1');
  }
}, state);

// --- Craft : prix et quantités « j'ai » sur quelques ressources
await page.goto(BASE);
await page.waitForSelector('#craftBase tr', { timeout: 60000 });
const fill = async (sel, value) => {
  const input = page.locator(sel);
  await input.fill(String(value));
  await input.press('Tab');
  await page.waitForTimeout(150);
};
await fill('#craftBase tr:nth-child(1) [data-price]', 85);
await fill('#craftBase tr:nth-child(2) [data-price]', 40);
await fill('#craftBase tr:nth-child(3) [data-have]', 4);
await fill('#craftBase tr:nth-child(3) [data-price]', 350);
await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
await page.waitForLoadState('networkidle').catch(() => {});
await imagesLoaded();
await page.waitForTimeout(800);
await page.screenshot({ path: new URL('capture.png', OUT).pathname });

// --- Bestiaire : recherche par objet
await page.click('.tab[data-view="monsters"]');
await page.fill('#monsterSearch', 'laine de bouftou');
await page.waitForTimeout(400);
await page.locator('#monsterList .mcard .mhead').nth(2).click().catch(() => {});
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1200);
await page.evaluate(() => window.scrollTo(0, 0));
await imagesLoaded();
await page.screenshot({ path: new URL('bestiaire.png', OUT).pathname });
if (imgFail) console.warn(`${imgFail} icône(s) non chargée(s).`);

await browser.close();
console.log('✓ Captures enregistrées dans docs/');
