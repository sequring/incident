# Уведомление об изменениях (GPL-3.0, раздел 5a)

«Инцидент» — изменённая производная работа на основе репозитория
[blackhillsinfosec/play.backdoorsandbreaches.com](https://github.com/blackhillsinfosec/play.backdoorsandbreaches.com),
распространяемого Black Hills Information Security под GNU General Public License v3.0.

Работа изменена (октябрь 2026):

- Изображения карт колод CoreV3.1, CoreV2.2-Expansion, CloudSecurity, DataDog, DenSecure, Electrical-Co-Op,
  Huntress, RedCanary и Trimarc уменьшены и перекодированы в WebP (`public/cards/`).
- Тексты карт транскрибированы с изображений и переведены на русский язык; для механик добавлены
  структурированные эффекты, подсказки-симптомы и сопоставление процедур (`src/data/`, `scripts/`).
- Движок, интерфейс, симулятор и правила одиночной игры написаны заново (`src/`, `sim/`, `test/`);
  исходный код оригинального веб-приложения не используется.
- Правила адаптированы для одного игрока; отличия описаны в README.

Вся работа распространяется на условиях GPL-3.0 (см. `LICENSE`).

## Товарные знаки

Backdoors & Breaches™ — товарный знак Black Hills Information Security. GPL не передаёт прав на товарные знаки.
«Инцидент» — неофициальная фанатская адаптация, не связанная с правообладателем и не одобренная им.
