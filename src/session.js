import { loadDeck } from './data/index.js';
import { createRng } from './core/rng.js';
import { createGame, playProcedure, chooseConsultant } from './core/engine.js';
import { createNarrator } from './core/narrator.js';

export const DIFFICULTIES = {
  easy: { label: 'Стажёр', note: '12 ходов, 5 установленных процедур', opts: { maxTurns: 12, establishedCount: 5 } },
  normal: { label: 'Аналитик SOC', note: '10 ходов, классика', opts: { maxTurns: 10 } },
  hard: { label: 'Начальник SOC', note: '8 ходов, бонус установленных +2', opts: { maxTurns: 8, establishedBonus: 2 } },
};

export class Session {
  constructor({ deck = 'core', difficulty = 'normal', classicInjects = true, seed = Date.now() } = {}) {
    this.deckKey = deck;
    this.startedAt = new Date();
    this.cards = loadDeck(deck);
    this.rng = createRng(seed);
    this.state = createGame(this.cards, this.rng, { ...DIFFICULTIES[difficulty].opts, pentestInject: classicInjects });
    this.byId = this.state.deck.byId;
    this.narrator = createNarrator(this.byId, this.rng);
    this.log = this.narrator.intro(this.state).map((text) => ({ tone: 'captain', text, turn: 1 }));
  }

  get hintsLeft() {
    return this.state.hints;
  }

  narrate(events, turn) {
    for (const ev of events) {
      const line = this.narrator.event(ev);
      if (line) this.log.push({ ...line, turn });
    }
  }

  play(procId) {
    const turn = this.state.turn;
    const entry = playProcedure(this.state, procId, this.rng);
    this.narrate(entry.events, turn);
    return entry;
  }

  chooseConsultant(id) {
    const events = chooseConsultant(this.state, id, this.rng);
    this.narrate(events, this.state.turn);
    return events;
  }

  hint() {
    if (this.state.hints <= 0 || this.state.status !== 'playing') return;
    this.state.hints -= 1;
    this.log.push({ tone: 'captain', text: this.narrator.hint(this.state), turn: this.state.turn });
  }
}
