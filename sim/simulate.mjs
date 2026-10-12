import { readFileSync, readdirSync } from 'node:fs';
import { createRng } from '../src/core/rng.js';
import { createGame, playProcedure, chooseConsultant, slotsOf } from '../src/core/engine.js';
import { strategies } from '../src/core/ai.js';
import { DECKS, composeDeck } from '../src/core/decks.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const core = read('../src/data/cards.json');
const expansions = Object.fromEntries(
  readdirSync(new URL('../src/data/decks/', import.meta.url)).map((f) => [f.replace('.json', ''), read(`../src/data/decks/${f}`)]),
);
const N = Number(process.env.N ?? 5000);
const only = process.env.DECK;

function run(cards, strategyName, opts, seed = 1) {
  const rng = createRng(seed);
  const strat = strategies[strategyName];
  const out = { won: 0, lost: 0, pentest: 0, turnsToWin: 0, injects: 0, consultants: 0, extraAttacks: 0, perCard: {} };
  for (let i = 0; i < N; i++) {
    const g = createGame(cards, rng, opts);
    let guard = 0;
    while (g.status === 'playing' && guard++ < 100) {
      if (g.consultantOffer) { chooseConsultant(g, g.consultantOffer[0], rng); continue; }
      playProcedure(g, strat(g, rng), rng);
    }
    out[g.status]++;
    if (g.status === 'won') out.turnsToWin += g.turn - 1;
    out.injects += g.injectsDrawn.length;
    out.consultants += g.consultants.length;
    out.extraAttacks += slotsOf(g).length - 4;
    for (const s of slotsOf(g)) {
      const k = g.attacks[s];
      out.perCard[k] ??= { n: 0, found: 0 };
      out.perCard[k].n++;
      if (g.revealed[s]) out.perCard[k].found++;
    }
  }
  return out;
}

const pct = (x) => `${((100 * x) / N).toFixed(0)}%`.padStart(4);
console.log(`Партий на строку: ${N}. Сложность «Аналитик SOC», 10 ходов, все вводные.\n`);
console.log('колода'.padEnd(26) + 'новичок  аналитик  обрыв  ход побед  вводн/игра  консульт/игра  доп.атак/игра  карт <70%');

for (const d of DECKS) {
  if (only && d.key !== only) continue;
  if (d.key !== 'core' && d.key !== 'all' && !expansions[d.key]) continue;
  const cards = composeDeck(d.key, core, expansions);
  const rnd = run(cards, 'random', {});
  const ana = run(cards, 'analyst', {});
  const hard = Object.entries(ana.perCard).filter(([, v]) => v.n >= 30 && v.found / v.n < 0.7);
  console.log(
    `${d.title.padEnd(26)}${pct(rnd.won).padStart(7)}${pct(ana.won).padStart(10)}${pct(ana.pentest).padStart(7)}` +
    `${(ana.turnsToWin / Math.max(1, ana.won)).toFixed(1).padStart(10)}${(ana.injects / N).toFixed(2).padStart(12)}` +
    `${(ana.consultants / N).toFixed(2).padStart(15)}${(ana.extraAttacks / N).toFixed(2).padStart(15)}${String(hard.length).padStart(11)}`,
  );
  if (process.env.VERBOSE) {
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    for (const [id, v] of hard) console.log(`    ${id} ${(100 * v.found / v.n).toFixed(0)}% детектов:${byId[id].detections.length} ${byId[id].name_ru}`);
  }
}
