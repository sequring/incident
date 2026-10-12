import { norm, makeResolver } from './names.js';

export const ATTACK_TYPES = ['initial', 'pivot', 'persist', 'c2'];
const FOREVER = Infinity;

export const DEFAULT_OPTIONS = {
  maxTurns: 10,
  establishedCount: 4,
  establishedBonus: 3,
  cooldown: 3,
  successThreshold: 11,
  failStreakForInject: 3,
  pentestInject: true,
  isolationBonusTurn: true,
  crisisBonus: true,
  maxProcedures: 18,
  consultantChoices: 3,
};

export function indexCards(cards) {
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  const ofType = (t) => cards.filter((c) => c.type === t);
  const procedures = ofType('procedure');
  const special = (name) => procedures.find((p) => norm(p.name_en) === name)?.id ?? null;
  return {
    byId,
    attacks: Object.fromEntries(ATTACK_TYPES.map((t) => [t, ofType(t)])),
    procedures,
    injects: ofType('inject'),
    consultants: ofType('consultant'),
    resolve: makeResolver(procedures),
    isolation: special('isolation'),
    crisis: special('crisis management'),
    callConsultant: special('call a consultant'),
  };
}

const endsGame = (card) => (card.effects ?? []).some((e) => e.op === 'end_game');

// Picks which procedures are on the table: all of them for normal decks,
// a winnable subset for huge combined decks.
function dealProcedures(deck, attacks, rng, options) {
  const all = deck.procedures.map((p) => p.id);
  if (all.length <= options.maxProcedures) return all;
  const must = new Set([deck.crisis, deck.isolation, deck.callConsultant].filter(Boolean));
  for (const id of Object.values(attacks)) {
    for (const d of rng.shuffle(deck.byId[id].detections).slice(0, 2)) must.add(d);
  }
  const rest = rng.shuffle(all.filter((id) => !must.has(id)));
  return [...must, ...rest].slice(0, Math.max(options.maxProcedures, must.size));
}

export function createGame(cards, rng, opts = {}) {
  const options = { ...DEFAULT_OPTIONS, ...opts };
  const deck = indexCards(cards);
  const attacks = {};
  const slotType = {};
  for (const t of ATTACK_TYPES) {
    attacks[t] = opts.fixedAttacks?.[t] ?? rng.pick(deck.attacks[t]).id;
    slotType[t] = t;
  }
  const table = rng.shuffle(dealProcedures(deck, attacks, rng, options));
  const injectPool = deck.injects.filter((c) => options.pentestInject || !endsGame(c)).map((c) => c.id);
  return {
    options,
    deck,
    attacks,
    slotType,
    table,
    revealed: {},
    established: table.slice(0, options.establishedCount).sort(),
    lastUsed: {},
    removed: {},
    forced: null,
    turn: 1,
    maxTurns: options.maxTurns,
    failStreak: 0,
    mods: [],
    noBonusUntil: 0,
    advantage: { until: 0, count: 0 },
    disadvantage: { until: 0, count: 0 },
    rerolls: 0,
    autoSuccess: 0,
    pendingSkip: 0,
    injectDeck: rng.shuffle(injectPool),
    injectPool,
    injectsDrawn: [],
    consultants: [],
    consultantOffer: null,
    consultantPicks: 0,
    injectShield: 0,
    cleanChecks: new Set(),
    hints: 3,
    history: [],
    status: 'playing',
    endReason: null,
  };
}

const removedNow = (state, id) => (state.removed[id] ?? -1) >= state.turn;

export function procedureStatus(state, procId) {
  if (state.status !== 'playing') return { ok: false, reason: 'over' };
  if (state.consultantOffer) return { ok: false, reason: 'consultant' };
  if (state.forced && state.forced.procId !== procId) return { ok: false, reason: 'forced' };
  if (state.forced?.procId === procId) return { ok: true };
  if (removedNow(state, procId)) {
    const until = state.removed[procId];
    return { ok: false, reason: 'removed', left: until === FOREVER ? null : until - state.turn + 1 };
  }
  const last = state.lastUsed[procId];
  if (last !== undefined) {
    const left = state.options.cooldown - (state.turn - last - 1);
    if (left > 0) return { ok: false, reason: 'cooldown', left };
  }
  return { ok: true };
}

