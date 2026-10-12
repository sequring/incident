import { candidates, procedureStatus, slotsOf } from './core/engine.js';
import { successChance } from './core/ai.js';
import { TYPE_RU, TYPE_COLOR } from './core/narrator.js';
import { DIFFICULTIES } from './session.js';
import { DECKS } from './core/decks.js';
import { expansions } from './data/index.js';
import { postmortemFacts, emptyForm, toMarkdown, REASONS, ACTION_KINDS } from './postmortem.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

const modal = () => document.getElementById('modal');

let afterClose = null;

export function closeModal() {
  modal().hidden = true;
  delete modal().dataset.locked;
  modal().replaceChildren();
  const f = afterClose;
  afterClose = null;
  f?.();
}

function openSheet(...content) {
  afterClose = null;
  const m = modal();
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
    h('button', { class: 'close', 'aria-label': 'Закрыть', onclick: closeModal }, '×'), ...content);
  m.replaceChildren(sheet);
  m.hidden = false;
  m.onclick = (e) => { if (e.target === m) closeModal(); };
  return sheet;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal().hidden && !modal().dataset.locked) closeModal();
});

const procName = (s, id) => s.byId[id].name_ru;

const plural = (n) => (n === 1 ? 'ход' : n < 5 ? 'хода' : 'ходов');

const STATUS_RU = {
  cooldown: (st) => `Перезарядка: ещё ${st.left} ${plural(st.left)}`,
  removed: (st) => (st.left ? `Процедура недоступна ещё ${st.left} ${plural(st.left)}` : 'Процедура выбыла до конца игры'),
  forced: (st, s, session) => `Сейчас обязательно «${procName(session, s.forced.procId)}»`,
  consultant: () => 'Сначала выберите консультанта',
  over: () => 'Игра окончена',
};

function specialNote(s, id) {
  const { isolation, crisis, callConsultant } = s.deck;
  if (id === isolation) return ['Не раскрывает карт атаки.', 'Особый эффект адаптации: при успехе изоляция сдерживает атаку и даёт +1 ход.'];
  if (id === crisis) return ['Не раскрывает карт атаки.', 'Особый эффект адаптации: при успехе даёт +1 подсказку и снимает штрафы ко всем броскам.'];
  if (id === callConsultant) return ['Не раскрывает карт атаки.', 'При успехе вы выбираете одного из трёх консультантов — у каждого своя способность.'];
  return [];
}

export function showCard(session, id, { onPlay } = {}) {
  const c = session.byId[id];
  const s = session.state;
  const body = [
    h('span', { class: 'tag', style: `background:${TYPE_COLOR[c.type]}` }, TYPE_RU[c.type]),
    h('h2', {}, c.name_ru),
    c.name_en !== c.name_ru && h('div', { class: 'en' }, c.name_en),
    h('p', {}, c.desc_ru),
  ];
  if (c.effect_ru) body.push(h('h3', {}, 'Эффект'), h('p', {}, c.effect_ru));
  if (c.specialties_ru?.length) body.push(h('h3', {}, 'Специализация'), h('p', {}, c.specialties_ru.join(', ')));
  if (c.detections?.length) {
    body.push(h('h3', {}, 'Чем обнаруживается'),
      h('ul', {}, c.detections.map((d) => h('li', { class: s.table.includes(d) ? '' : 'en' }, procName(session, d), s.table.includes(d) ? '' : ' (нет на столе)'))));
  }
  if (c.tools?.length) body.push(h('h3', {}, 'Инструменты'), h('p', {}, c.tools.join(', ')));
  if (c.type === 'procedure' && s.table.includes(id)) {
    const est = s.established.includes(id);
    const st = procedureStatus(s, id);
    body.push(h('h3', {}, 'Применение'));
    body.push(h('p', { class: 'chance' },
      est ? 'Установленная процедура: команда в ней опытна. ' : 'Прочая процедура: без бонуса. ',
      'Шанс успеха сейчас: ', h('b', {}, `${Math.round(successChance(s, id) * 100)}%`)));
    const [warn, note] = specialNote(s, id);
    if (warn) body.push(h('p', { class: 'chance' }, h('b', {}, warn)), h('p', { class: 'chance' }, note));
    const actions = h('div', { class: 'sheet-actions' });
    if (onPlay && st.ok) {
      actions.append(h('button', { class: 'btn primary', onclick: () => { closeModal(); onPlay(id); } }, `Применить (ход ${s.turn})`));
    } else if (!st.ok) {
      actions.append(h('p', { class: 'chance' }, STATUS_RU[st.reason](st, s, session)));
    }
    body.push(actions);
  }
  openSheet(h('div', { class: 'card-view' },
    h('img', { src: c.image, alt: `Оригинал карты: ${c.name_en}` }),
    h('div', {}, body)));
}

