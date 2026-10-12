import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createGame, playProcedure, procedureStatus, candidates, chooseConsultant, applyEffects, slotsOf } from '../src/core/engine.js';
import { composeDeck } from '../src/core/decks.js';
import { makeResolver } from '../src/core/names.js';

const cards = JSON.parse(readFileSync(new URL('../src/data/cards.json', import.meta.url)));
const fixedAttacks = { initial: '01', pivot: '12', persist: '24', c2: '28' };

function scriptedRng(rolls) {
  const queue = [...rolls];
  return {
    next: () => 0,
    int: () => 0,
    d20: () => queue.shift() ?? 10,
    pick: (a) => a[0],
    shuffle: (a) => a.slice(),
  };
}

test('success reveals the earliest matching attack in the kill chain', () => {
  const g = createGame(cards, scriptedRng([15]), { fixedAttacks });
  playProcedure(g, '34', scriptedRng([15]));
  assert.deepEqual(Object.keys(g.revealed), ['initial']);
});

test('clean success eliminates candidates in unrevealed categories', () => {
  const g = createGame(cards, scriptedRng([]), { fixedAttacks });
  const rng = scriptedRng([15]);
  playProcedure(g, '43', rng);
  assert.ok(g.cleanChecks.has('43'));
  assert.ok(!candidates(g, 'persist').includes('20'));
  assert.ok(candidates(g, 'persist').includes('24'));
});

test('cooldown blocks a procedure for 3 turns', () => {
  const g = createGame(cards, scriptedRng([]), { fixedAttacks });
  const rng = scriptedRng([5, 5, 15, 15]);
  playProcedure(g, '33', rng);
  assert.equal(procedureStatus(g, '33').left, 3);
  playProcedure(g, '35', rng);
  playProcedure(g, '36', rng);
  playProcedure(g, '37', rng);
  assert.ok(procedureStatus(g, '33').ok);
});

test('three failures in a row draw an inject', () => {
  const g = createGame(cards, scriptedRng([]), { fixedAttacks, pentestInject: false });
  const rng = scriptedRng([5, 5, 5]);
  playProcedure(g, '33', rng);
  playProcedure(g, '35', rng);
  playProcedure(g, '36', rng);
  assert.equal(g.injectsDrawn.length, 1);
});

test('legal inject removes the established bonus for the next 2 turns', () => {
  const g = createGame(cards, scriptedRng([]), { fixedAttacks, pentestInject: false });
  g.injectDeck = ['52'];
  const est = g.established;
  const rng = scriptedRng([1, 15, 15, 15]);
  playProcedure(g, est[0], rng);
  assert.equal(playProcedure(g, est[1], rng).mod, 0);
  assert.equal(playProcedure(g, est[2], rng).mod, 0);
  assert.equal(playProcedure(g, est[3], rng).mod, 3);
});

test('successful crisis management grants a captain hint', () => {
  const g = createGame(cards, scriptedRng([]), { fixedAttacks });
  playProcedure(g, '42', scriptedRng([15]));
  assert.equal(g.hints, 4);
  assert.equal(Object.keys(g.revealed).length, 0);
  playProcedure(g, '33', scriptedRng([5]));
  assert.equal(g.hints, 4);
});

test('game is lost after maxTurns', () => {
  const g = createGame(cards, scriptedRng([]), { fixedAttacks, maxTurns: 2, pentestInject: false });
  const rng = scriptedRng([5, 5]);
  playProcedure(g, '33', rng);
  playProcedure(g, '35', rng);
  assert.equal(g.status, 'lost');
});

const expansions = Object.fromEntries(readdirSync(new URL('../src/data/decks/', import.meta.url))
  .map((f) => [f.replace('.json', ''), JSON.parse(readFileSync(new URL(`../src/data/decks/${f}`, import.meta.url)))]));