export function availableProcedures(state) {
  return state.table.filter((id) => procedureStatus(state, id).ok);
}

function modApplies(state, mod, procId) {
  if (mod.until < state.turn) return false;
  if (mod.target === 'all') return true;
  if (mod.target === 'established') return state.established.includes(procId);
  if (mod.target === 'other') return !state.established.includes(procId);
  return mod.procIds.includes(procId);
}

export function modifierFor(state, procId) {
  const parts = [];
  if (state.established.includes(procId)) {
    if (state.noBonusUntil >= state.turn) parts.push({ label: 'established_lost', value: 0 });
    else parts.push({ label: 'established', value: state.options.establishedBonus });
  }
  for (const m of state.mods) if (modApplies(state, m, procId)) parts.push({ label: m.source, value: m.value });
  return { total: parts.reduce((s, p) => s + p.value, 0), parts };
}

export function rollMode(state) {
  const adv = state.advantage.until >= state.turn || state.advantage.count > 0;
  const dis = state.disadvantage.until >= state.turn || state.disadvantage.count > 0;
  return adv && !dis ? 'advantage' : dis && !adv ? 'disadvantage' : 'normal';
}

export const slotsOf = (state) => Object.keys(state.attacks);

export function unrevealedSlots(state) {
  return slotsOf(state).filter((s) => !state.revealed[s]);
}

function captainPickReveal(state, procId) {
  return unrevealedSlots(state).find((s) => state.deck.byId[state.attacks[s]].detections.includes(procId));
}

export function candidates(state, slot) {
  if (state.revealed[slot]) return [state.attacks[slot]];
  const taken = new Set(slotsOf(state).filter((s) => s !== slot && state.revealed[s]).map((s) => state.attacks[s]));
  return state.deck.attacks[state.slotType[slot]]
    .filter((c) => !taken.has(c.id) && !c.detections.some((d) => state.cleanChecks.has(d)))
    .map((c) => c.id);
}

function reveal(state, slot, events, cause) {
  if (state.revealed[slot]) return;
  state.revealed[slot] = state.turn;
  events.push({ kind: 'reveal', slot, type: state.slotType[slot], cardId: state.attacks[slot], cause });
  if (unrevealedSlots(state).length === 0) endGame(state, 'won', events);
}

const slotFor = (state, category) =>
  unrevealedSlots(state).find((s) => !category || category === 'any' || state.slotType[s] === category);

function addAttack(state, type, rng, events) {
  const used = new Set(Object.values(state.attacks));
  const pool = state.deck.attacks[type].filter((c) => !used.has(c.id) && !c.detections.some((d) => state.cleanChecks.has(d)));
  if (!pool.length) return;
  const n = slotsOf(state).filter((s) => state.slotType[s] === type).length + 1;
  const slot = `${type}${n}`;
  state.attacks[slot] = rng.pick(pool).id;
  state.slotType[slot] = type;
  events.push({ kind: 'attack_added', slot, type });
}

function endGame(state, status, events, reason = status) {
  if (state.status !== 'playing') return;
  state.status = status;
  state.endReason = reason;
  events.push({ kind: 'end', status, reason });
}

function advanceTurn(state, events) {
  state.turn += 1;
  if (state.status === 'playing' && state.turn > state.maxTurns) endGame(state, 'lost', events, 'timeout');
}

// Procedures whose removal would leave some hidden attack undetectable.
function criticalProcedures(state) {
  const crit = new Set();
  for (const t of unrevealedSlots(state)) {
    const live = state.deck.byId[state.attacks[t]].detections.filter((d) => state.table.includes(d) && !removedNow(state, d));
    if (live.length <= 1) live.forEach((d) => crit.add(d));
  }
  return crit;
}

function procIdsFor(state, names = []) {
  return names.map((n) => state.deck.resolve(n)).filter(Boolean);
}

