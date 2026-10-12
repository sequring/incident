import core from './cards.json';
import { composeDeck } from '../core/decks.js';

const files = import.meta.glob('./decks/*.json', { eager: true, import: 'default' });
export const expansions = Object.fromEntries(
  Object.entries(files).map(([path, cards]) => [path.match(/([^/]+)\.json$/)[1], cards]),
);

export const loadDeck = (key) => composeDeck(key, core, expansions);