// Narrates what an inject actually did this turn (which procedure left, which card was revealed…).
function effectLines(session, cardId) {
  const ev = session.state.history.at(-1)?.events ?? [];
  const start = ev.findIndex((e) => (e.kind === 'inject' || e.kind === 'consultant') && e.cardId === cardId);
  if (start < 0) return [];
  const rest = ev.slice(start + 1);
  const stop = rest.findIndex((e) => e.kind === 'inject' || e.kind === 'consultant' || e.kind === 'end');
  return (stop < 0 ? rest : rest.slice(0, stop)).map((e) => session.narrator.event(e)?.text).filter(Boolean);
}

export function showInject(session, id, onClose) {
  const c = session.byId[id];
  openSheet(h('div', { class: 'card-view' },
    h('img', { src: c.image, alt: `Оригинал карты: ${c.name_en}` }),
    h('div', {},
      h('span', { class: 'tag', style: `background:${TYPE_COLOR.inject}` }, 'Вводная!'),
      h('h2', {}, c.name_ru),
      h('div', { class: 'en' }, c.name_en),
      h('p', {}, c.desc_ru),
      h('h3', {}, 'Эффект'),
      h('p', {}, h('b', {}, c.effect_ru)),
      effectLines(session, id).map((t) => h('p', { class: 'chance' }, t)),
      h('div', { class: 'sheet-actions' }, h('button', { class: 'btn primary', onclick: closeModal }, 'Принято')))));
  afterClose = onClose;
}

export function showConsultantChoice(session, onPick) {
  const offer = session.state.consultantOffer;
  const sheet = openSheet(
    h('h2', {}, 'Вызов консультанта'),
    h('p', { class: 'chance' }, 'Консультант подключается сразу. Выберите одного.'),
    h('div', { class: 'consultants' }, offer.map((id) => {
      const c = session.byId[id];
      return h('div', { class: 'consultant' },
        h('img', { src: c.image, alt: c.name_en, loading: 'lazy' }),
        h('b', {}, c.name_ru),
        h('p', {}, c.effect_ru || c.desc_ru),
        c.specialties_ru?.length && h('p', { class: 'chance' }, c.specialties_ru.slice(0, 4).join(' · ')),
        h('button', { class: 'btn primary', onclick: () => { delete modal().dataset.locked; closeModal(); onPick(id); } }, 'Пригласить'));
    })),
  );
  sheet.querySelector('.close').remove();
  modal().dataset.locked = '1';
  modal().onclick = null;
}

export function showInjects(session) {
  const s = session.state;
  const tile = (id, out) => h('button', { class: out ? 'out' : '', onclick: () => showCard(session, id) },
    h('img', { src: session.byId[id].image, alt: session.byId[id].name_en, loading: 'lazy' }), session.byId[id].name_ru);
  openSheet(
    h('h2', {}, 'Вводные'),
    h('p', { class: 'chance' }, 'Натуральные 1 или 20, а также три провала подряд вытягивают вводную — случайное событие, которое помогает или мешает расследованию. ',
      `Провалов подряд сейчас: ${s.failStreak}/3.`),
    h('h3', {}, `Сыграно: ${s.injectsDrawn.length}`),
    s.injectsDrawn.length
      ? h('div', { class: 'grid-cards' }, s.injectsDrawn.map((id) => tile(id)))
      : h('p', { class: 'chance' }, 'Пока ни одной.'),
    h('h3', {}, `Могут выпасть (в колоде ${s.injectDeck.length})`),
    h('div', { class: 'grid-cards' }, s.injectPool.map((id) => tile(id, !s.injectDeck.includes(id)))),
  );
}