const untilFor = (state, turns) => (turns ? state.turn + turns : FOREVER);

export function applyEffects(state, effects, rng, events, source, depth = 0) {
  for (const e of effects ?? []) {
    if (state.status !== 'playing') return;
    switch (e.op) {
      case 'modifier': {
        const target = typeof e.target === 'object' ? 'procs' : e.target ?? 'all';
        const procIds = target === 'procs' ? procIdsFor(state, e.target.procedures) : [];
        if (target === 'procs' && !procIds.length) break;
        state.mods.push({ value: e.value, target, procIds, until: untilFor(state, e.turns), source });
        events.push({ kind: 'modifier', value: e.value, target, procIds, turns: e.turns ?? null });
        break;
      }
      case 'no_established_bonus':
        state.noBonusUntil = Math.max(state.noBonusUntil, state.turn + (e.turns ?? 1));
        events.push({ kind: 'nobonus', turns: e.turns ?? 1 });
        break;
      case 'skip_turns':
        state.pendingSkip += e.count ?? 1;
        events.push({ kind: 'skip', count: e.count ?? 1 });
        break;
      case 'extra_turns':
        state.maxTurns += e.count ?? 1;
        events.push({ kind: 'bonus_turn', count: e.count ?? 1 });
        break;
      case 'remove_procedure': {
        const named = typeof e.which === 'object' ? procIdsFor(state, e.which.procedures) : null;
        const crit = criticalProcedures(state);
        const pool = named ?? state.table.filter((p) => !removedNow(state, p) && !crit.has(p) && p !== state.deck.crisis);
        const victims = named ?? rng.shuffle(pool).slice(0, e.count ?? 1);
        for (const v of victims) {
          state.removed[v] = untilFor(state, e.turns);
          events.push({ kind: 'removed', procId: v, turns: e.turns ?? null });
        }
        break;
      }
      case 'reveal_attack': {
        const slot = slotFor(state, e.category) ?? unrevealedSlots(state)[0];
        if (slot) reveal(state, slot, events, 'effect');
        break;
      }
      case 'reveal_detected_by': {
        const procId = state.deck.resolve(e.procedure ?? '');
        const hits = unrevealedSlots(state).filter((s) => state.deck.byId[state.attacks[s]].detections.includes(procId));
        for (const s of e.all === false ? hits.slice(0, 1) : hits) reveal(state, s, events, 'effect');
        if (!hits.length) events.push({ kind: 'nothing_revealed' });
        break;
      }
      case 'add_attack': {
        const types = e.category === 'set' ? ATTACK_TYPES : [e.category === 'any' || !e.category ? rng.pick(ATTACK_TYPES) : e.category];
        for (const t of types) addAttack(state, t, rng, events);
        break;
      }
      case 'offer_consultant':
        state.consultantPicks += e.count ?? 1;
        if (!state.consultantOffer) offerConsultants(state, rng, events);
        break;
      case 'inject_shield':
        state.injectShield += e.count ?? 1;
        events.push({ kind: 'inject_shield', count: e.count ?? 1 });
        break;
      case 'roll_check': {
        const roll = rng.d20();
        const ok = e.parity ? (roll % 2 === 0) === (e.parity === 'even') : roll >= (e.success_at ?? 11);
        events.push({ kind: 'roll_check', roll, ok, parity: e.parity ?? null, successAt: e.success_at ?? 11 });
        applyEffects(state, ok ? e.on_success : e.on_fail, rng, events, source, depth);
        break;
      }
      case 'force_procedure': {
        const procId = state.deck.resolve(e.procedure ?? '');
        if (!procId || !state.table.includes(procId)) break;
        state.forced = { procId, onSuccess: e.on_success ?? [], onFail: e.on_fail ?? [], source };
        events.push({ kind: 'forced', procId });
        break;
      }
      case 'reset_cooldowns':
        state.lastUsed = {};
        events.push({ kind: 'cooldowns_reset' });
        break;
      case 'extend_cooldowns':
        for (const id of Object.keys(state.lastUsed)) {
          if (procedureStatus(state, id).reason === 'cooldown') state.lastUsed[id] += e.turns ?? 1;
        }
        events.push({ kind: 'cooldowns_extended', turns: e.turns ?? 1 });
        break;
      case 'promote_to_established': {
        const named = procIdsFor(state, e.procedures).filter((p) => state.table.includes(p));
        const others = state.table.filter((p) => !state.established.includes(p));
        const score = (p) => unrevealedSlots(state).filter((t) => candidates(state, t).some((c) => state.deck.byId[c].detections.includes(p))).length;
        const picks = named.length ? named : others.sort((a, b) => score(b) - score(a)).slice(0, e.count ?? 1);
        for (const p of picks) if (!state.established.includes(p)) state.established.push(p);
        events.push({ kind: 'promoted', procIds: picks });
        break;
      }
      case 'demote_established': {
        const picks = rng.shuffle(state.established).slice(0, e.count ?? 1);
        state.established = state.established.filter((p) => !picks.includes(p));
        events.push({ kind: 'demoted', procIds: picks });
        break;
      }
      case 'advantage':
      case 'disadvantage': {
        const slot = state[e.op];
        if (e.turns) slot.until = Math.max(slot.until, state.turn + e.turns);
        else slot.count += e.count ?? 1;
        events.push({ kind: e.op, turns: e.turns ?? null, count: e.turns ? null : e.count ?? 1 });
        break;
      }
      case 'reroll':
        state.rerolls += e.count ?? 1;
        events.push({ kind: 'reroll_gained', count: e.count ?? 1 });
        break;
      case 'success_on_failure':
        state.autoSuccess += e.count ?? 1;
        events.push({ kind: 'auto_success_gained', count: e.count ?? 1 });
        break;
      case 'draw_inject':
        if (depth < 2) for (let i = 0; i < (e.count ?? 1); i++) drawInject(state, rng, events, depth + 1);
        break;
      case 'swap_attack': {
        const slot = slotFor(state, e.category);
        if (!slot) break;
        const used = new Set(Object.values(state.attacks));
        const pool = state.deck.attacks[state.slotType[slot]].filter((c) => !used.has(c.id) && !c.detections.some((d) => state.cleanChecks.has(d)));
        if (!pool.length) break;
        state.attacks[slot] = rng.pick(pool).id;
        events.push({ kind: 'swapped', slot, type: state.slotType[slot] });
        break;
      }
      case 'end_game':
        if (e.result === 'win') endGame(state, 'won', events, 'effect');
        else if (e.result === 'loss') endGame(state, 'lost', events, 'effect');
        else {
          unrevealedSlots(state).forEach((s) => events.push({ kind: 'reveal', slot: s, type: state.slotType[s], cardId: state.attacks[s], cause: 'pentest' }));
          endGame(state, 'pentest', events);
        }
        break;
      default:
        break;
    }
  }
}

