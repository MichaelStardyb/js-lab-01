# Журнал виконання Лабораторної роботи 7: V8, пам'ять і тести

## Чекліст фаз

| Фаза | Опис | Статус | Примітки / Результат |
| :--- | :--- | :---: | :--- |
| **0** | **Розвідка та архітектурний аудит** | [x] Виконано | Створено `docs/lab-07-plan.md` та `docs/lab-07-progress.md`. Проведено інвентаризацію гарячого шляху, серверних лімітів та точок алокацій. |
| **1 (M1)** | **Тести: Vitest у client, server, shared** | [x] Виконано | Налаштовано Vitest, 114 тестів (shared: 52, server: 26, client: 36), покриття shared ≥ 91% (Statements 95.1%, Branch 91.25%, Funcs 100%, Lines 96.24%), 5 fast-check property тестів, fake-timers `createLoop`, мутаційні тести M1 задокументовано. |
| **2 (M2)** | **Playwright E2E + GitHub Actions CI** | [x] Виконано | Створено `e2e/multiplayer.spec.ts` (2 ізольовані контексти браузера, рух, чат, без sleep), типізований хук `window.__e2e`, налаштовано `playwright.config.ts`, оновлено `.github/workflows/ci.yml`, локальний `npm run ci` повністю зелений (3/3 успішні прогони). |
| **3** | **Боти та харнес вимірювань** | [ ] Заплановано | Потрібно: боти в `shared/` + `tools/bots`, `GET /metrics` на сервері, клієнтські метрики `window.__perf`, `bench:browser`, `bench:report`. |
| **4** | **Baseline (Заморожування базового стану)** | [ ] Заплановано | Потрібно: тег `perf-baseline`, замір 3 прогонів медіани, збереження `docs/perf/before.json` та `before.md`. |
| **5 (M3)** | **Оптимізація за профілем** | [ ] Заплановано | Потрібно: пул куль/частинок з новими id, нуль `new Vector2` у гарячому шляху, стабільні форми, усунення алокацій у рендері/інтерполяції/кодеку. |
| **6** | **Просторовий хеш (умовно за профілем)** | [ ] Заплановано | Потрібно: виміряти частку колізій у часі кроку. Якщо домінує — реалізувати просторовий хеш з тестом еквівалентності O(n²) та детермінізмом. |
| **7** | **Web Worker (експеримент)** | [ ] Заплановано | Потрібно: винесення декодування знімків або AI ботів у воркер з трансферабельними буферами. A/B порівняння. |
| **8** | **Навантажувальний скрипт `bench:load`** | [ ] Заплановано | Потрібно: скрипт для 8/32/64/128 клієнтів в одній кімнаті, визначення порогу ламання (>33.3 мс), генерація SVG-графіка `docs/perf/load.svg`. |
| **9** | **README та фінальна перевірка** | [ ] Заплановано | Потрібно: зведені таблиці «до/після», опис тестів, E2E, графіка навантаження, перевірка чистих логів та конвенцій. |

---

## Лог контрольних перевірок (Verification Log)

### Фаза 0: Розвідка
- `npm run typecheck`: Успішно (0 помилок).
- `npm run lint`: Успішно (Syntax check passed).
- `npm test`: Успішно (10 тестів пройдено, 0 падінь).
- Створено: `docs/lab-07-plan.md`, `docs/lab-07-progress.md`.
- Гілка: `lab-07`.

---

### Фаза 1 (M1): Vitest та повноцінне тестування
- **Конфігурація**: Встановлено `vitest`, `@vitest/coverage-v8`, `fast-check`, `happy-dom`. Створено `vitest.config.ts` у корені та у кожному workspace (`shared`, `server`, `client`). Додано скрипти `test` та `test:coverage`.
- **Обсяг тестів**: 114 тестів (вимога ≥ 60 виконана з запасом):
  - `shared/` (52 тести): `integrate.test.ts` (10), `binaryCodec.test.ts` (11), `schema.test.ts` (11), `arena.test.ts` (7), `prng.test.ts` (4), `simulation.test.ts` (4), `property.test.ts` (5).
  - `server/` (26 тестів): `protocol.test.ts` (13), `room.test.ts` (5), `config.test.ts` (4), `loop.test.ts` (3), `multiplayer.test.ts` (1).
  - `client/` (36 тестів): `vector.test.ts` (8), `world.test.ts` (8), `collision.test.ts` (8), `loop.test.ts` (6), `reconciliation.test.ts` (6).