test('every attack in every deck has 2 clues and a detection that exists in its deck', () => {
  for (const key of ['core', ...Object.keys(expansions), 'all']) {
    const deck = composeDeck(key, cards, expansions);
    const procs = new Set(deck.filter((c) => c.type === 'procedure').map((c) => c.id));
    for (const c of deck.filter((x) => ['initial', 'pivot', 'persist', 'c2'].includes(x.type))) {
      assert.equal(c.clues_ru?.length, 2, `clues for ${c.id}`);
      assert.ok(c.detections.length > 0 && c.detections.every((d) => procs.has(d)), `detections ${c.id} in ${key}`);
    }
    for (const c of deck.filter((x) => ['inject', 'consultant'].includes(x.type))) {
      assert.ok(c.effects?.length && c.effect_ru, `effects for ${c.id}`);
    }
  }
});

test('resolver maps printed detection names to the right procedure', () => {
  const r = makeResolver(cards.filter((c) => c.type === 'procedure'));
  assert.equal(r('SIEM Log Analysis'), '34');
  assert.equal(r('Firewall Log Review'), '35');
  assert.equal(r('Cyber Deception'), '37');
  assert.equal(r('User and Entity Behavior Analytics'), '39');
});

test('add_attack creates an extra hidden slot that must be revealed to win', () => {
  const g = createGame(cards, scriptedRng([]), { fixedAttacks });
  applyEffects(g, [{ op: 'add_attack', category: 'persist' }], scriptedRng([]), []);
  assert.equal(slotsOf(g).length, 5);
  assert.equal(g.slotType.persist2, 'persist');
  assert.notEqual(g.attacks.persist2, g.attacks.persist);
});

test('call a consultant offers a choice and applies the consultant effect', () => {
  const deck = composeDeck('expansion', cards, expansions);
  const call = deck.find((c) => c.type === 'procedure' && /call a consultant/i.test(c.name_en)).id;
  const g = createGame(deck, scriptedRng([]), { fixedAttacks });
  if (!g.table.includes(call)) g.table.push(call);
  playProcedure(g, call, scriptedRng([15]));
  assert.ok(g.consultantOffer?.length > 0);
  assert.equal(procedureStatus(g, '33').reason, 'consultant');
  const pick = g.consultantOffer[0];
  chooseConsultant(g, pick, scriptedRng([]));
  assert.deepEqual(g.consultants, [pick]);
  assert.equal(g.consultantOffer, null);
});

test('inject shield cancels the next inject', () => {
  const g = createGame(cards, scriptedRng([]), { fixedAttacks, pentestInject: false });
  g.injectShield = 1;
  g.injectDeck = ['51'];
  const entry = playProcedure(g, '33', scriptedRng([1]));
  assert.ok(entry.events.some((e) => e.kind === 'inject_cancelled'));
  assert.equal(g.turn, 2);
});

test('postmortem markdown includes chain, timeline, gaps and actions', async () => {
  const { postmortemFacts, emptyForm, toMarkdown } = await import('../src/postmortem.js');
  const g = createGame(cards, scriptedRng([]), { fixedAttacks, pentestInject: false });
  playProcedure(g, '34', scriptedRng([15]));
  playProcedure(g, '33', scriptedRng([5]));
  const byId = g.deck.byId;
  const session = { state: g, byId, startedAt: new Date(2026, 9, 12, 2, 7) };
  const facts = postmortemFacts(session, 'Базовая колода');
  assert.equal(facts.id, 'INC-20261012-0207');
  assert.equal(facts.chain.find((c) => c.slot === 'initial').revealed.turn, 1);
  const form = emptyForm(facts);
  form.participants = 'Анна | SOC';
  form.gaps.pivot.have['34'] = false;
  form.actions[0] = { what: 'Включить аудит Kerberos', owner: 'Игорь', due: 'Q4', kind: 'Обнаружить' };
  const md = toMarkdown(facts, form);
  assert.match(md, /# Постмортем INC-20261012-0207/);
  assert.match(md, /Анна \\| SOC|Анна \| SOC/);
  assert.match(md, /\| 1 \| Анализ журналов SIEM \| 15 \+3 = 18 \| успех \| раскрыто: Фишинг \|/);
  assert.match(md, /Анализ журналов SIEM — \*\*нет\*\*/);
  assert.match(md, /\| Включить аудит Kerberos \| Игорь \| Q4 \| Обнаружить \|/);
});