export function showNotebook(session) {
  const s = session.state;
  const cols = slotsOf(s).map((slot) => {
    const t = s.slotType[slot];
    const alive = new Set(candidates(s, slot));
    const extra = slot !== t ? ' (доп. карта)' : '';
    return h('div', { class: 'notebook-col' },
      h('h3', { style: `color:${TYPE_COLOR[t]}` }, `${TYPE_RU[t]}${extra} — ${s.revealed[slot] ? 'раскрыто' : `вариантов: ${alive.size}`}`),
      h('ul', {}, s.deck.attacks[t].map((c) => h('li', {
        class: s.revealed[slot] ? (s.attacks[slot] === c.id ? 'found' : 'out') : alive.has(c.id) ? '' : 'out',
      }, c.name_ru))));
  });
  const clean = [...s.cleanChecks].map((id) => procName(session, id));
  openSheet(
    h('h2', {}, 'Блокнот аналитика'),
    h('p', { class: 'chance' }, 'Успешная процедура, которая ничего не нашла, исключает все ещё не раскрытые атаки, которые она могла бы обнаружить.'),
    h('p', { class: 'chance' }, 'Чистые проверки: ', clean.length ? clean.join(', ') : 'пока нет'),
    ...cols,
  );
}

export function showReference(session) {
  const grid = (type) => h('div', { class: 'grid-cards' }, session.cards.filter((c) => c.type === type).map((c) =>
    h('button', { onclick: () => showCard(session, c.id) }, h('img', { src: c.image, alt: c.name_en, loading: 'lazy' }), c.name_ru)));
  openSheet(h('h2', {}, 'Справочник карт'),
    ...['initial', 'pivot', 'persist', 'c2', 'procedure', 'inject', 'consultant']
      .filter((t) => session.cards.some((c) => c.type === t))
      .flatMap((t) => [h('h3', { style: `color:${TYPE_COLOR[t]}` }, TYPE_RU[t]), grid(t)]));
}

export function showRules(back) {
  const sheet = openSheet(
    h('h2', {}, 'Правила'),
    h('p', {}, 'Я тайно выбрал 4 карты атаки — по одной из каждой категории: первоначальный доступ; повышение привилегий и перемещение; закрепление; управление и контроль, эксфильтрация. Ваша задача — раскрыть все четыре до конца отведённых ходов.'),
    h('h3', {}, 'Ход'),
    h('ol', {},
      h('li', {}, 'Прочитайте журнал и решите, какую процедуру обнаружения применить. Клик по карте — описание на русском.'),
      h('li', {}, 'Бросок d20: 11 и выше — успех. Установленные процедуры дают +3.'),
      h('li', {}, 'При успехе раскрывается одна карта атаки, которую ловит эта процедура (по порядку цепочки атаки). Если раскрывать нечего — это тоже информация: версия вычёркивается.'),
      h('li', {}, 'Использованная процедура уходит на перезарядку на 3 хода.')),
    h('h3', {}, 'Вводные'),
    h('p', {}, 'Натуральные 1 или 20, а также три провала подряд вызывают случайную вводную — внезапное событие, которое помогает или мешает.'),
    h('h3', {}, 'Подсказки'),
    h('p', {}, 'В начале у вас 3 подсказки. Я описываю симптом одной из нераскрытых атак — что видят пользователи, админы или журналы, — не называя саму технику. Ход на это не тратится. Успешное «Кризисное управление» даёт ещё одну подсказку.'),
    h('h3', {}, 'Консультанты (в расширениях)'),
    h('p', {}, 'Успешный «Вызов консультанта» позволяет выбрать одного из трёх консультантов. Каждый даёт свою способность: бонус к броскам, раскрытие карты, лишний ход и т. п.'),
    h('h3', {}, 'Отличия адаптации'),
    h('ul', {},
      h('li', {}, '«Изоляция» при успехе даёт +1 ход, «Кризисное управление» — +1 подсказку и снятие штрафа от утечки.'),
      h('li', {}, 'Вводная «Это был пентест», как и в оригинале, сразу завершает игру разбором. Её можно отключить в меню.')),
  );
  if (typeof back === 'function') {
    sheet.querySelector('.close').replaceWith(h('button', { class: 'close', 'aria-label': 'Назад', onclick: back }, '×'));
    sheet.append(h('div', { class: 'sheet-actions' }, h('button', { class: 'btn primary', onclick: back }, 'Назад в меню')));
    modal().dataset.locked = '1';
    modal().onclick = null;
  }
}

function choiceGroup(items, selected, render) {
  let value = selected;
  const buttons = items.map(([key, item]) => h('button', {
    class: `diff${key === value ? ' selected' : ''}`, 'data-key': key,
    onclick: (e) => {
      value = key;
      buttons.forEach((b) => b.classList.toggle('selected', b.dataset.key === key));
      e.currentTarget.blur();
    },
  }, ...render(item)));
  return { buttons, get: () => value };
}