- **Fast-check Property-тести (5 інваріантів у `property.test.ts`)**:
  1. *Roundtrip*: `decodeSnapshot(encodeSnapshot(s))` зберігає всі поля, кут квантується з похибкою $\le 0.00015$ рад (шкала Int16 $\times 10000$).
  2. *Frame length*: `byteLength` дорівнює точно $12 + N \times 18$ для знімків та $7$ для input.
  3. *Corrupted buffer*: Довільні байти у буфері викликають контрольований `Error`/`RangeError`/`TypeError`, жодного необробленого збою чи виходу за межі пам'яті.
  4. *Arena containment*: Позиція корабля залишається строго в межах $[0, \text{width}) \times [0, \text{height})$ після довільної послідовності входів.
  5. *parseClientMessage*: Приймає всі валідні повідомлення схем і безпечно відхиляє будь-які пошкоджені дані.
- **Покриття `shared/` (`v8`)**:
  - Statements: **95.10%** (поріг $\ge 85\%$)
  - Branches: **91.25%** (поріг $\ge 85\%$)
  - Functions: **100.00%** (поріг $\ge 85\%$)
  - Lines: **96.24%** (поріг $\ge 85\%$)

#### Мутаційне тестування M1 (Протокол перевірки чутливості тестів):

1. **Мутація 1: Зміна знаку прискорення в `shared/sim/ship.ts`**:
   - *Зміна*: `const acceleration = input.thrust ? -ACCELERATION * dt : 0;` (замість `+ACCELERATION * dt`).
   - *Результат `npm test`*: **FAIL** (2 падіння):
     - `FAIL shared/test/integrate.test.ts > thrust applies acceleration along ship angle`: `AssertionError: expected -4.9 to be close to 4.9`.
     - `FAIL client/test/reconciliation.test.ts > replays unconfirmed inputs on top of authoritative server snapshot`: `AssertionError: expected 399.05227728 to be greater than 400`.
   - *Відновлення*: Після повернення рядка тест знову **PASS** (114/114).

2. **Мутація 2: Зсув байта зміщення `seq` у кодеку `shared/protocol/binaryCodec.ts`**:
   - *Зміна*: `view.setUint32(3, input.seq, true);` (замість зміщення `2`).
   - *Результат `npm test`*: **FAIL** (2 падіння):
     - `FAIL shared/test/binaryCodec.test.ts > round-trips input packets with 7-byte little-endian format`: `AssertionError: expected +0 to be 120`.
     - `FAIL server/test/protocol.test.ts > accepts valid binary input packets`: `AssertionError: expected 3840 to be 15`.
   - *Відновлення*: Після повернення зміщення на `2` тест знову **PASS** (114/114).

---

### Фаза 2 (M2): Playwright E2E та CI Pipeline
- **E2E сценарій**: Створено `e2e/multiplayer.spec.ts`. Перевірено:
  - 2 ізольовані контексти браузера входять у спільну кімнату через форму лобі.
  - Чат: Гравець 1 відправляє повідомлення, воно негайно з'являється в DOM списку `#messages` у Гравця 2.
  - Рух: Гравець 1 натискає `KeyW`, Гравець 2 фіксує зміну координат його корабля на > 15 пікселів.
  - Жодних хардкодних `sleep` чи `waitForTimeout` — синхронізація через `expect.poll` та `expect(locator).toContainText`.
  - Типізований хук `window.__e2e` під прапорцем `?e2e=1` оголошений через `declare global` без `as` та `any`.
- **Конфігурація Playwright**: `playwright.config.ts` з проектом Chromium, автоматичним підняттям веб-сервера через `npm start`, портом з оточення (`PORT=3100`), таймаутом і збереженням траси при помилках.
- **GitHub Actions**: Оновлено `.github/workflows/ci.yml` з Node 22, кешуванням npm, повним циклом перевірок, завантаженням артефактів звіту e2e та покриття коду. Додано бейдж CI у `README.md`.
- **Локальний CI**: Створено команду `npm run ci`.
  - Усі 5 етапів (`typecheck -> lint -> test:coverage -> build -> test:e2e`) пройдено за 11 с без жодної помилки.
  - E2E прогнано 3 рази поспіль: усі 3 прогони успішні (100% стабільність, non-flaky).

