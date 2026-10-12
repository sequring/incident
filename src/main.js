import Phaser from 'phaser';
import '@fontsource/jetbrains-mono/cyrillic-400.css';
import '@fontsource/jetbrains-mono/cyrillic-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import { BoardScene, W, H, ZOOM } from './BoardScene.js';
import { IntroScene } from './IntroScene.js';
import { Session } from './session.js';
import { loadDeck } from './data/index.js';
import { applyEffects } from './core/engine.js';
import { renderSidebar, showCard, showEnd, showMenu, showNotebook, showInject, showInjects, showConsultantChoice, showBriefing, closeModal } from './ui.js';

const sidebar = document.getElementById('sidebar');
let session;
let board;
let intro;
let busy = false;
let lastSettings = { deck: 'core', difficulty: 'normal', classicInjects: true };

await Promise.all(['400 16px "JetBrains Mono"', '700 16px "JetBrains Mono"']
  .map((f) => document.fonts.load(f, 'ИНЦИДЕНТ Incident')));

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'board',
  width: W * ZOOM,
  height: H * ZOOM,
  backgroundColor: '#12141a',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  input: { windowEvents: false },
  scene: [BoardScene, IntroScene],
});

function refresh() {
  renderSidebar(sidebar, session, {
    hint: () => { session.hint(); refresh(); },
    results: () => showEnd(session, restart),
    restart,
  });
  board.refresh();
}

function offerConsultants(done) {
  if (!session.state.consultantOffer) return done();
  showConsultantChoice(session, (id) => {
    session.chooseConsultant(id);
    refresh();
    offerConsultants(done);
  });
}

function play(procId) {
  if (busy || session.state.status !== 'playing') return;
  busy = true;
  const entry = session.play(procId);
  const injects = entry.events.filter((e) => e.kind === 'inject').map((e) => e.cardId);
  const finish = () => {
    busy = false;
    refresh();
    if (session.state.status !== 'playing') setTimeout(() => showEnd(session, restart), injects.length ? 300 : 1100);
  };
  const nextInject = (i) => {
    if (i >= injects.length) {
      refresh();
      return offerConsultants(finish);
    }
    board.animateInject(injects[i], () => {
      refresh();
      showInject(session, injects[i], () => nextInject(i + 1));
    });
  };
  board.animateRoll(entry, () => nextInject(0));
}

function onCard(id) {
  if (busy || !document.getElementById('modal').hidden) return;
  if (!id) return showNotebook(session);
  if (id === 'injects') return showInjects(session);
  showCard(session, id, { onPlay: session.byId[id].type === 'procedure' ? play : null });
}

const modalEl = document.getElementById('modal');
new ResizeObserver(() => requestAnimationFrame(() => game.scale.refresh())).observe(document.getElementById('board'));

// The splash (intro scene) covers the whole screen while the menu and briefing are open.
function introMode(on) {
  document.getElementById('app').classList.toggle('intro', on);
  modalEl.classList.toggle('over-intro', on);
  if (on) game.scene.wake('intro');
  else game.scene.sleep('intro');
  setTimeout(() => game.scale.refresh(), 50);
}

function start(settings) {
  lastSettings = settings;
  busy = true;
  session = new Session(settings);
  // Card images load while the player reads the briefing.
  const ready = board.setup(session, onCard);
  showBriefing(session, async () => {
    await ready;
    introMode(false);
    busy = false;
    refresh();
  });
}

function openMenu() {
  intro.setPromptVisible(false);
  showMenu(start, lastSettings);
}

function restart() {
  closeModal();
  introMode(true);
  openMenu();
}

if (import.meta.env.DEV) {
  window.__game = {
    get session() { return session; },
    get busy() { return busy; },
    game,
    get board() { return board; },
    play,
    restart,
    addAttack: (category) => {
      applyEffects(session.state, [{ op: 'add_attack', category }], session.rng, []);
      refresh();
    },
  };
}

const ready = (name) => new Promise((resolve) => game.events.once(name, resolve));
Promise.all([ready('board-ready'), ready('intro-ready')]).then(([b, i]) => {
  board = b;
  intro = i;
  introMode(true);
  board.loadCards(loadDeck('core'));
  game.events.on('intro-continue', () => {
    if (modalEl.hidden && document.getElementById('app').classList.contains('intro')) openMenu();
  });
});
