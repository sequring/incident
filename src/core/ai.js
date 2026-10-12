import { availableProcedures, candidates, modifierFor, rollMode, unrevealedSlots } from './engine.js';

export function successChance(state, procId) {
  const mod = modifierFor(state, procId).total;
  let wins = 0;
  for (let r = 1; r <= 20; r++) {
    if (r === 20 || (r !== 1 && r + mod >= state.options.successThreshold)) wins++;
  }
  const p = wins / 20;
  const mode = rollMode(state);
  if (mode === 'advantage') return 1 - (1 - p) ** 2;
  if (mode === 'disadvantage') return p ** 2;
  return p;
}

export function revealChance(state, procId) {
  let miss = 1;
  for (const t of unrevealedSlots(state)) {
    const ids = candidates(state, t);
    if (!ids.length) continue;
    const hit = ids.filter((id) => state.deck.byId[id].detections.includes(procId)).length;
    miss *= 1 - hit / ids.length;
  }
  return 1 - miss;
}

export function rankProcedures(state) {
  const { isolation, crisis, callConsultant } = state.deck;
  return availableProcedures(state)
    .map((id) => {
      let value = revealChance(state, id);
      if (id === isolation && state.options.isolationBonusTurn) value = 0.35;
      if (id === crisis) value = state.mods.some((m) => m.value < 0 && m.target === 'all') ? 0.5 : 0.1;
      if (id === callConsultant) value = state.consultants.length ? 0.2 : 0.4;
      return { id, value, p: successChance(state, id), score: value * successChance(state, id) };
    })
    .sort((a, b) => b.score - a.score);
}

export const strategies = {
  random: (state, rng) => rng.pick(availableProcedures(state)),
  analyst: (state) => rankProcedures(state)[0].id,
};
