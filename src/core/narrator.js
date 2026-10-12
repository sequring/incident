export const TYPE_RU = {
  initial: 'Первоначальный доступ',
  pivot: 'Повышение привилегий и перемещение',
  persist: 'Закрепление',
  c2: 'Управление и контроль, эксфильтрация',
  procedure: 'Процедура обнаружения',
  inject: 'Вводная',
  consultant: 'Консультант',
};

export const TYPE_COLOR = {
  initial: '#e05561',
  pivot: '#e0b050',
  persist: '#a98be0',
  c2: '#d98a4e',
  procedure: '#39d98a',
  inject: '#8fa89a',
  consultant: '#5fc7d9',
};

const FAIL_REASONS = [
  'Финансы: лицензия на нужный модуль истекла в прошлом месяце — продление «согласовывается».',
  'Финансы: хранение логов урезали до 3 дней ради экономии. Нужный период уже перезаписан.',
  'Политика: владелец системы запретил трогать прод «до конца квартального отчёта».',
  'Политика: юристы требуют письменного согласования на анализ данных сотрудников. Ждём.',
  'Персонал: единственный, кто умеет работать с этим инструментом, в отпуске без связи.',
  'Персонал: ночная смена SOC — два человека на 400 алертов. Нужное событие утонуло в шуме.',
  'Технологии: агент на критичных хостах не установлен — «мешал производительности».',
  'Технологии: часы на серверах рассинхронизированы на 40 минут, корреляция событий развалилась.',
  'Технологии: злоумышленники почистили журналы, а пересылка на центральный сервер не была настроена.',
  'Технологии: правило детектирования было в режиме «только аудит», алерт никто не увидел.',
];

const CLEAN_LINES = [
  'Процедура отработала чисто — и ничего не нашла. Значит, этой дорогой злоумышленники не ходили (или уже ушли).',
  'Отличная работа, но по этому направлению следов нет. Вычёркиваем версию.',
  'Всё проверено, всё чисто. Отрицательный результат — тоже результат.',
];

const REVEAL_LINES = {
  initial: 'Мы поняли, как они вошли!',
  pivot: 'Нашли, как они двигались по сети и повышали привилегии!',
  persist: 'Обнаружили, как они закрепились в системе!',
  c2: 'Перехватили канал управления и вывода данных!',
};

const turnsRu = (n) => `${n} ${n === 1 ? 'ход' : n < 5 ? 'хода' : 'ходов'}`;
const signed = (v) => (v > 0 ? `+${v}` : `−${Math.abs(v)}`);