function drawInject(state, rng, events, depth = 0) {
  if (!state.injectPool.length) return;
  if (state.injectDeck.length === 0) state.injectDeck = rng.shuffle(state.injectPool);
  const id = state.injectDeck.shift();
  state.injectsDrawn.push(id);
  events.push({ kind: 'inject', cardId: id });
  if (state.injectShield > 0) {
    state.injectShield -= 1;
    events.push({ kind: 'inject_cancelled', cardId: id });
    return;
  }
  applyEffects(state, state.deck.byId[id].effects, rng, events, id, depth);
}

function rollD20(state, rng) {
  const mode = rollMode(state);
  const a = rng.d20();
  if (mode === 'normal') return { roll: a, dice: [a], mode };
  const b = rng.d20();
  const slot = state[mode];
  if (slot.until < state.turn && slot.count > 0) slot.count -= 1;
  return { roll: mode === 'advantage' ? Math.max(a, b) : Math.min(a, b), dice: [a, b], mode };
}

function offerConsultants(state, rng, events) {
  const pool = state.deck.consultants.map((c) => c.id);
  const fresh = pool.filter((id) => !state.consultants.includes(id));
  if (!pool.length || state.status !== 'playing') { state.consultantPicks = 0; return; }
  state.consultantOffer = rng.shuffle(fresh.length >= 2 ? fresh : pool).slice(0, state.options.consultantChoices);
  events.push({ kind: 'consultant_offer', options: state.consultantOffer });
}