export function showMenu(onStart, defaults = { deck: 'core', difficulty: 'normal', classicInjects: true }) {
  const diff = choiceGroup(Object.entries(DIFFICULTIES), defaults.difficulty, (d) => [h('b', {}, d.label), h('span', {}, d.note)]);
  const available = DECKS.filter((d) => d.key === 'core' || d.key === 'all' || expansions[d.key]);
  const deck = choiceGroup(available.map((d) => [d.key, d]), defaults.deck ?? 'core', (d) => [h('b', {}, d.title), h('span', {}, d.note)]);
  const pentest = h('input', { type: 'checkbox', id: 'pentest', checked: defaults.classicInjects });
  const settings = () => ({ deck: deck.get(), difficulty: diff.get(), classicInjects: pentest.checked });
  const sheet = openSheet(h('div', { class: 'menu' },
    h('div', { class: 'cy-label' }, '// ТЕРМИНАЛ РЕАГИРОВАНИЯ'),
    h('h2', { class: 'glitch', 'data-text': 'ИНЦИДЕНТ' }, 'ИНЦИДЕНТ'),
    h('p', { class: 'cy-sub' }, '> выберите цель и уровень доступа'),
    h('h3', {}, '01 · Объект атаки'),
    h('div', { class: 'diffs decks' }, deck.buttons),
    h('h3', {}, '02 · Сложность'),
    h('div', { class: 'diffs' }, diff.buttons),
    h('label', { class: 'toggle', for: 'pentest' }, pentest, 'Вводные, досрочно завершающие игру (как в оригинале)'),
    h('div', { class: 'sheet-actions', style: 'justify-content:center' },
      h('button', { class: 'btn primary', onclick: () => { closeModal(); onStart(settings()); } }, 'Начать расследование'),
      h('button', { class: 'btn', onclick: () => showRules(() => showMenu(onStart, settings())) }, 'Правила')),
    h('p', { class: 'legal' },
      'Backdoors & Breaches™ — игра Black Hills Information Security и Antisyphon Training. ',
      'Изображения карт взяты из ', h('a', { href: 'https://github.com/blackhillsinfosec/play.backdoorsandbreaches.com', target: '_blank', rel: 'noopener' }, 'открытого репозитория'),
      ' (GPL-3.0). Это фанатская адаптация, не связанная с правообладателем.')));
  sheet.classList.add('cyber');
  sheet.querySelector('.close').remove();
  modal().dataset.locked = '1';
  modal().onclick = null;
}

function typewriter(el, text, speed = 16) {
  let i = 0;
  el.classList.add('typing');
  const done = () => { clearInterval(timer); el.textContent = text; el.classList.remove('typing'); };
  const timer = setInterval(() => {
    i += 2;
    el.textContent = text.slice(0, i);
    if (i >= text.length) done();
  }, speed);
  return done;
}

const pad = (n, l = 2) => String(n).padStart(l, '0');

