import { slotsOf } from './core/engine.js';
import { TYPE_RU } from './core/narrator.js';

export const REASONS = ['Не попробовали', 'Бюджет', 'Люди', 'Политика', 'Технологии', 'Не повезло с броском'];
export const ACTION_KINDS = ['Предотвратить', 'Обнаружить', 'Сдержать', 'Восстановить', 'Процесс'];
const RESULT_RU = { won: 'Атака раскрыта полностью', lost: 'Время вышло', pentest: 'Прервано: это был пентест', playing: 'Игра не завершена' };

const pad = (n) => String(n).padStart(2, '0');

export function reportId(date) {
  return `INC-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function eventNote(ev, name) {
  switch (ev.kind) {
    case 'reveal': return ev.cause === 'pentest' ? null : `раскрыто: ${name(ev.cardId)}`;
    case 'clean': return 'чисто';
    case 'inject': return `вводная: ${name(ev.cardId)}`;
    case 'consultant': return `консультант: ${name(ev.cardId)}`;
    case 'attack_added': return `добавлена скрытая карта: ${TYPE_RU[ev.type]}`;
    case 'skipped': return 'ход потерян';
    case 'bonus_turn': return `+${ev.count} ход`;
    case 'hint_gained': return '+1 подсказка';
    default: return null;
  }
}

// Everything the game knows about the session, in a form both the UI and the Markdown export use.
export function postmortemFacts(session, deckTitle) {
  const s = session.state;
  const name = (id) => session.byId[id].name_ru;
  const revealedBy = {};
  for (const entry of s.history) {
    for (const ev of entry.events) {
      if (ev.kind === 'reveal' && ev.cause !== 'pentest') {
        revealedBy[ev.slot] = { turn: entry.turn, how: ev.cause === 'detection' ? name(entry.procId) : 'эффект карты' };
      }
    }
  }
  return {
    id: reportId(session.startedAt),
    date: session.startedAt.toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' }),
    deck: deckTitle,
    result: RESULT_RU[s.status],
    status: s.status,
    turnsUsed: s.history.length,
    maxTurns: s.maxTurns,
    chain: slotsOf(s).map((slot) => {
      const card = session.byId[s.attacks[slot]];
      return {
        slot,
        type: TYPE_RU[s.slotType[slot]],
        name: card.name_ru,
        found: Boolean(s.revealed[slot]),
        revealed: revealedBy[slot] ?? null,
        detections: card.detections.map((id) => ({ id, name: name(id), onTable: s.table.includes(id) })),
      };
    }),
    timeline: s.history.map((e) => ({
      turn: e.turn,
      proc: name(e.procId),
      roll: e.roll,
      mod: e.mod,
      total: e.total,
      success: e.success,
      notes: e.events.map((ev) => eventNote(ev, name)).filter(Boolean),
    })),
    injects: s.injectsDrawn.map(name),
    consultants: s.consultants.map(name),
  };
}

export const emptyForm = (facts) => ({
  participants: '',
  summary: '',
  wentWell: '',
  wentWrong: '',
  lucky: '',
  gaps: Object.fromEntries(facts.chain.map((c) => [c.slot, { reason: c.found ? '' : REASONS[0], comment: '', have: {} }])),
  actions: [{ what: '', owner: '', due: '', kind: ACTION_KINDS[1] }],
});

const block = (text) => (text?.trim() ? text.trim() : '_не заполнено_');
const cell = (text) => (text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim() || '—';

export function toMarkdown(f, form) {
  const lines = [];
  const add = (...l) => lines.push(...l);
  add(`# Постмортем ${f.id}`, '');
  add('Формат blameless: ищем пробелы в процессах и инструментах, а не виноватых.', '');
  add(`- **Дата учений:** ${f.date}`, `- **Колода:** ${f.deck}`, `- **Итог:** ${f.result}`,
    `- **Ходов использовано:** ${f.turnsUsed} из ${f.maxTurns}`, `- **Участники:** ${block(form.participants)}`, '');
  add('## Краткое описание', '', block(form.summary), '');

  add('## Цепочка атаки', '', '| Звено | Карта | Итог | Чем раскрыто |', '|---|---|---|---|');
  for (const c of f.chain) {
    add(`| ${c.type} | ${cell(c.name)} | ${c.found ? 'обнаружено' : 'упущено'} | ${c.revealed ? `ход ${c.revealed.turn}, ${cell(c.revealed.how)}` : '—'} |`);
  }
  add('');

  add('## Пробелы в обнаружении', '');
  for (const c of f.chain) {
    const g = form.gaps[c.slot] ?? { have: {} };
    add(`### ${c.type}: ${c.name} — ${c.found ? 'обнаружено' : 'упущено'}`, '');
    add('Процедуры, которые ловят эту технику, и есть ли они у нас на самом деле:', '');
    for (const d of c.detections) {
      const v = g.have?.[d.id];
      add(`- [${v === true ? 'x' : ' '}] ${d.name}${v === false ? ' — **нет**' : v === undefined ? ' — не оценено' : ''}`);
    }
    if (!c.found && g.reason) add('', `**Почему не обнаружили:** ${g.reason}`);
    if (g.comment?.trim()) add('', g.comment.trim());
    add('');
  }

  add('## Хронология', '', '| Ход | Процедура | Бросок | Результат | События |', '|---|---|---|---|---|');
  for (const t of f.timeline) {
    const mod = t.mod ? ` ${t.mod > 0 ? '+' : '−'}${Math.abs(t.mod)}` : '';
    add(`| ${t.turn} | ${cell(t.proc)} | ${t.roll}${mod} = ${t.total} | ${t.success ? 'успех' : 'провал'} | ${cell(t.notes.join('; '))} |`);
  }
  add('');
  if (f.injects.length) add(`**Вводные:** ${f.injects.join('; ')}`, '');
  if (f.consultants.length) add(`**Консультанты:** ${f.consultants.join('; ')}`, '');

  add('## Выводы', '', '### Что сработало', '', block(form.wentWell), '', '### Что не сработало', '', block(form.wentWrong), '',
    '### Где повезло', '', block(form.lucky), '');

  add('## Задачи', '', '| Действие | Ответственный | Срок | Тип |', '|---|---|---|---|');
  const actions = form.actions.filter((a) => a.what.trim());
  if (!actions.length) add('| _нет задач_ | — | — | — |');
  for (const a of actions) add(`| ${cell(a.what)} | ${cell(a.owner)} | ${cell(a.due)} | ${a.kind} |`);
  add('');
  return lines.join('\n');
}