export function chooseConsultant(state, id, rng) {
  if (!state.consultantOffer?.includes(id)) throw new Error(`Consultant ${id} not offered`);
  state.consultantOffer = null;
  state.consultantPicks = Math.max(0, state.consultantPicks - 1);
  const events = [{ kind: 'consultant', cardId: id }];
  if (!state.consultants.includes(id)) state.consultants.push(id);
  applyEffects(state, state.deck.byId[id].effects, rng, events, id);
  if (state.consultantPicks > 0 && !state.consultantOffer) offerConsultants(state, rng, events);
  state.history.at(-1)?.events.push(...events);
  return events;
}

export function playProcedure(state, procId, rng) {
  const st = procedureStatus(state, procId);
  if (!st.ok) throw new Error(`Procedure ${procId} not playable: ${st.reason}`);
  const events = [];
  const forced = state.forced?.procId === procId ? state.forced : null;
  state.forced = null;
  const { roll, dice, mode } = rollD20(state, rng);
  const mod = modifierFor(state, procId);
  let total = roll + mod.total;
  let success = roll === 20 || (roll !== 1 && total >= state.options.successThreshold);
  const entry = { turn: state.turn, procId, roll, dice, mode, mod: mod.total, total, success, events };
  state.history.push(entry);
  state.lastUsed[procId] = state.turn;
  events.push({ kind: 'roll', procId, roll, dice, mode, mod, total, success });

  if (!success && roll !== 1 && state.rerolls > 0) {
    state.rerolls -= 1;
    const again = rng.d20();
    total = again + mod.total;
    success = again === 20 || (again !== 1 && total >= state.options.successThreshold);
    Object.assign(entry, { roll: again, total, success });
    events.push({ kind: 'reroll', roll: again, total, success });
  }
  if (!success && state.autoSuccess > 0) {
    state.autoSuccess -= 1;
    success = true;
    entry.success = true;
    events.push({ kind: 'auto_success' });
  }

  let injectTriggered = roll === 1 || roll === 20;
  if (success) {
    state.failStreak = 0;
    if (forced) applyEffects(state, forced.onSuccess, rng, events, forced.source);
    if (procId === state.deck.crisis && state.options.crisisBonus) {
      const before = state.mods.length;
      state.mods = state.mods.filter((m) => !(m.value < 0 && m.target === 'all'));
      if (state.mods.length < before) events.push({ kind: 'penalty_cleared' });
      state.hints += 1;
      events.push({ kind: 'hint_gained' });
    } else if (procId === state.deck.isolation && state.options.isolationBonusTurn) {
      state.maxTurns += 1;
      events.push({ kind: 'bonus_turn', count: 1 });
    } else if (procId === state.deck.callConsultant) {
      state.consultantPicks += 1;
      offerConsultants(state, rng, events);
    } else if (procId !== state.deck.crisis && procId !== state.deck.isolation) {
      const t = captainPickReveal(state, procId);
      if (t) reveal(state, t, events, 'detection');
      else {
        state.cleanChecks.add(procId);
        events.push({ kind: 'clean', procId });
      }
    }
  } else {
    state.failStreak += 1;
    events.push({ kind: 'fail', procId });
    if (forced) applyEffects(state, forced.onFail, rng, events, forced.source);
    if (state.failStreak >= state.options.failStreakForInject) {
      injectTriggered = true;
      state.failStreak = 0;
    }
  }

  if (injectTriggered && state.status === 'playing') drawInject(state, rng, events);
  advanceTurn(state, events);
  while (state.pendingSkip > 0 && state.status === 'playing') {
    state.pendingSkip -= 1;
    events.push({ kind: 'skipped', turn: state.turn });
    advanceTurn(state, events);
  }
  return entry;
}