export function showBriefing(session, onAccept) {
  const s = session.state;
  const deck = DECKS.find((d) => d.key === session.deckKey);
  const init = session.byId[s.attacks.initial];
  const now = new Date();
  const hh = pad(2 + Math.floor(Math.random() * 5));
  const mm = pad(Math.floor(Math.random() * 60));
  const incId = `INC-${now.getFullYear()}-${pad(now.getMonth() + 1)}${pad(now.getDate())}-${hh}${mm}`;
  const date = now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const speech = `[${hh}:${mm} · ${date}] Дежурная смена SOC подняла тревогу. ${init.clues_ru?.[0] ?? init.desc_ru} `
    + 'Это не единичный эпизод: злоумышленники вошли, повысили привилегии, закрепились и наладили канал управления. Восстановите цепочку.';
  const said = h('p', { class: 'speech' });
  const finish = typewriter(said, speech);
  const accept = () => { finish(); delete modal().dataset.locked; closeModal(); onAccept(); };
  const panel = (title, ...body) => h('section', { class: 'cy-panel' }, h('h3', {}, title), ...body);
  const sheet = openSheet(
    h('div', { class: 'briefing' },
      h('div', { class: 'brief-head' },
        h('span', { class: 'cy-label' }, `// ВХОДЯЩИЙ ИНЦИДЕНТ · ${incId}`),
        h('span', { class: 'rec' }, '● REC')),
      h('h2', { class: 'glitch', 'data-text': 'БРИФИНГ' }, 'БРИФИНГ'),
      h('div', { class: 'threat' },
        h('span', {}, 'УРОВЕНЬ УГРОЗЫ'),
        h('span', { class: 'threat-bar' }, Array.from({ length: 10 }, (_, i) => h('i', { class: i < 8 ? 'on' : '' }))),
        h('b', {}, 'КРИТИЧЕСКИЙ')),
      panel('Объект', h('p', { class: 'org' }, deck?.org), h('p', { class: 'cy-dim' }, `Колода: ${deck?.title}`)),
      panel('Перехват', said),
      h('div', { class: 'brief-grid' },
        panel(`Цель · ${s.maxTurns} ходов`,
          h('div', { class: 'mini-chain' }, ['initial', 'pivot', 'persist', 'c2'].map((t, i) =>
            h('span', { style: `--c:${TYPE_COLOR[t]}` }, h('em', {}, `0${i + 1}`), TYPE_RU[t], h('em', {}, '???'))))),
        panel(`Арсенал команды · +${s.options.establishedBonus}`,
          h('ul', { class: 'arsenal' }, s.established.map((id) => h('li', {}, procName(session, id)))))),
      panel('Протокол',
        h('ol', { class: 'brief-rules' },
          h('li', {}, 'Выбирайте процедуру обнаружения и бросайте d20: 11+ — успех.'),
          h('li', {}, 'Успех раскрывает звено атаки, которое ловит эта процедура. «Чисто» — тоже подсказка: смотрите блокнот аналитика.'),
          h('li', {}, 'Процедура уходит на перезарядку на 3 хода. 1, 20 и три провала подряд — вводная.'),
          h('li', {}, 'Три бесплатные подсказки о симптомах — кнопка «Подсказка».'))),
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn primary', onclick: accept }, 'Принять инцидент'),
        h('button', { class: 'btn', onclick: finish }, 'Пропустить печать'))),
  );
  sheet.classList.add('wide', 'cyber');
  sheet.querySelector('.close').remove();
  modal().dataset.locked = '1';
  modal().onclick = null;
}

const END = {
  won: { title: 'ЦЕПОЧКА ВОССТАНОВЛЕНА', tag: 'ИНЦИДЕНТ ЛОКАЛИЗОВАН' },
  lost: { title: 'СИГНАЛ ПОТЕРЯН', tag: 'ЗЛОУМЫШЛЕННИКИ УШЛИ' },
  pentest: { title: 'ЭТО БЫЛ ПЕНТЕСТ', tag: 'СЕССИЯ ПРЕРВАНА' },
};

export function showEnd(session, onRestart) {
  const s = session.state;
  const meta = END[s.status] ?? END.lost;
  const slots = slotsOf(s);
  const found = Object.keys(s.revealed).length;
  const turns = s.history.length;
  const hits = s.history.filter((e) => e.success).length;
  const now = new Date();
  const report = `RPT-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const summary = s.status === 'won'
    ? `Все ${slots.length} звена раскрыты за ${turns} ${turns === 1 ? 'ход' : turns < 5 ? 'хода' : 'ходов'}. Злоумышленники обнаружены и выдворены.`
    : s.status === 'pentest'
      ? `Сессия завершена досрочно: атаковали нанятые пентестеры. До этого вы раскрыли ${found} из ${slots.length}.`
      : `Раскрыто ${found} из ${slots.length}. Время вышло — часть цепочки осталась в тени.`;
  const stat = (label, value) => h('div', { class: 'stat' }, h('b', {}, value), h('span', {}, label));
  const sheet = openSheet(
    h('div', { class: `ending ${s.status}` },
      h('div', { class: 'brief-head' },
        h('span', { class: 'cy-label' }, `// ОТЧЁТ ${report} · ${DECKS.find((d) => d.key === session.deckKey)?.title ?? ''}`),
        h('span', { class: 'end-tag' }, meta.tag)),
      h('h2', { class: 'glitch', 'data-text': meta.title }, meta.title),
      h('p', { class: 'end-summary' }, summary),
      h('div', { class: 'stats' },
        stat('раскрыто', `${found}/${slots.length}`),
        stat('ходов', String(turns)),
        stat('успешных бросков', `${hits}/${turns}`),
        stat('вводных', String(s.injectsDrawn.length)),
        stat('консультантов', String(s.consultants.length))),
      h('section', { class: 'cy-panel' },
        h('h3', {}, 'Цепочка атаки'),
        h('div', { class: 'chain' }, slots.map((slot, i) => {
          const c = session.byId[s.attacks[slot]];
          const ok = !!s.revealed[slot];
          const [cls, label] = ok ? ['hit', 'ОБНАРУЖЕНО'] : s.status === 'pentest' ? ['shown', 'ПОКАЗАНО'] : ['missed', 'УПУЩЕНО'];
          return h('figure', { class: cls, style: `--c:${TYPE_COLOR[s.slotType[slot]]}` },
            h('div', { class: 'fig-head' }, h('em', {}, pad(i + 1)), h('span', {}, label)),
            h('button', { class: 'fig-img', onclick: () => showCard(session, c.id) }, h('img', { src: c.image, alt: c.name_en })),
            h('figcaption', {}, h('b', {}, c.name_ru), h('em', {}, 'Ловится: ' + c.detections.map((d) => procName(session, d)).join(', '))));
        }))),
      h('section', { class: 'cy-panel' },
        h('h3', {}, 'Разбор'),
        h('p', { class: 'cy-dim' }, 'Какие из этих процедур реально работают в вашей компании? Что помешало бы им сработать — бюджет, люди, политика, технологии?')),
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn primary', onclick: () => showPostmortem(session, () => showEnd(session, onRestart)) }, 'Постмортем'),
        h('button', { class: 'btn', onclick: onRestart }, 'Новое расследование'),
        h('button', { class: 'btn', onclick: closeModal }, 'Вернуться к столу'))),
  );
  sheet.classList.add('wide', 'cyber');
}