---

### Фаза 3: Генератор ботів та вимірювальний стенд (CDP + Metrics)
- **Синтетичний бот-мозок**:
  - `shared/sim/bot.ts`: Детерміністичний алгоритм вибору цілі (найближчий ворог або астероїд), маневрування (наведення кута з обертанням у найкоротший бік, ухилення від меж арени, стрільба при потраплянні в сектор цілі).
  - Бот використовує той самий бінарний кодек `encodeInput` і `WebSocket`, що й реальний клієнт, генеруючи 60 пакетів/с.
  - Покритий юніт-тестами у `shared/test/bot.test.ts` (поведінка на порожній арені, переслідування, розрахунок кута).
- **Скрипт автономних ботів**:
  - `server/scripts/run-bots.ts`: Запуск довільної кількості ботів (`npm run bots -- --count 8 --room arena`).
- **Серверні метрики**:
  - `server/src/metrics.ts`: Клас `MetricsCollector` з моніторингом затримки подієвого циклу через `perf_hooks.monitorEventLoopDelay({ resolution: 10 })`, збором статистики GC через `PerformanceObserver({ entryTypes: ['gc'] })`, розрахунком процентилів тику гри (p50/p95/p99) та вихідного мережевого трафіку.
  - Ендпоінт `GET /metrics` у `server/src/app.ts` під прапорцем `ENABLE_METRICS=1`.
  - Покритий юніт-тестами у `server/test/metrics.test.ts`.
- **Клієнтський вимірювач продуктивності**:
  - У `client/src/main.ts` додано кільцеві буфери часу кадрів під прапорцем `?perf=1`, експортовані в `window.__perf` (розрахунок p50/p95/p99 часу кадру, кількості дропнутих кадрів > 16.7 мс, приблизний облік GC затримки).
- **CDP бенчмарк-стенд**:
  - `server/scripts/bench-browser.ts`: Скрипт автоматизованого запуску Playwright Chromium з підключенням до Chrome DevTools Protocol (`CDPSession`).
  - Збір трасування категорій `v8`, `v8.execute`, `v8.gc`, `devtools.timeline`.
  - Автоматичне виділення подій `MinorGC`, `MajorGC`, сумарного часу та частоти збирання сміття.
  - Зняття профілю купи (Heap sampling profiler) для виявлення топ-5 алокаційних гарячих точок (`topAllocations`).
  - Інтеграція із серверними метриками `GET /metrics`.
- **Генератор звітів**:
  - `server/scripts/bench-report.ts`: Формування порівняльних Markdown-звітів між прогонами (`docs/perf/before.json` vs `docs/perf/after.json`).
- **Перевірка**: Запущено 30-секундний тестовий стенд, перевірено коректне формування метрик, відсутність помилок тайпінгу та успішне виконання 120 тестів.

---

## Definition of Done (Загальний стан)
- [x] Vitest у client/server/shared, ≥ 60 тестів, shared/ coverage ≥ 85 % з порогом
- [x] ≥ 5 fast-check property-тестів (roundtrip, довжина кадру, битий буфер, арена, parseClientMessage)
- [x] Тест fake-timers для `createLoop`; тести reconciliation і rate limiter
- [x] M1: зламаний `integrate` валить `npm test` (задокументовано)
- [x] Playwright: два контексти, рух і чат
- [x] GitHub Actions: типи, lint, тести, build, e2e; бейдж у README
- [x] Боти (той самий input і кодек), `bench:browser`, `bench:report`
- [ ] Baseline «до» зафіксовано до оптимізацій; «після» виміряно тими самими скриптами
- [ ] Пул куль/частинок; без `new Vector2` у гарячому шляху; стабільні hidden classes
- [ ] Просторовий хеш (якщо колізії були вузьким місцем) з тестом еквівалентності й детермінізму, або обґрунтонана відмова
- [ ] Worker-експеримент із A/B-цифрами і висновком у README
- [ ] `bench:load` для 8/32/64/128: графік і поріг «крок > 33 мс»
- [ ] README із таблицями, графіком і чесними висновками
- [ ] typecheck, lint, test, build і e2e зелені; жодного `any`, ≤ 4 `as` із коментарями
