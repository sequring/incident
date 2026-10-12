import { norm } from './names.js';

export const DECKS = [
  { key: 'core', title: 'Базовая колода', note: 'Core Deck v3.1 — классика',
    org: 'ООО «Северный ритейл» — сеть из 40 магазинов, 600 сотрудников, офис и небольшой ЦОД' },
  { key: 'expansion', title: 'Расширение B&B', note: 'Физический доступ, цепочки поставок, консультанты',
    org: 'АО «ПромТехСнаб» — производитель оборудования с филиалами, складами и пропускной системой' },
  { key: 'cloud', title: 'Облачная безопасность', note: 'AWS, Azure, GCP и облачные сервисы',
    org: 'SaaS-компания «ОблакоДок» — сервис электронного документооборота, вся инфраструктура в публичном облаке' },
  { key: 'datadog', title: 'Datadog', note: 'Облака, контейнеры, мониторинг',
    org: 'Финтех-стартап «Платёжка» — микросервисы в Kubernetes, CI/CD и десятки облачных аккаунтов' },
  { key: 'densecure', title: 'DenSecure', note: 'Расширение от DenSecure',
    org: 'Медицинский центр «Здоровье+» — клиники, лаборатория, Linux-серверы и почта в Microsoft 365' },
  { key: 'coop', title: 'Электросетевой кооператив', note: 'Энергетика и критическая инфраструктура',
    org: 'Сельский электросетевой кооператив — подстанции, АСУ ТП, диспетчерская и 30 тысяч абонентов' },
  { key: 'huntress', title: 'Huntress', note: 'SMB, MSP и охота за угрозами',
    org: 'Бухгалтерская фирма «Баланс» — 50 рабочих мест на обслуживании у внешнего MSP-провайдера' },
  { key: 'redcanary', title: 'Red Canary', note: 'Детектирование и реагирование',
    org: 'Логистическая компания «ТрансЛайн» — офисы в трёх городах, удалённые сотрудники и свой SOC' },
  { key: 'trimarc', title: 'Trimarc', note: 'Безопасность Active Directory',
    org: 'Холдинг «Меридиан» — 12 дочерних компаний в одном лесу Active Directory, гибрид с Entra ID' },
  { key: 'all', title: 'Всё сразу', note: 'Базовая колода и все расширения',
    org: 'Госкорпорация «Объединённые системы» — всё и сразу: облака, AD, АСУ ТП, подрядчики и филиалы' },
];

const sig = (c) => `${c.type}:${norm(c.name_en)}`;

// A playable deck = core cards + the expansion's own cards, without duplicate titles.
// References to a dropped duplicate (e.g. the same procedure printed in two expansions) point to the kept copy.
export function composeDeck(key, core, expansions) {
  const extra = key === 'core' ? [] : key === 'all' ? Object.values(expansions).flat() : expansions[key] ?? [];
  const kept = new Map(core.map((c) => [sig(c), c.id]));
  const alias = {};
  const cards = [...core];
  for (const c of extra) {
    const k = sig(c);
    if (kept.has(k)) { alias[c.id] = kept.get(k); continue; }
    kept.set(k, c.id);
    cards.push(c);
  }
  return cards.map((c) => (c.detections?.some((d) => alias[d])
    ? { ...c, detections: [...new Set(c.detections.map((d) => alias[d] ?? d))] }
    : c));
}