export function renderSidebar(root, session, handlers) {
  const s = session.state;
  const left = s.maxTurns - s.turn + 1;
  const effects = [];
  const chip = (cls, text, onclick) => effects.push(h(onclick ? 'button' : 'span', { class: `chip ${cls}`, onclick }, text));
  const left_ = (until) => (until === Infinity ? '' : ` · ${until - s.turn + 1} х.`);
  const targetRu = (m) => ({ all: 'ко всем', established: 'к установленным', other: 'к прочим' })[m.target] ?? `к «${m.procIds.map((id) => procName(session, id)).join('», «')}»`;
  for (const m of s.mods.filter((m) => m.until >= s.turn)) {
    chip(m.value > 0 ? 'good' : 'bad', `${m.value > 0 ? '+' : '−'}${Math.abs(m.value)} ${targetRu(m)}${left_(m.until)}`);
  }
  if (s.noBonusUntil >= s.turn) chip('bad', `Без бонуса установленных${left_(s.noBonusUntil)}`);
  if (s.advantage.until >= s.turn || s.advantage.count) chip('good', 'Преимущество 2d20');
  if (s.disadvantage.until >= s.turn || s.disadvantage.count) chip('bad', 'Помеха 2d20');
  if (s.rerolls) chip('good', `Переброс ×${s.rerolls}`);
  if (s.autoSuccess) chip('good', `Провал → успех ×${s.autoSuccess}`);
  if (s.forced) chip('bad', `Обязательно: ${procName(session, s.forced.procId)}`);
  if (s.failStreak) chip('', `Провалов подряд: ${s.failStreak}/3`);
  const removed = Object.keys(s.removed).filter((id) => s.removed[id] >= s.turn);
  if (removed.length) chip('bad', `Выбыло: ${removed.map((id) => procName(session, id)).join(', ')}`);
  for (const id of s.consultants) chip('good', `Консультант: ${session.byId[id].name_ru}`, () => showCard(session, id));

  const pips = Array.from({ length: s.maxTurns }, (_, i) =>
    h('i', { class: (i < s.turn - 1 ? 'used' : '') + (i >= s.options.maxTurns ? ' bonus' : '') }));

  const log = h('div', { class: 'log', 'aria-live': 'polite' },
    session.log.map((l) => h('p', { class: l.tone }, h('small', {}, `Ход ${l.turn}`), l.text)));

  root.replaceChildren(
    h('div', { class: 'status' },
      h('h1', {}, `ИНЦИДЕНТ · ${DECKS.find((d) => d.key === session.deckKey)?.title ?? ''}`),
      s.status === 'playing'
        ? h('div', { class: `turn${left <= 2 ? ' alert' : ''}` }, h('b', {}, `Ход ${s.turn}`), h('span', {}, `из ${s.maxTurns} · осталось ${left}`))
        : h('div', { class: 'turn' }, h('b', {}, 'Конец'), h('span', {}, `раскрыто ${Object.keys(s.revealed).length}/${slotsOf(s).length}`)),
      h('div', { class: 'pips' }, pips),
      h('div', { class: 'effects' }, effects)),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', disabled: !session.hintsLeft || s.status !== 'playing', onclick: handlers.hint }, `Подсказка (${session.hintsLeft})`),
      h('button', { class: 'btn', onclick: () => showNotebook(session) }, 'Блокнот аналитика'),
      h('button', { class: 'btn', onclick: () => showReference(session) }, 'Справочник карт'),
      h('button', { class: 'btn', onclick: () => showRules() }, 'Правила'),
      s.status !== 'playing'
        ? h('button', { class: 'btn primary wide', onclick: handlers.results }, 'Итоги и разбор')
        : h('button', { class: 'btn wide', onclick: handlers.restart }, 'Новая игра')),
    log,
  );
  log.scrollTop = log.scrollHeight;
}

