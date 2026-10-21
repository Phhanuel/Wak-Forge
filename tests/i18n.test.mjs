// Version anglaise : chaque texte passé à t() / tr() / tn() dans le code doit avoir sa traduction.
// (Les textes de la page HTML sont vérifiés par scripts/i18n-check.mjs dans un navigateur.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { EN } from '../web/js/i18n-en.js';

const dir = new URL('../web/js/', import.meta.url);
const str = String.raw`'((?:[^'\\]|\\.)*)'`;
const call = new RegExp(String.raw`\b(?:t|tr)\(\s*${str}`, 'g');
const plural = new RegExp(String.raw`\btn\([^,]+,\s*${str},\s*${str}`, 'g');
const unescape = s => s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c));

export function codeKeys() {
  const keys = new Set(['monstres', 'monstres (trappeur)']); // libellés de craftcore.js passés à t()
  for (const f of readdirSync(dir).filter(f => f.endsWith('.js') && !f.startsWith('i18n'))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(call)) keys.add(unescape(m[1]));
    for (const m of src.matchAll(plural)) { keys.add(unescape(m[1])); keys.add(unescape(m[2])); }
  }
  return keys;
}

test('version anglaise : tous les textes du code sont traduits', () => {
  const missing = [...codeKeys()].filter(k => EN[k] == null);
  assert.deepEqual(missing, [], `Textes sans traduction dans web/js/i18n-en.js :\n${missing.join('\n')}`);
});

test('version anglaise : les {variables} sont gardées', () => {
  const vars = s => (s.match(/\{\w+\}/g) || []).sort().join();
  const bad = Object.entries(EN).filter(([fr, en]) => vars(fr) !== vars(en)).map(([fr]) => fr);
  assert.deepEqual(bad, []);
});
