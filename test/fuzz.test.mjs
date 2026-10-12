import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRng } from '../src/core/rng.js';
import { createGame, playProcedure, chooseConsultant, availableProcedures, slotsOf, candidates } from '../src/core/engine.js';
import { strategies } from '../src/core/ai.js';
import { DECKS, composeDeck } from '../src/core/decks.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const core = read('../src/data/cards.json');
const expansions = Object.fromEntries(readdirSync(new URL('../src/data/decks/', import.meta.url))
  .map((f) => [f.replace('.json', ''), read(`../src/data/decks/${f}`)]));
const GAMES = Number(process.env.FUZZ ?? 300);

function checkInvariants(g, ctx) {
  const slots = slotsOf(g);
  const ids = slots.map((s) => g.attacks[s]);
  assert.equal(new Set(ids).size, ids.length, `${ctx}: duplicate attack cards in slots`);
  for (const s of slots) {
    const card = g.deck.byId[g.attacks[s]];
    assert.ok(card, `${ctx}: slot ${s} has unknown card`);
    assert.equal(card.type, g.slotType[s], `${ctx}: slot ${s} type mismatch`);
  }
  for (const s of slots) {
    assert.ok(candidates(g, s).includes(g.attacks[s]), `${ctx}: notebook excludes the real card in ${s}`);
  }
  if (g.status === 'playing') {
    assert.ok(g.consultantOffer || availableProcedures(g).length > 0, `${ctx}: softlock, nothing to play on turn ${g.turn}`);
    for (const s of slots.filter((x) => !g.revealed[x])) {
      const catchable = g.deck.byId[g.attacks[s]].detections.some((d) => g.table.includes(d) && g.removed[d] !== Infinity);
      assert.ok(catchable, `${ctx}: hidden ${s} can no longer be detected`);
    }
  }
  if (g.status === 'won') assert.ok(slots.every((s) => g.revealed[s]), `${ctx}: won with hidden slots`);
  if (g.status === 'lost' && g.endReason === 'timeout') assert.ok(g.turn > g.maxTurns, `${ctx}: lost before time ran out`);
}

for (const d of DECKS) {
  test(`fuzz: ${d.title} — ${GAMES} games × 2 strategies keep every invariant`, () => {
    const cards = composeDeck(d.key, core, expansions);
    const stats = { won: 0, lost: 0, pentest: 0, extraSlots: 0, consultants: 0 };
    for (const strat of ['random', 'analyst']) {
      const rng = createRng(1234 + d.key.length);
      for (let i = 0; i < GAMES; i++) {
        const g = createGame(cards, rng, { pentestInject: i % 2 === 0 });
        const ctx = `${d.key}/${strat}#${i}`;
        let steps = 0;
        while (g.status === 'playing') {
          assert.ok(++steps < 200, `${ctx}: game does not terminate`);
          const turnBefore = g.turn;
          if (g.consultantOffer) chooseConsultant(g, rng.pick(g.consultantOffer), rng);
          else playProcedure(g, strategies[strat](g, rng), rng);
          assert.ok(g.turn >= turnBefore, `${ctx}: turn went backwards`);
          checkInvariants(g, ctx);
        }
        stats[g.status]++;
        stats.extraSlots += slotsOf(g).length - 4;
        stats.consultants += g.consultants.length;
      }
    }
    assert.equal(stats.won + stats.lost + stats.pentest, GAMES * 2);
  });
}