const pmKey = (id) => `postmortem:${id}`;

function loadForm(facts) {
  try {
    const saved = JSON.parse(localStorage.getItem(pmKey(facts.id)) ?? 'null');
    if (saved) return { ...emptyForm(facts), ...saved };
  } catch { /* storage unavailable */ }
  return emptyForm(facts);
}

function saveForm(id, form) {
  try { localStorage.setItem(pmKey(id), JSON.stringify(form)); } catch { /* storage unavailable */ }
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function showPostmortem(session, back) {
  const facts = postmortemFacts(session, DECKS.find((d) => d.key === session.deckKey)?.title ?? '');
  const form = loadForm(facts);
  const save = () => saveForm(facts.id, form);
  const field = (key, label, rows = 3, placeholder = '') => h('label', { class: 'pm-field', for: `pm-${key}` },
    h('span', {}, label),
    h('textarea', { id: `pm-${key}`, rows, placeholder, oninput: (e) => { form[key] = e.target.value; save(); } }, form[key]));
  const status = h('span', { class: 'pm-status', 'aria-live': 'polite' });
  const flash = (text) => { status.textContent = text; setTimeout(() => { status.textContent = ''; }, 2500); };

  const gapBlocks = facts.chain.map((c) => {
    const g = form.gaps[c.slot] ??= { reason: c.found ? '' : REASONS[0], comment: '', have: {} };
    return h('div', { class: `pm-gap ${c.found ? 'hit' : 'missed'}` },
      h('div', { class: 'pm-gap-head' },
        h('b', {}, `${c.type}: ${c.name}`),
        h('span', {}, c.found ? `обнаружено · ход ${c.revealed?.turn ?? '—'} · ${c.revealed?.how ?? ''}` : 'упущено')),
      h('p', { class: 'cy-dim' }, 'Какие из процедур, ловящих эту технику, реально есть у вас?'),
      h('ul', { class: 'pm-have' }, c.detections.map((d) => {
        const sel = h('select', { id: `pm-have-${c.slot}-${d.id}`, onchange: (e) => {
          const v = e.target.value;
          if (v === '') delete g.have[d.id]; else g.have[d.id] = v === 'yes';
          save();
        } },
        h('option', { value: '' }, '— не оценено'),
        h('option', { value: 'yes' }, 'есть'),
        h('option', { value: 'no' }, 'нет'));
        sel.value = g.have[d.id] === true ? 'yes' : g.have[d.id] === false ? 'no' : '';
        return h('li', {}, h('label', { for: sel.id }, d.name), sel);
      })),
      !c.found && h('label', { class: 'pm-inline', for: `pm-reason-${c.slot}` }, h('span', {}, 'Почему не обнаружили'),
        (() => {
          const sel = h('select', { id: `pm-reason-${c.slot}`, onchange: (e) => { g.reason = e.target.value; save(); } },
            REASONS.map((r) => h('option', { value: r }, r)));
          sel.value = g.reason || REASONS[0];
          return sel;
        })()),
      h('textarea', { id: `pm-comment-${c.slot}`, rows: 2, placeholder: 'Комментарий: что мешает в реальности, что нужно', oninput: (e) => { g.comment = e.target.value; save(); } }, g.comment));
  });

  const actionsBody = h('tbody');
  const renderActions = () => {
    actionsBody.replaceChildren(...form.actions.map((a, i) => {
      const input = (key, ph) => h('input', { id: `pm-act-${i}-${key}`, value: a[key], placeholder: ph, 'aria-label': ph, oninput: (e) => { a[key] = e.target.value; save(); } });
      const kind = h('select', { id: `pm-act-${i}-kind`, 'aria-label': 'Тип', onchange: (e) => { a.kind = e.target.value; save(); } }, ACTION_KINDS.map((k) => h('option', { value: k }, k)));
      kind.value = a.kind;
      return h('tr', {},
        h('td', {}, input('what', 'Что сделать')),
        h('td', {}, input('owner', 'Кто')),
        h('td', {}, input('due', 'Срок')),
        h('td', {}, kind),
        h('td', {}, h('button', { class: 'pm-del', 'aria-label': 'Удалить задачу', onclick: () => { form.actions.splice(i, 1); save(); renderActions(); } }, '×')));
    }));
  };
  renderActions();

  const md = () => toMarkdown(facts, form);
  const sheet = openSheet(h('div', { class: 'postmortem' },
    h('div', { class: 'brief-head' }, h('span', { class: 'cy-label' }, `// ${facts.id} · ${facts.deck} · ${facts.date}`), h('span', { class: 'end-tag' }, facts.result)),
    h('h2', { class: 'glitch', 'data-text': 'ПОСТМОРТЕМ' }, 'ПОСТМОРТЕМ'),
    h('p', { class: 'cy-dim' }, 'Формат blameless: ищем пробелы в процессах и инструментах, а не виноватых. Черновик сохраняется в браузере автоматически.'),
    h('section', { class: 'cy-panel' }, h('h3', {}, 'Участники и резюме'),
      h('label', { class: 'pm-field', for: 'pm-participants' }, h('span', {}, 'Участники и роли'),
        h('input', { id: 'pm-participants', value: form.participants, placeholder: 'Анна — SOC L2, Игорь — сетевик, Ольга — ИБ-руководитель', oninput: (e) => { form.participants = e.target.value; save(); } })),
      field('summary', 'Краткое описание инцидента', 3, 'Что произошло, как обнаружили, чем закончилось — 3–5 предложений')),
    h('section', { class: 'cy-panel' }, h('h3', {}, 'Пробелы в обнаружении'), ...gapBlocks),
    h('section', { class: 'cy-panel' }, h('h3', {}, 'Хронология'),
      h('div', { class: 'pm-table' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Ход', 'Процедура', 'Бросок', 'Итог', 'События'].map((t) => h('th', {}, t)))),
        h('tbody', {}, facts.timeline.map((t) => h('tr', { class: t.success ? 'ok' : 'bad' },
          h('td', {}, String(t.turn)), h('td', {}, t.proc),
          h('td', {}, `${t.roll}${t.mod ? ` ${t.mod > 0 ? '+' : '−'}${Math.abs(t.mod)}` : ''} = ${t.total}`),
          h('td', {}, t.success ? 'успех' : 'провал'), h('td', {}, t.notes.join('; ') || '—'))))))),
    h('section', { class: 'cy-panel' }, h('h3', {}, 'Выводы'),
      h('div', { class: 'pm-lessons' },
        field('wentWell', 'Что сработало', 4),
        field('wentWrong', 'Что не сработало', 4),
        field('lucky', 'Где повезло', 4))),
    h('section', { class: 'cy-panel' }, h('h3', {}, 'Задачи'),
      h('div', { class: 'pm-table' }, h('table', { class: 'pm-actions' },
        h('thead', {}, h('tr', {}, ['Действие', 'Ответственный', 'Срок', 'Тип', ''].map((t) => h('th', {}, t)))), actionsBody)),
      h('button', { class: 'btn', onclick: () => { form.actions.push({ what: '', owner: '', due: '', kind: ACTION_KINDS[1] }); save(); renderActions(); } }, 'Добавить задачу')),
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn primary', onclick: () => { download(`postmortem-${facts.id}.md`, md()); flash('Файл скачан'); } }, 'Скачать .md'),
      h('button', { class: 'btn', onclick: () => {
        navigator.clipboard?.writeText(md()).then(() => flash('Markdown скопирован'), () => flash('Не удалось скопировать — используйте «Скачать .md»'));
      } }, 'Скопировать Markdown'),
      h('button', { class: 'btn', onclick: back }, 'Назад к итогам'),
      status)));
  sheet.classList.add('wide', 'cyber');
}
