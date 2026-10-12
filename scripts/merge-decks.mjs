// Turns transcription output (out_<deck>.json) into game data: src/data/decks/<deck>.json.
// Usage: node scripts/merge-decks.mjs <dir-with-out-files>
import fs from 'node:fs';
import path from 'node:path';
import { makeResolver } from '../src/core/names.js';
import { composeDeck } from '../src/core/decks.js';

const SRC = process.argv[2];
const ROOT = new URL('..', import.meta.url).pathname;
const core = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/cards.json')));
const ATTACKS = ['initial', 'pivot', 'persist', 'c2'];
const problems = [];

const patches = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/effect-patches.json')));
const outs = fs.readdirSync(SRC).filter((f) => /^out_.+\.json$/.test(f));
fs.mkdirSync(path.join(ROOT, 'src/data/decks'), { recursive: true });

function procNamesInEffects(effects = [], acc = []) {
  for (const e of effects) {
    if (e.procedure) acc.push(e.procedure);
    if (e.procedures) acc.push(...e.procedures);
    if (e.target?.procedures) acc.push(...e.target.procedures);
    if (e.which?.procedures) acc.push(...e.which.procedures);
    procNamesInEffects(e.on_success, acc);
    procNamesInEffects(e.on_fail, acc);
  }
  return acc;
}

for (const file of outs) {
  const key = file.slice(4, -5);
  const raw = JSON.parse(fs.readFileSync(path.join(SRC, file)));
  const cards = raw.map((c) => ({
    id: c.id,
    deck: key,
    type: c.type,
    name_en: c.name_en,
    name_ru: c.name_ru,
    desc_en: c.desc_en,
    desc_ru: c.desc_ru,
    detections_en: c.detections_en ?? [],
    detections: [],
    tools: c.tools ?? [],
    specialties_ru: c.specialties_ru ?? [],
    clues_ru: c.clues_ru ?? [],
    effects: c.effects ?? [],
    effect_ru: c.effect_ru ?? '',
    image: `cards/${key}/${c.id.split('-')[1]}.webp`,
    ...patches[c.id],
  }));
  const deck = composeDeck(key, core, { [key]: cards });
  const resolve = makeResolver(deck.filter((c) => c.type === 'procedure'));
  for (const c of cards) {
    if (ATTACKS.includes(c.type)) {
      for (const name of c.detections_en) {
        const id = resolve(name);
        if (id) { if (!c.detections.includes(id)) c.detections.push(id); }
        else problems.push(`${c.id} «${c.name_en}»: detection not found: "${name}"`);
      }
      if (!c.detections.length) problems.push(`${c.id} «${c.name_en}»: NO detections resolved`);
      if (c.clues_ru.length !== 2) problems.push(`${c.id}: ${c.clues_ru.length} clues`);
    }
    for (const name of procNamesInEffects(c.effects)) {
      if (!resolve(name)) problems.push(`${c.id} «${c.name_en}»: effect procedure not found: "${name}"`);
    }
    if (['inject', 'consultant'].includes(c.type) && !c.effects.length) problems.push(`${c.id}: no effects`);
  }
  fs.writeFileSync(path.join(ROOT, 'src/data/decks', `${key}.json`), JSON.stringify(cards, null, 1));
  const count = (t) => cards.filter((c) => c.type === t).length;
  console.log(`${key.padEnd(10)} ${cards.length} cards · attacks ${ATTACKS.map(count).join('/')} · proc ${count('procedure')} · inject ${count('inject')} · consultant ${count('consultant')}`);
}
console.log(problems.length ? `\n${problems.length} problems:\n` + problems.join('\n') : '\nNo problems.');