export function createNarrator(byId, rng) {
  const name = (id) => byId[id].name_ru;
  const usedClues = new Set();
  const targetRu = (ev) => ({
    all: 'ко всем броскам',
    established: 'к установленным процедурам',
    other: 'к прочим процедурам',
    procs: `к «${(ev.procIds ?? []).map(name).join('», «')}»`,
  })[ev.target];

  return {
    intro(state) {
      const init = state.attacks.initial;
      usedClues.add(`${init}:0`);
      return [byId[init].clues_ru?.[0] ?? byId[init].desc_ru];
    },
    hint(state) {
      const all = Object.entries(state.attacks)
        .filter(([t]) => !state.revealed[t])
        .flatMap(([slot, id]) => (byId[id].clues_ru ?? []).map((text, i) => ({ type: state.slotType[slot], key: `${id}:${i}`, text })));
      const fresh = all.filter((c) => !usedClues.has(c.key));
      const clue = rng.pick(fresh.length ? fresh : all);
      usedClues.add(clue.key);
      return `Подсказка (${TYPE_RU[clue.type]}): ${clue.text}`;
    },
    event(ev) {
      switch (ev.kind) {
        case 'roll': {
          const mods = ev.mod.parts.filter((p) => p.value).map((p) => signed(p.value)).join(' ');
          const dice = ev.dice.length > 1 ? ` (${ev.mode === 'advantage' ? 'лучший' : 'худший'} из ${ev.dice.join(' и ')})` : '';
          const nat = ev.roll === 20 ? ' Натуральная 20!' : ev.roll === 1 ? ' Натуральная 1…' : '';
          return { tone: 'roll', text: `«${name(ev.procId)}»: бросок d20 = ${ev.roll}${dice}${mods ? ' ' + mods : ''} → ${ev.total}. ${ev.success ? 'Успех.' : 'Провал.'}${nat}` };
        }
        case 'reroll': return { tone: 'roll', text: `Переброс: ${ev.roll} → ${ev.total}. ${ev.success ? 'Успех!' : 'Снова провал.'}` };
        case 'auto_success': return { tone: 'reveal', text: 'Провал засчитан как успех благодаря консультанту.' };
        case 'reveal':
          if (ev.cause === 'pentest') return { tone: 'reveal', text: `Раскрыто: ${TYPE_RU[ev.type]} — «${name(ev.cardId)}».` };
          return { tone: 'reveal', text: `${REVEAL_LINES[ev.type]} ${TYPE_RU[ev.type]}: «${name(ev.cardId)}».` };
        case 'clean': return { tone: 'info', text: rng.pick(CLEAN_LINES) };
        case 'fail': return { tone: 'fail', text: rng.pick(FAIL_REASONS) };
        case 'inject': return { tone: 'inject', text: `ВВОДНАЯ: «${name(ev.cardId)}». ${byId[ev.cardId].effect_ru ?? ''}` };
        case 'consultant_offer': return { tone: 'reveal', text: 'Консультант на связи! Выберите, кого подключить к расследованию.' };
        case 'consultant': return { tone: 'reveal', text: `Подключён консультант ${name(ev.cardId)}. ${byId[ev.cardId].effect_ru ?? ''}` };
        case 'forced': return { tone: 'inject', text: `Следующий ход — только «${name(ev.procId)}».` };
        case 'modifier': return { tone: ev.value > 0 ? 'reveal' : 'fail', text: `${signed(ev.value)} ${targetRu(ev)} ${ev.turns ? `на ${turnsRu(ev.turns)}` : 'до конца игры'}.` };
        case 'removed': return { tone: 'inject', text: `Процедура «${name(ev.procId)}» недоступна ${ev.turns ? `${turnsRu(ev.turns)}` : 'до конца игры'}.` };
        case 'skip': return { tone: 'inject', text: ev.count > 1 ? `Следующие ${ev.count} хода будут потеряны.` : 'Следующий ход будет потерян.' };
        case 'skipped': return { tone: 'fail', text: 'Ход потерян.' };
        case 'nobonus': return { tone: 'inject', text: `Установленные процедуры ${turnsRu(ev.turns)} работают без бонуса.` };
        case 'penalty_cleared': return { tone: 'reveal', text: 'Коммуникация выстроена, паника улеглась: штрафы ко всем броскам сняты.' };
        case 'hint_gained': return { tone: 'reveal', text: 'Штаб собран, бизнес делится наблюдениями: +1 подсказка.' };
        case 'bonus_turn': return { tone: 'reveal', text: `Выиграно время: +${turnsRu(ev.count)}.` };
        case 'cooldowns_reset': return { tone: 'reveal', text: 'Все процедуры снова доступны.' };
        case 'cooldowns_extended': return { tone: 'fail', text: `Процедуры на перезарядке задерживаются ещё на ${turnsRu(ev.turns)}.` };
        case 'promoted': return ev.procIds.length ? { tone: 'reveal', text: `Теперь установленные: «${ev.procIds.map(name).join('», «')}».` } : null;
        case 'demoted': return ev.procIds.length ? { tone: 'fail', text: `Больше не установленные: «${ev.procIds.map(name).join('», «')}».` } : null;
        case 'advantage': return { tone: 'reveal', text: `Преимущество: бросаете 2d20 и берёте лучший ${ev.turns ? `${turnsRu(ev.turns)}` : `(${ev.count} раз)`}.` };
        case 'disadvantage': return { tone: 'fail', text: `Помеха: бросаете 2d20 и берёте худший ${ev.turns ? `${turnsRu(ev.turns)}` : `(${ev.count} раз)`}.` };
        case 'reroll_gained': return { tone: 'reveal', text: `Можно перебросить ${ev.count} проваленный бросок (автоматически).` };
        case 'auto_success_gained': return { tone: 'reveal', text: `Следующий провал (${ev.count}) будет засчитан как успех.` };
        case 'attack_added': return { tone: 'fail', text: `В игру добавлена ещё одна скрытая карта: ${TYPE_RU[ev.type]}. Её тоже нужно раскрыть.` };
        case 'inject_shield': return { tone: 'reveal', text: 'Следующая вводная будет отменена.' };
        case 'inject_cancelled': return { tone: 'reveal', text: `Вводная «${name(ev.cardId)}» отменена консультантом.` };
        case 'roll_check': return { tone: 'roll', text: `Проверочный бросок d20 = ${ev.roll}: ${ev.ok ? 'удача' : 'неудача'}${ev.parity ? (ev.roll % 2 ? ' (нечёт)' : ' (чёт)') : ` (нужно ${ev.successAt}+)`}.` };
        case 'nothing_revealed': return { tone: 'info', text: 'Раскрывать нечего — ни одна скрытая атака этим не ловится.' };
        case 'swapped': return { tone: 'inject', text: `Злоумышленники сменили тактику: карта «${TYPE_RU[ev.type]}» заменена.` };
        case 'end':
          if (ev.status === 'won') return { tone: 'reveal', text: 'Вся цепочка атаки восстановлена. Отличная работа, защитник!' };
          if (ev.status === 'pentest') return { tone: 'inject', text: 'Расследование завершено досрочно. Показываю всю цепочку для разбора.' };
          return { tone: 'fail', text: 'Время вышло. Злоумышленники остались на шаг впереди.' };
        default: return null;
      }
    },
  };
}
